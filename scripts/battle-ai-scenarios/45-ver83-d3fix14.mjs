// 8.3 D3-fix-14 맹독: ① 피해식 = Showdown `clampIntRange(baseMaxhp / 16, 1) * stage`(나눗셈 내림 → 최소 1 → 단계 곱, 상한 15) ② 교체하면 맹독 카운터 1로 초기화(`tox.onSwitchIn`).
// 설계 `8.3-D3-fix14-맹독설계.md`(검수 `…-검수.md`). 수면·얼음 카운터·독·화상은 교체해도 그대로다(Showdown `onSwitchIn`은 맹독뿐).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sc = await server.ssrLoadModule("/src/lib/statusConditions.ts");
  const json = JSON.stringify;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const IDLE = "칼춤";
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const run = (st, b) => rt.runTurn(st, act(IDLE), b?.kind ? b : act(IDLE), () => 0.5).nextState;
  const dmg = (hp, n) => sc.computeStatusEndOfTurnDamage({ condition: "badly-poisoned", turnsElapsed: n }, hp);
  const sdTox = (hp, n) => Math.max(1, Math.floor(hp / 16)) * Math.min(15, n); // 참조 구현(Showdown)
  const mk = (hp, status, ability = null) => {
    const st = battle([mon("한카리아스", [IDLE])], [mon("잠만보", [IDLE], ability), mon("메타그로스", [IDLE])]);
    st.b.maxHp = hp; st.b.currentHp = hp; st.b.status = status;
    return st;
  };
  const TOX = (n) => ({ condition: "badly-poisoned", turnsElapsed: n });

  guard("D3-fix14 1 값표: HP 100 단계 1·2·3·4·15 = 6·12·18·24·90 / HP 155 단계 3 = 27 / HP 160 단계 4 = 40", () => {
    const got = [dmg(100, 1), dmg(100, 2), dmg(100, 3), dmg(100, 4), dmg(100, 15), dmg(155, 3), dmg(160, 4)];
    const want = [6, 12, 18, 24, 90, 27, 40];
    return json(got) === json(want) ? true : json({ got, want });
  });
  guard("D3-fix14 1-b 하한 1(곱하기 전): HP 15·단계 3 = 3 / HP 1·단계 1 = 1", () => {
    const got = [dmg(15, 3), dmg(1, 1)];
    return json(got) === json([3, 1]) ? true : json(got);
  });
  guard("D3-fix14 2 참조 구현과 전수 일치: HP 1~400 × 단계 1~15", () => {
    for (let hp = 1; hp <= 400; hp++) for (let n = 1; n <= 15; n++) if (dmg(hp, n) !== sdTox(hp, n)) return json({ hp, n, got: dmg(hp, n), want: sdTox(hp, n) });
    return true;
  });
  guard("D3-fix14 2-b 16의 배수 HP(160·320)는 HP/16 × 단계와 같다(불변)", () => {
    for (const hp of [160, 320]) for (let n = 1; n <= 15; n++) if (dmg(hp, n) !== (hp / 16) * n) return json({ hp, n });
    return true;
  });
  guard("D3-fix14 3 단계 상한: turnsElapsed 15·16·40 모두 15단계 값", () => json([dmg(155, 15), dmg(155, 16), dmg(155, 40)]) === json([135, 135, 135]) ? true : json([dmg(155, 15), dmg(155, 16), dmg(155, 40)]));
  guard("D3-fix14 3-b AI의 소수 카운터(평균 단계)는 floor(HP/16) × 카운터: HP 100·2.5 = 15", () => dmg(100, 2.5) === 15 ? true : String(dmg(100, 2.5)));

  guard("D3-fix14 4 엔진 통합: HP 155 맹독을 3틱 돌리면 누적 9+18+27 = 54(현행 57)", () => {
    let st = mk(155, TOX(1));
    for (let i = 0; i < 3; i++) st = run(st);
    const lost = 155 - st.b.currentHp;
    return lost === 54 ? true : `lost=${lost}`;
  });
  guard("D3-fix14 5 교체 복귀: 맹독 4단계 → 교체 아웃 → 대기 몬의 카운터 1 → 복귀 후 첫 틱은 1단계(9)이고 상태는 맹독 그대로", () => {
    const out = run(mk(155, TOX(4)), { kind: "switch", toIndex: 1 });
    const stored = out.sideB.party[0].status;
    if (stored.condition !== "badly-poisoned" || stored.turnsElapsed !== 1) return json({ stored });
    const back = run(out, { kind: "switch", toIndex: 0 });
    const lost = 155 - back.b.currentHp;
    return lost === 9 && back.b.status.condition === "badly-poisoned" ? true : json({ lost, status: back.b.status });
  });
  guard("D3-fix14 5-b 자연회복 + 맹독: 교체 아웃하면 상태 없음(초기화가 지워진 상태를 되살리지 않음)", () => {
    const out = run(mk(155, TOX(4), "자연회복"), { kind: "switch", toIndex: 1 });
    return out.sideB.party[0].status.condition === null ? true : json(out.sideB.party[0].status);
  });
  guard("D3-fix14 6 독·수면·얼음은 교체해도 상태·카운터 그대로(맹독만 초기화)", () => {
    for (const s of [{ condition: "poison", turnsElapsed: 4 }, { condition: "sleep", turnsElapsed: 2 }, { condition: "freeze", turnsElapsed: 2 }, { condition: "burn", turnsElapsed: 4 }]) {
      const got = run(mk(155, s), { kind: "switch", toIndex: 1 }).sideB.party[0].status;
      if (got.condition !== s.condition || got.turnsElapsed !== s.turnsElapsed) return json({ s, got });
    }
    return true;
  });
  guard("D3-fix14 7 새로 걸린 맹독은 1단계부터: 독압정 2겹 등장 직후 첫 틱 = 9", () => {
    const st = mk(155, { condition: null, turnsElapsed: 0 });
    st.sideB.hazards.toxicSpikesLayers = 2;
    const out = run(run(st, { kind: "switch", toIndex: 1 }), { kind: "switch", toIndex: 0 });
    const tox = out.b.status;
    const lost = 155 - out.b.currentHp;
    return tox.condition === "badly-poisoned" && lost === 9 ? true : json({ tox, lost });
  });
  guard("D3-fix14 8 포이즌힐: 맹독에서 매 턴 HP 1/8 회복, 카운터는 계속 진행(중립 효과)", () => {
    let st = mk(160, TOX(1), "포이즌힐");
    st.b.currentHp = 100;
    st = run(st);
    return st.b.currentHp === 120 && st.b.status.turnsElapsed === 2 ? true : json({ hp: st.b.currentHp, status: st.b.status });
  });
}
