// 8.3 D3-fix-28 코트체인지 실패: 양쪽 편에 바꿀 효과(설치물·벽·순풍·신비의부적)가 하나도 없으면 실패한다.
// Showdown `courtchange.onHitField`: `if (!success) return false`. 엔진은 `courtChangeDone`을 항상 true로 두고 "서로의 필드 효과를 뒤바꿨다!"를 띄웠다.
// 설계 `8.3-D3-E5-검수.md` §3 fix-28 (E5-18). AI(statusMoveEffects `courtChange` 낭비 판정)는 이미 같은 기준이라 불변.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // 코트체인지를 쓰는 a가 준비된 상태(setup)에서 한 턴. a 행동 결과 + 다음 상태를 돌려준다.
  const run = (setup) => {
    const st = battle([mon("잠만보", ["코트체인지", IDLE], "매직가드")], [mon("한카리아스", [IDLE])]);
    setup?.(st);
    const out = rt.runTurn(st, act("코트체인지"), act(IDLE), () => 0.5);
    const a = (out.result ?? out.partialResult).actions.find((x) => x.actor === "a");
    return { a, st: out.nextState };
  };

  guard("D3-fix28 1 양쪽 편이 비어 있으면 실패 — courtChangeDone 없음, courtChangeFailed 표시", () => {
    const { a } = run();
    return !a.courtChangeDone && a.courtChangeFailed === true ? true : json({ done: a.courtChangeDone, failed: a.courtChangeFailed });
  });
  guard("D3-fix28 2 한쪽에 벽이 있으면 성공하고 벽이 상대 편으로 넘어간다", () => {
    const { a, st } = run((s) => { s.sideA.screens = { reflect: 4 }; });
    return a.courtChangeDone === true && !a.courtChangeFailed && st.sideB.screens.reflect !== undefined && st.sideA.screens.reflect === undefined ? true : json({ done: a.courtChangeDone, failed: a.courtChangeFailed, a: st.sideA.screens, b: st.sideB.screens });
  });
  guard("D3-fix28 3 한쪽에 설치물(스텔스록)만 있어도 성공한다", () => {
    const { a, st } = run((s) => { s.sideB.hazards = { ...s.sideB.hazards, stealthRock: true }; });
    return a.courtChangeDone === true && !a.courtChangeFailed && st.sideA.hazards.stealthRock === true ? true : json({ done: a.courtChangeDone, failed: a.courtChangeFailed, a: st.sideA.hazards });
  });
  guard("D3-fix28 4 순풍만 있어도 성공한다", () => {
    const { a, st } = run((s) => { s.sideA.tailwindTurnsRemaining = 3; });
    return a.courtChangeDone === true && !a.courtChangeFailed && st.sideB.tailwindTurnsRemaining !== undefined ? true : json({ done: a.courtChangeDone, failed: a.courtChangeFailed, b: st.sideB.tailwindTurnsRemaining });
  });
  guard("D3-fix28 5 신비의부적만 있어도 성공한다", () => {
    const { a, st } = run((s) => { s.sideB.safeguardTurnsRemaining = 3; });
    return a.courtChangeDone === true && !a.courtChangeFailed && st.sideA.safeguardTurnsRemaining !== undefined ? true : json({ done: a.courtChangeDone, failed: a.courtChangeFailed, a: st.sideA.safeguardTurnsRemaining });
  });
  guard("D3-fix28 6 바꿀 효과가 있는 쪽이 양쪽 다여도(맞교환) 성공한다", () => {
    const { a } = run((s) => { s.sideA.screens = { lightScreen: 4 }; s.sideB.tailwindTurnsRemaining = 2; });
    return a.courtChangeDone === true && !a.courtChangeFailed ? true : json({ done: a.courtChangeDone, failed: a.courtChangeFailed });
  });
}
