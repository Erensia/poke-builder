// 8.3 D3-fix-29 안개제거(Showdown 맞춤, 2.3 B3 결정을 대체): `defog.onHit` —
//   대상(상대) 편: 리플렉터·빛의장막·오로라베일·신비의부적(+흰안개)·설치물 제거 / 사용자 편: **설치물만** 제거(벽·신비의부적은 유지) / 필드 제거 / 날씨는 그대로 /
//   대상 회피율 −1(대타가 있으면 회피 하락만 막히고 제거는 진행). 매직미러로 반사되면 사용자 편이 "대상 편"이 된다.
// 설계 `8.3-D3-E5-검수.md` §6 Q1·§3 fix-29 (E5-16), 사용자 결정 2026-11-20(재결정).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const rocks = (side) => ({ ...side.hazards, stealthRock: true });
  // a(안개제거 사용자, 매직가드) vs b(상대). setup으로 양쪽 편 효과를 깐 뒤 한 턴.
  const run = (setup, { bAbility = null, sub = false } = {}) => {
    const st = battle([mon("잠만보", ["안개제거", IDLE], "매직가드")], [mon("한카리아스", [IDLE], bAbility)]);
    setup?.(st);
    if (sub) st.b.substituteHp = 500;
    const out = rt.runTurn(st, act("안개제거"), act(IDLE), () => 0.5);
    const a = (out.result ?? out.partialResult).actions.find((x) => x.actor === "a");
    return { a, n: out.nextState };
  };
  const both = (st) => {
    st.sideA.screens = { reflect: 5, lightScreen: 5 }; st.sideA.safeguardTurnsRemaining = 5; st.sideA.hazards = rocks(st.sideA);
    st.sideB.screens = { reflect: 5, lightScreen: 5, auroraVeil: 5 }; st.sideB.safeguardTurnsRemaining = 5; st.sideB.hazards = rocks(st.sideB);
  };
  const noHazard = (s) => !s.hazards.stealthRock && s.hazards.spikesLayers === 0 && s.hazards.toxicSpikesLayers === 0 && !s.hazards.stickyWeb;

  guard("D3-fix29 1 대상(상대) 편은 벽·신비의부적·설치물이 전부 사라진다", () => {
    const { n } = run(both);
    return json(n.sideB.screens) === "{}" && n.sideB.safeguardTurnsRemaining === undefined && noHazard(n.sideB) ? true : json({ s: n.sideB.screens, sg: n.sideB.safeguardTurnsRemaining, h: n.sideB.hazards });
  });
  guard("D3-fix29 2 사용자 편은 설치물만 사라지고 벽·신비의부적은 남는다", () => {
    const { n } = run(both);
    return noHazard(n.sideA) && n.sideA.screens.reflect !== undefined && n.sideA.screens.lightScreen !== undefined && n.sideA.safeguardTurnsRemaining !== undefined ? true : json({ s: n.sideA.screens, sg: n.sideA.safeguardTurnsRemaining, h: n.sideA.hazards });
  });
  guard("D3-fix29 3 필드는 사라지고 날씨는 그대로다", () => {
    const { n } = run((st) => { st.field = "그래스필드"; st.fieldTurnsRemaining = 5; st.weather = "비"; st.weatherTurnsRemaining = 5; });
    return n.field === undefined && n.weather === "비" ? true : json({ field: n.field, weather: n.weather });
  });
  guard("D3-fix29 4 대상 회피율이 1랭크 떨어진다(사용자는 그대로)", () => {
    const { n } = run();
    return n.b.accuracyStages.evasion === -1 && n.a.accuracyStages.evasion === 0 ? true : json({ b: n.b.accuracyStages, a: n.a.accuracyStages });
  });
  guard("D3-fix29 5 대타가 있으면 회피 하락만 막히고 제거는 진행된다", () => {
    const { n } = run(both, { sub: true });
    return n.b.accuracyStages.evasion === 0 && json(n.sideB.screens) === "{}" && n.sideB.safeguardTurnsRemaining === undefined && noHazard(n.sideA) ? true : json({ ev: n.b.accuracyStages.evasion, s: n.sideB.screens });
  });
  guard("D3-fix29 6 매직미러로 반사되면 사용자 편이 대상 편: 사용자 편 벽·신비의부적이 사라지고 상대 편은 남으며, 회피 하락은 사용자에게 간다", () => {
    const { n } = run(both, { bAbility: "매직미러" });
    const aGone = json(n.sideA.screens) === "{}" && n.sideA.safeguardTurnsRemaining === undefined;
    const bKept = n.sideB.screens.reflect !== undefined && n.sideB.safeguardTurnsRemaining !== undefined;
    return aGone && bKept && noHazard(n.sideA) && noHazard(n.sideB) && n.a.accuracyStages.evasion === -1 && n.b.accuracyStages.evasion === 0 ? true : json({ a: n.sideA.screens, sgA: n.sideA.safeguardTurnsRemaining, b: n.sideB.screens, sgB: n.sideB.safeguardTurnsRemaining, ev: [n.a.accuracyStages.evasion, n.b.accuracyStages.evasion] });
  });
  guard("D3-fix29 7 지울 것이 사용자 편 벽뿐이면(대상 편·설치물·필드 없음) 사용자 벽은 남고 '환경 효과가 사라졌다' 표시도 없다", () => {
    const { a, n } = run((st) => { st.sideA.screens = { reflect: 5 }; });
    return n.sideA.screens.reflect !== undefined && !a.defogFieldCleared ? true : json({ s: n.sideA.screens, cleared: a.defogFieldCleared });
  });
  guard("D3-fix29 8 대상 편에 지울 것이 있으면 로그 표시가 켜진다(기존 문구 경로 유지)", () => {
    const { a } = run((st) => { st.sideB.screens = { reflect: 5 }; });
    return a.defogFieldCleared === true ? true : json({ cleared: a.defogFieldCleared });
  });
}
