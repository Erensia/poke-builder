// 8.3 D3-fix-27 모래바람 피해 면역 특성: 모래숨기·모래의힘·모래헤치기·방진(+매직가드, 별도 경로)은 면역, 모래날림은 면역이 아니다.
// Showdown `sandstorm.onWeather` → `onImmunity`: 바위·땅·강철 타입, 특성 sandforce·sandrush·sandveil·overcoat. 모래날림(sandstream)은 없다.
// 설계 `8.3-D3-E5-검수.md` §3 fix-27 (E5-03). 엔진(finishTurn)과 AI(turnRates)가 `SANDSTORM_IMMUNE_ABILITY_NAMES`를 공유한다.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const stMod = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // a(특성·타입 시험 대상) vs b(잠만보, 특성 없음). 모래바람 속 한 턴 뒤 a가 잃은 HP와 최대 HP.
  const lost = (id, ability) => {
    const st = battle([mon(id, [IDLE], ability)], [mon("잠만보", [IDLE])]);
    st.weather = "모래바람";
    st.weatherTurnsRemaining = 5;
    const maxHp = st.a.maxHp, hp0 = st.a.currentHp;
    const out = rt.runTurn(st, act(IDLE), act(IDLE), () => 0.5);
    return { lostHp: hp0 - out.nextState.a.currentHp, tick: Math.floor(maxHp / 16) };
  };

  guard("D3-fix27 1 면역 특성 집합: 모래숨기·모래의힘·모래헤치기·방진은 있고 모래날림은 없다", () => {
    const s = stMod.SANDSTORM_IMMUNE_ABILITY_NAMES;
    const got = { 모래숨기: s.has("모래숨기"), 모래의힘: s.has("모래의힘"), 모래헤치기: s.has("모래헤치기"), 방진: s.has("방진"), 모래날림: s.has("모래날림") };
    return json(got) === json({ 모래숨기: true, 모래의힘: true, 모래헤치기: true, 방진: true, 모래날림: false }) ? true : json(got);
  });
  guard("D3-fix27 2 모래날림 보유자(노말 타입)는 모래바람 틱 피해(최대 HP 1/16)를 받는다", () => {
    const r = lost("잠만보", "모래날림");
    return r.tick > 0 && r.lostHp === r.tick ? true : json(r);
  });
  guard("D3-fix27 3 방진 보유자는 모래바람 피해를 받지 않는다", () => {
    const r = lost("잠만보", "방진");
    return r.lostHp === 0 ? true : json(r);
  });
  guard("D3-fix27 4 모래숨기·모래의힘·모래헤치기는 계속 면역이다", () => {
    const got = ["모래숨기", "모래의힘", "모래헤치기"].map((ab) => lost("잠만보", ab).lostHp);
    return got.every((n) => n === 0) ? true : json(got);
  });
  guard("D3-fix27 5 매직가드(별도 경로)와 바위·땅·강철 타입 면역은 그대로다, 특성·타입 없는 대조군은 피해를 받는다", () => {
    const magic = lost("잠만보", "매직가드").lostHp;
    const rock = lost("마기라스", null).lostHp, ground = lost("한카리아스", null).lostHp, steel = lost("메타그로스", null).lostHp; // 바위(마기라스 바위·악)·땅(한카리아스 드래곤·땅)·강철(메타그로스 강철·에스퍼)
    const plain = lost("잠만보", null);
    return magic === 0 && rock === 0 && ground === 0 && steel === 0 && plain.lostHp === plain.tick ? true : json({ magic, rock, ground, steel, plain });
  });
}
