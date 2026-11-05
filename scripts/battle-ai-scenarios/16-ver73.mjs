// 7.3 B2 방어/판별/킹실드류: 내가 이번 턴 마지막에 행동하면(상대가 교체했거나, 방어끼리 겹쳐 우선도 +4 속도 순서에서 늦을 때) 사용 이펙트 없이 실패하고
// 연속 횟수가 0으로 돌아가 다음 턴 방어는 확정 성공한다. 버티기·길동무·패스트가드는 그대로.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const move = (id) => ({ kind: "move", move: data.getMove(id) });
  const rng = () => 0.99; // 연속 사용 확률 1(streak 0)은 통과, 그 미만은 실패
  const mine = (a) => a.actor === "a";
  const guard = () => [mon("킬가르도", ["방어", "판별", "킹실드", "버티기", "길동무"], null, null, pts({ hp: 32, spe: 32 }))];
  const slowGuard = () => [mon("킬가르도", ["방어", "판별", "킹실드", "버티기", "길동무"], null, null, pts({ hp: 32 }))];
  const foe = () => [mon("한카리아스", ["지진", "방어"], null, null, pts({ atk: 32, spe: 32 })), mon("핫삼", ["지진"])];

  for (const id of ["방어", "판별", "킹실드"]) {
    // 상대가 교체한 턴: 실패(태세 진입 없음), 연속 횟수 0 → 다음 턴 확정 성공
    const t1 = rt.runTurn(battle(guard(), foe()), move(id), { kind: "switch", toIndex: 1 }, rng);
    const a1 = t1.result.actions.find(mine);
    check(
      `7.3 B2 ${id}: 상대가 교체한 턴 → 실패(태세 없음)·연속 횟수 0`,
      a1.protectFailed === true && !a1.protectStanceEntered && !a1.protectSucceeded && !t1.nextState.a.activeProtect && t1.nextState.a.protectStreak === 0,
      `failed=${a1.protectFailed} stance=${a1.protectStanceEntered} streak=${t1.nextState.a.protectStreak}`,
    );
    const t2 = rt.runTurn(t1.nextState, move(id), move("지진"), rng);
    const a2 = t2.result.actions.find(mine);
    check(`7.3 B2 ${id}: 실패 다음 턴 방어는 확정 성공`, a2.protectSucceeded === true && t2.nextState.a.protectStreak === 1, `succeeded=${a2.protectSucceeded} streak=${t2.nextState.a.protectStreak}`);

    // 상대도 우선도 +4 방어를 써서 내가 더 늦게 움직이는 턴: 실패. 공격하는 상대보다 먼저 움직이면 성공
    const slow = rt.runTurn(battle(slowGuard(), foe()), move(id), move("방어"), rng);
    const aSlow = slow.result.actions.find(mine);
    check(`7.3 B2 ${id}: 우선도가 같고 내가 더 늦게 움직이면 실패`, aSlow.protectFailed === true && !aSlow.protectStanceEntered && slow.nextState.a.protectStreak === 0, `failed=${aSlow.protectFailed} streak=${slow.nextState.a.protectStreak}`);
    const fast = rt.runTurn(battle(guard(), [mon("한카리아스", ["지진"], null, null, pts({ atk: 32 }))]), move(id), move("지진"), rng);
    const aFast = fast.result.actions.find(mine);
    check(`7.3 B2 ${id}: 내가 먼저 움직이면 상대 공격을 막아 성공`, aFast.protectSucceeded === true && !aFast.protectFailed, `succeeded=${aFast.protectSucceeded}`);
  }

  // 대상 밖: 버티기·길동무는 늦게 움직여도 그대로 발동
  const slowEndure = rt.runTurn(battle(slowGuard(), foe()), move("버티기"), move("방어"), rng);
  check("7.3 B2 버티기는 상대 방어보다 늦게 움직여도 그대로 발동", slowEndure.nextState.a.activeProtect?.effect === "endure" && slowEndure.nextState.a.protectStreak === 1, `${slowEndure.nextState.a.activeProtect?.effect} streak=${slowEndure.nextState.a.protectStreak}`);
  const slowBond = rt.runTurn(battle(slowGuard(), foe()), move("길동무"), move("지진"), rng);
  check("7.3 B2 길동무는 늦게 움직여도 그대로 발동", slowBond.result.actions.find(mine).protectSucceeded === true,`succeeded=${slowBond.result.actions.find(mine)?.protectSucceeded}`);
}
