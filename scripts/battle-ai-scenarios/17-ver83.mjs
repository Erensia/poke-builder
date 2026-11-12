// 8.3 A1 턴 종료 순서(R6, Showdown 순서): ① 날씨 종료 → ② 날씨 피해·특성 → ③ 미래예지 → 희망사항 → ④ 면역 해제·필드·탈피·먹다남은음식·
// 뿌리박기류·씨뿌리기·상태이상 틱·저주·속박… → ⑤ 멸망의노래·가속…·수확·되새김질·열매 재확인. 설계 `8.3-A1-턴종료순서설계.md` §7.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const sta = await server.ssrLoadModule("/src/lib/statusConditions.ts");
  const move = (id) => ({ kind: "move", move: data.getMove(id) });
  const play = (st, rng = () => 0.5) => rt.runTurn(st, move("칼춤"), move("칼춤"), rng);
  const eot = (r) => r.result.endOfTurn;
  const at = (r, pred) => eot(r).findIndex(pred);
  const A = (e) => e.actor === "a";
  const hp = pts({ atk: 32, spe: 32, hp: 2 });
  // a: 잠만보(노말 — 모래바람을 맞는다), b: 메타그로스(강철 — 모래바람 면제)
  const base = (aAbility = null, aItem = null) => battle([mon("잠만보", ["칼춤"], aAbility, aItem, hp)], [mon("메타그로스", ["칼춤"], null, null, hp)]);
  const wishOn = (st, turnsRemaining = 1) => (st.sideA.wish = { turnsRemaining, healAmount: Math.floor(st.a.maxHp / 8) });

  // R6-a 희망사항은 먹다남은음식보다 먼저
  {
    const st = base(null, "먹다남은음식");
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    wishOn(st);
    const r = play(st);
    const w = at(r, (e) => A(e) && e.wishHeal), l = at(r, (e) => A(e) && e.itemHeal);
    check("8.3 A1 R6-a: 희망사항 회복 → 먹다남은음식", w >= 0 && l > w, `희망사항=${w} 먹다남은음식=${l}`);
  }
  // R6-b 회복 0이어도 로그 한 줄
  {
    const st = base();
    wishOn(st);
    const r = play(st);
    check("8.3 A1 R6-b: HP 가득이면 wishNoHeal 한 줄, 회복 줄 없음", eot(r).filter((e) => A(e) && e.wishNoHeal).length === 1 && at(r, (e) => A(e) && e.wishHeal) < 0, JSON.stringify(eot(r).map((e) => e.wishNoHeal)));
  }
  // R6-c 모래바람 → 희망사항 → 먹다남은음식 → 독
  {
    const st = base(null, "먹다남은음식");
    st.weather = "모래바람";
    st.weatherTurnsRemaining = 3;
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    st.a.status = sta.inflictStatus(st.a.status, "poison");
    wishOn(st);
    const r = play(st);
    const s = at(r, (e) => A(e) && e.sandstormDamage), w = at(r, (e) => A(e) && e.wishHeal), l = at(r, (e) => A(e) && e.itemHeal), p = at(r, (e) => A(e) && e.statusCondition === "poison");
    check("8.3 A1 R6-c: 모래바람 → 희망사항 → 먹다남은음식 → 독", s >= 0 && s < w && w < l && l < p, `${s}/${w}/${l}/${p}`);
  }
  // R6-d 미래예지 → 희망사항 (같은 편 같은 턴 종료에 겹침)
  {
    const st = base();
    st.a.currentHp = Math.floor(st.a.maxHp * 0.7);
    st.sideA.futureSight = { turnsRemaining: 1, move: data.getMove("미래예지"), sourceIndex: 0 };
    wishOn(st);
    const r = play(st);
    const f = at(r, (e) => A(e) && e.futureSightMoveName), w = at(r, (e) => A(e) && e.wishHeal);
    check("8.3 A1 R6-d: 미래예지 → 희망사항", f >= 0 && w > f, `${f}/${w}`);
  }
  // R6-e 날씨 마지막 턴(남은 1)에는 모래바람 피해 없음, 남은 2면 피해 있음
  {
    const last = base();
    last.weather = "모래바람";
    last.weatherTurnsRemaining = 1;
    const rl = play(last);
    const more = base();
    more.weather = "모래바람";
    more.weatherTurnsRemaining = 2;
    const rm = play(more);
    check(
      "8.3 A1 R6-e: 날씨 마지막 턴은 피해 없이 종료, 남은 2턴이면 피해",
      at(rl, (e) => e.sandstormDamage) < 0 && rl.result.weatherExpired === true && at(rm, (e) => A(e) && e.sandstormDamage) >= 0 && !rm.result.weatherExpired,
      `마지막=${at(rl, (e) => e.sandstormDamage)}/${rl.result.weatherExpired} 남은2=${at(rm, (e) => A(e) && e.sandstormDamage)}`,
    );
  }
  // R6-f 모래바람이 먹다남은음식보다 먼저 — HP가 딱 모래바람 피해만큼이면 회복 전에 쓰러진다
  {
    const st = base(null, "먹다남은음식");
    st.weather = "모래바람";
    st.weatherTurnsRemaining = 3;
    st.a.currentHp = Math.floor(st.a.maxHp / 16);
    const r = play(st);
    check("8.3 A1 R6-f: 모래바람 피해가 먹다남은음식보다 먼저(쓰러짐)", r.nextState.a.currentHp === 0 && at(r, (e) => A(e) && e.itemHeal) < 0, `hp=${r.nextState.a.currentHp}`);
  }
  // R6-g 포이즌힐: 먹다남은음식 뒤 회복, 독 피해 없음
  {
    const st = base("포이즌힐", "먹다남은음식");
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    st.a.status = sta.inflictStatus(st.a.status, "poison");
    const r = play(st);
    const l = at(r, (e) => A(e) && e.itemHeal), p = at(r, (e) => A(e) && e.poisonHealAmount);
    check("8.3 A1 R6-g: 먹다남은음식 → 포이즌힐, 독 피해 없음", l >= 0 && p > l && at(r, (e) => A(e) && e.statusCondition) < 0, `${l}/${p}`);
  }
  // R6-h 멸망의노래로 쓰러지는 턴에도 씨뿌리기 흡수와 상대 회복이 먼저 처리된다
  {
    const st = base();
    st.a.perishCount = 0;
    st.a.volatile = vol.inflictVolatile(st.a.volatile, "leechSeed", () => 0.5);
    st.b.currentHp = Math.floor(st.b.maxHp / 2);
    const r = play(st);
    const s = at(r, (e) => A(e) && e.leechSeedDamage), h = at(r, (e) => !A(e) && e.leechSeedHealAmount), p = at(r, (e) => A(e) && e.perishFainted);
    check("8.3 A1 R6-h: 씨뿌리기 흡수·상대 회복 → 멸망의노래 기절", s >= 0 && h > s && p > h && r.nextState.a.currentHp === 0, `${s}/${h}/${p}`);
  }
  // R6-i 회귀: 상태이상 틱으로 쓰러진 뒤에도 상대의 가속은 발동
  {
    const st = battle([mon("잠만보", ["칼춤"], null, null, hp)], [mon("메타그로스", ["칼춤"], "가속", null, hp)]);
    st.a.currentHp = 1;
    st.a.status = sta.inflictStatus(st.a.status, "poison");
    const r = play(st);
    check("8.3 A1 R6-i: 독으로 쓰러져도 상대 가속은 발동", r.nextState.a.currentHp === 0 && r.nextState.b.stages.spe === 1, `a=${r.nextState.a.currentHp} spe=${r.nextState.b.stages.spe}`);
  }
  // R6-j 자리 효과: 그 자리의 포켓몬이 기절해도 미래예지는 소멸(교체로 들어온 쪽이 맞지 않음)하고 희망사항 카운터는 줄어든다
  {
    const st = battle([mon("잠만보", ["칼춤"], null, null, hp), mon("팬텀", ["칼춤"], null, null, hp)], [mon("한카리아스", ["지진"], null, null, hp)]);
    st.a.currentHp = 1;
    st.sideA.futureSight = { turnsRemaining: 1, move: data.getMove("미래예지"), sourceIndex: 0 };
    wishOn(st, 2);
    const r = rt.runTurn(st, move("칼춤"), move("지진"), () => 0.5);
    check("8.3 A1 R6-j: 기절한 자리의 미래예지 소멸·희망사항 카운터 감소", r.nextState.a.currentHp === 0 && !r.nextState.sideA.futureSight && r.nextState.sideA.wish?.turnsRemaining === 1, `fs=${!!r.nextState.sideA.futureSight} wish=${r.nextState.sideA.wish?.turnsRemaining}`);
  }
  // R6-k 수확으로 돌아온 열매를 같은 턴 종료에 HP 조건으로 먹는다
  {
    const st = base("수확");
    st.weather = "쾌청";
    st.weatherTurnsRemaining = 3;
    st.a.consumedBerryId = "자뭉열매";
    st.a.itemConsumed = true;
    st.a.currentHp = Math.floor(st.a.maxHp * 0.4);
    const r = play(st);
    const h = at(r, (e) => A(e) && e.harvestRestoredBerryName), b = at(r, (e) => A(e) && e.berryHealItemName === "자뭉열매");
    check("8.3 A1 R6-k: 수확 → 같은 턴 열매 재확인", h >= 0 && b > h, `${h}/${b}`);
  }
  // R6-l 독 → 속박 (둘 다 걸린 포켓몬)
  {
    const st = base();
    st.a.status = sta.inflictStatus(st.a.status, "poison");
    st.a.volatile = vol.inflictVolatile(st.a.volatile, "bound", () => 0.5);
    const r = play(st);
    const p = at(r, (e) => A(e) && e.statusCondition === "poison"), b = at(r, (e) => A(e) && e.boundDamage);
    check("8.3 A1 R6-l: 독 피해 → 속박 피해", p >= 0 && b > p, `${p}/${b}`);
  }
  // R6-m 탈피가 먼저 발동하면 그 턴 독 피해가 없다
  {
    const st = base("탈피");
    st.a.status = sta.inflictStatus(st.a.status, "poison");
    const r = play(st, () => 0.01);
    check("8.3 A1 R6-m: 탈피 치료 → 독 피해 없음", at(r, (e) => A(e) && e.abilityCuredStatus === "poison") >= 0 && at(r, (e) => A(e) && e.statusCondition) < 0, JSON.stringify(eot(r).map((e) => e.abilityCuredStatus ?? e.statusCondition)));
  }
}
