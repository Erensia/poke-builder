// 7.3 B2 방어/판별/킹실드류: 내가 이번 턴 마지막에 행동하면(상대가 교체했거나, 방어끼리 겹쳐 우선도 +4 속도 순서에서 늦을 때) 사용 이펙트 없이 실패하고
// 연속 횟수가 0으로 돌아가 다음 턴 방어는 확정 성공한다. (8.3 A5: 버티기·패스트가드도 같은 조건으로 실패 — `22-ver83-a5.mjs`. 길동무만 그대로.)
export default async function ({ server, data, ev, opt, mon, battle, pts, check }) {
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

  // 8.3 A5(R7 재확정): 버티기도 마지막 행동이면 실패한다(Showdown endure.onPrepareHit). 길동무는 늦게 움직여도 그대로 발동
  const slowEndure = rt.runTurn(battle(slowGuard(), foe()), move("버티기"), move("방어"), rng);
  check("7.3 B2 → 8.3 A5: 버티기는 상대 방어보다 늦게 움직이면 실패(연속 횟수 0)", !slowEndure.nextState.a.activeProtect && slowEndure.nextState.a.protectStreak === 0, `${slowEndure.nextState.a.activeProtect?.effect} streak=${slowEndure.nextState.a.protectStreak}`);
  const slowBond = rt.runTurn(battle(slowGuard(), foe()), move("길동무"), move("지진"), rng);
  check("7.3 B2 길동무는 늦게 움직여도 그대로 발동", slowBond.result.actions.find(mine).protectSucceeded === true,`succeeded=${slowBond.result.actions.find(mine)?.protectSucceeded}`);
  // 7.3 B3 풀피 멀티스케일은 다단히트의 첫 타만 반감한다(둘째 타부터는 HP가 깎여 풀 데미지)
  const hitsOf = (ability, prepare) => {
    const st = battle([mon("한카리아스", ["스케일샷"], null, null, pts({ atk: 32, spe: 32 }))], [mon("망나뇽", ["날개쉬기"], ability, null, pts({ hp: 32 }))]);
    prepare?.(st);
    const out = rt.runTurn(st, move("스케일샷"), move("날개쉬기"), () => 0.5);
    return out.result.actions.find(mine).hits.map((h) => h.damagePercent);
  };
  const fmt = (hits) => hits.map((x) => (x * 100).toFixed(1)).join("/");
  const ms = hitsOf("멀티스케일");
  const plain = hitsOf("정신력");
  const hurt = hitsOf("멀티스케일", (st) => { st.b.currentHp = st.b.maxHp - 1; });
  const near = (x, y) => Math.abs(x - y) / y < 0.1;
  check("7.3 B3 멀티스케일: 풀피 첫 타만 반감(둘째 타는 반감 없음)", ms.length >= 2 && near(ms[0] * 2, plain[0]) && near(ms[1], plain[1]), `멀티스케일 ${fmt(ms)} 일반 ${fmt(plain)}`);
  check("7.3 B3 멀티스케일: HP가 깎여 있으면 첫 타부터 반감 없음", hurt.length >= 2 && near(hurt[0], plain[0]) && near(hurt[1], plain[1]), fmt(hurt));
  // 7.3 B3 계산기·AI 조각: 멀티스케일은 첫 타만 반감(firstHitFinalMultiplier), 둘째 타부터는 풀 데미지
  const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const df = await server.ssrLoadModule("/src/lib/damageFormula.ts");
  const calcHits = (ability, o) => {
    const st = battle([mon("한카리아스", ["스케일샷"], null, null, pts({ atk: 32, spe: 32 }))], [mon("망나뇽", ["날개쉬기"], ability, null, pts({ hp: 32 }))]);
    const res = me.evaluateSlotMatchup(st.a.slot, data.getMove("스케일샷"), st.b.slot, { multiHitCount: 3, ...o });
    const p = res.damageParts;
    return p.hitPowers.map((power, i) => df.integerHitDamage(p, power, res.defenseStat, 1, i === 0, p.firstHitFinalMultiplier ?? 1));
  };
  const cMs = calcHits("멀티스케일");
  const cPlain = calcHits("정신력");
  const cHurt = calcHits("멀티스케일", { defenderHpIsFull: false });
  check("7.3 B3 계산기: 멀티스케일 풀피 가정 → 첫 타만 반감(3타)", cMs.length === 3 && near(cMs[0] * 2, cPlain[0]) && near(cMs[1], cPlain[1]) && near(cMs[2], cPlain[2]), `멀티스케일 ${cMs.join("/")} 일반 ${cPlain.join("/")}`);
  check("7.3 B3 계산기: HP가 깎인 가정이면 첫 타부터 반감 없음", near(cHurt[0], cPlain[0]) && near(cHurt[1], cPlain[1]), cHurt.join("/"));
  // 7.3 B3 AI: 멀티스케일 상대에게 다단히트가 전 타 반감으로 평가되지 않는다(첫 타만 반감)
  const aiHits = (ability) => {
    const st = battle([mon("한카리아스", ["스케일샷"], null, null, pts({ atk: 32, spe: 32 }))], [mon("망나뇽", ["날개쉬기"], ability, null, pts({ hp: 32 }))]);
    return opt(ev.evaluateOptions(st, "a"), "스케일샷").hitsToKill.expected;
  };
  const aiMs = aiHits("멀티스케일");
  const aiPlain = aiHits("정신력");
  check("7.3 B3 AI: 멀티스케일 풀피 상대의 스케일샷 기대 횟수가 전 타 반감(약 2배)이 아니다", aiMs >= aiPlain && aiMs < aiPlain * 1.35, `멀티스케일 ${aiMs.toFixed(2)} 일반 ${aiPlain.toFixed(2)}`);
  // 7.3 B4 먼저 움직인 쪽이 자기 반동으로 쓰러져도, 뒤에 행동하는 쪽의 자기 대상·필드 기술은 실행되고 쓰러진 상대를 노리는 기술은 "실패"로 기록된다
  const faintTurn = (foeMove) => {
    const st = battle([mon("따라큐", ["우드해머"], null, "생명의구슬", pts({ atk: 32, spe: 32 }))], [mon("갑주무사", [foeMove], null, null, pts({ hp: 32 }))]);
    st.a.currentHp = 3; // 우드해머·생명의구슬 반동으로 쓰러진다
    const out = rt.runTurn(st, move("우드해머"), move(foeMove), () => 0.5);
    const res = out.result ?? out.partialResult;
    return { fainted: out.nextState.a.currentHp === 0, foeAction: res.actions.find((a) => a.actor === "b"), foe: out.nextState.b };
  };
  const dance = faintTurn("칼춤");
  check("7.3 B4 반동으로 쓰러진 턴에도 상대의 자기 대상 기술(칼춤)은 실행된다", dance.fainted && !!dance.foeAction && !dance.foeAction.blockedReason && dance.foe.stages.atk === 2, `기절=${dance.fainted} 행동=${!!dance.foeAction} 공격랭크=${dance.foe.stages.atk}`);
  const rocks = faintTurn("스텔스록");
  check("7.3 B4 필드 기술(스텔스록)도 실행된다", rocks.fainted && !!rocks.foeAction && !rocks.foeAction.blockedReason, `기절=${rocks.fainted} 행동=${!!rocks.foeAction} 사유=${rocks.foeAction?.blockedReason}`);
  for (const id of ["불꽃펀치", "독가루", "변신", "파워스왑"]) {
    const r = faintTurn(id);
    check(`7.3 B4 쓰러진 상대를 노리는 기술(${id})은 실패로 기록되고 효과가 없다`, r.fainted && r.foeAction?.blockedReason === "usageCondition" && r.foe.stages.atk === 0 && !r.foe.transformed, `기절=${r.fainted} 사유=${r.foeAction?.blockedReason} 랭크=${r.foe.stages.atk}`);
  }
}
