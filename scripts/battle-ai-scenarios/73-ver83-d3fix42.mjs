// 8.3 D3-fix-42 강제 교체(날려버리기·울부짖기)가 고스트에게도 통한다 — Showdown `forceSwitch`는 타입 상성과 무관한 효과다.
//  원인: runTurn `forceTargetSwitch`의 `typeEffectiveness !== 0`이 상태 기술에도 고스트 면역(0배)을 적용했다.
//  데미지 기술(드래곤테일·배대뒤치기)은 면역이면 안 끌려나오는 것이 맞다(회귀).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const R = (v) => () => v;
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  // 상대 b는 중립 기술(칼춤)만 쓴다 — 같은 턴 기술이 결과에 섞이지 않게. 예비 1마리(잠만보)를 둔다.
  const forcedCount = (aMon, aMove, bMon) => {
    const st = battle([mon(aMon, [aMove])], [mon(bMon, ["칼춤"]), mon("잠만보", ["하품"])]);
    const o = rt.runTurn(st, mv(aMove), mv("칼춤"), R(0.5));
    return (o.result ?? o.partialResult).switches.filter((s) => s.forced).length;
  };
  for (const [m, label] of [["날려버리기", "날려버리기"], ["울부짖기", "울부짖기"]]) {
    check(`D3-fix42 ${label} vs 따라큐(고스트·페어리): 끌려 나온다`, forcedCount("하마돈", m, "따라큐") === 1, forcedCount("하마돈", m, "따라큐"));
    check(`D3-fix42 ${label} vs 팬텀(고스트·독): 끌려 나온다`, forcedCount("하마돈", m, "팬텀") === 1, forcedCount("하마돈", m, "팬텀"));
    check(`D3-fix42 ${label} vs 일반 포켓몬(회귀): 끌려 나온다`, forcedCount("하마돈", m, "잠만보") === 1, forcedCount("하마돈", m, "잠만보"));
  }
  check("D3-fix42 배대뒤치기 vs 팬텀(격투 무효, 회귀): 끌려 나오지 않는다", forcedCount("하마돈", "배대뒤치기", "팬텀") === 0, forcedCount("하마돈", "배대뒤치기", "팬텀"));
  check("D3-fix42 드래곤테일 vs 마릴리(페어리 무효, 회귀): 끌려 나오지 않는다", forcedCount("하마돈", "드래곤테일", "마릴리") === 0, forcedCount("하마돈", "드래곤테일", "마릴리"));
  check("D3-fix42 드래곤테일 vs 일반 포켓몬(회귀): 끌려 나온다", forcedCount("하마돈", "드래곤테일", "잠만보") === 1, forcedCount("하마돈", "드래곤테일", "잠만보"));
}
