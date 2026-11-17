// 8.3 D3-fix-7 독 타입이 쓰는 맹독은 필중이고 무적(구멍파기 1턴째 등)도 통과한다
// (Showdown `sim/battle-actions.ts` hitStepAccuracy `move.id === 'toxic' && gen >= 8 && pokemon.hasType('Poison')` → accuracy = true,
//  hitStepInvulnerabilityEvent 같은 조건 → 통과). 설계 `8.3-D3-fix7-맹독필중설계.md`(검수 반영 §9, A안)
export default async function ({ server, data, mon, battle, pts, check }) {
  const hc = await server.ssrLoadModule("/src/lib/battle/hitChance.ts");
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const IDLE = "도우미";
  const chance = (st, moveId, { defenderAbility, defenderItem } = {}) =>
    hc.computeBattleHitChance({
      state: st, attacker: st.a, defender: st.b, move: data.getMove(moveId),
      attackerAbility: undefined, defenderAbility: defenderAbility ? data.getAbility(defenderAbility) : undefined,
      attackerItem: undefined, defenderItem: defenderItem ? data.getItem(defenderItem) : undefined, attackerMovesSecond: false,
    });
  const poisonVsBulky = (aMon = "아보크", aMoves = ["맹독", "오물폭탄"]) => battle([mon(aMon, aMoves)], [mon("잠만보", [IDLE])]);
  const approx = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;

  // 1~3. 명중 확률(computeBattleHitChance)
  { const st = poisonVsBulky();
    check("D3-fix7 1 독 타입 맹독 = 필중(null)", chance(st, "맹독") === null, json(chance(st, "맹독"))); }
  { const st = battle([mon("피카츄", ["맹독"])], [mon("잠만보", [IDLE])]);
    check("D3-fix7 2 비독 타입 맹독 = 90%(회귀 방지)", approx(chance(st, "맹독"), 0.9), json(chance(st, "맹독"))); }
  { const st = poisonVsBulky(); st.b.accuracyStages.evasion = 6;
    check("D3-fix7 3 독 타입 + 상대 회피 +6 + 반짝가루 → 여전히 필중", chance(st, "맹독", { defenderItem: "반짝가루" }) === null, json(chance(st, "맹독", { defenderItem: "반짝가루" }))); }
  { const st = poisonVsBulky(); st.weather = "모래바람";
    check("D3-fix7 3 독 타입 + 모래숨기 상대(모래바람) → 필중", chance(st, "맹독", { defenderAbility: "모래숨기" }) === null, json(chance(st, "맹독", { defenderAbility: "모래숨기" }))); }
  // 현재 타입 규칙: 물붓기로 타입이 물이 된 독 타입은 필중이 아니다
  { const st = poisonVsBulky(); st.a.types = ["물"];
    check("D3-fix7 3-b 물붓기 등으로 독 타입을 잃은 사용자의 맹독 = 90%", approx(chance(st, "맹독"), 0.9), json(chance(st, "맹독"))); }
  // 4. 독 타입의 다른 독 기술은 필중이 되지 않는다
  { const st = poisonVsBulky(); st.b.accuracyStages.evasion = 6;
    const c = chance(st, "오물폭탄");
    check("D3-fix7 4 독 타입의 오물폭탄(다른 기술)은 필중이 아니다", c !== null && c < 1, json(c)); }

  // 5. 엔진 경로: 난수 0.99(빗나감 값)로도 독 타입 맹독은 맞아 맹독 상태가 된다. 빗나감 문구(hit=false)가 없다
  const turn = (st, aMove, bMove, rand) => {
    const o = rt.runTurn(st, { kind: "move", move: data.getMove(aMove) }, { kind: "move", move: data.getMove(bMove) }, rand);
    return { o, a: (o.result ?? o.partialResult).actions.find((x) => x.actor === "a"), n: o.nextState };
  };
  { const r = turn(poisonVsBulky(), "맹독", IDLE, () => 0.99);
    check("D3-fix7 5 엔진: 독 타입 맹독은 난수 0.99에도 명중해 상대가 맹독 상태(빗나감 없음)", r.a?.hit === true && r.n.b.status.condition === "badly-poisoned", json({ hit: r.a?.hit, s: r.n.b.status.condition })); }
  { const r = turn(battle([mon("피카츄", ["맹독"])], [mon("잠만보", [IDLE])]), "맹독", IDLE, () => 0.99);
    check("D3-fix7 5b 엔진: 비독 타입 맹독은 난수 0.99에 빗나간다(회귀 방지)", r.a?.hit === false, json({ hit: r.a?.hit })); }

  // 3-c. 무적 통과: 상대가 구멍파기 1턴째(땅속)일 때 독 타입 맹독은 명중, 비독 타입은 빗나간다. 상대가 더 빨라 먼저 구멍을 판다.
  const fast = pts({ spe: 32 });
  const digTurn = (aMon) => {
    const st = battle([mon(aMon, ["맹독"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["구멍파기", IDLE], null, null, fast)]);
    return turn(st, "맹독", "구멍파기", () => 0.5);
  };
  { const r = digTurn("아보크");
    check("D3-fix7 3-c 구멍파기 1턴째 대상에게 독 타입 맹독 = 명중(무적 통과)", r.a?.hit === true && r.n.b.status.condition === "badly-poisoned", json({ hit: r.a?.hit, s: r.n.b.status.condition })); }
  { const r = digTurn("피카츄");
    check("D3-fix7 3-c 같은 상황에서 비독 타입 맹독은 빗나간다(현재 동작 고정)", r.a?.hit === false, json({ hit: r.a?.hit })); }
}
