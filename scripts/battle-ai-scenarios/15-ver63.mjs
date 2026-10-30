// 6.3 B1 고스트 저주: HP 1/2 소비 + 상대에게 저주(매 턴 1/4), 비고스트는 공격↑·방어↑·스피드↓
export default async function ({ server, data, ai, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.5);

  const st = battle([mon("따라큐", ["저주", "칼춤"])], [mon("하마돈", ["칼춤"])]);
  const maxA = st.a.maxHp;
  const maxB = st.b.maxHp;
  const t1 = run(st, "저주", "칼춤");
  const a1 = t1.nextState.a;
  const b1 = t1.nextState.b;
  check(
    "6.3 B1 고스트 저주: 사용자 HP 1/2 소비 + 상대 저주 상태 + 턴 종료 1/4 피해",
    a1.currentHp === maxA - Math.floor(maxA / 2) && !!b1.volatile.active.curse && b1.currentHp === maxB - Math.floor(maxB / 4),
    `A ${a1.currentHp}/${maxA} B ${b1.currentHp}/${maxB} curse ${!!b1.volatile.active.curse}`,
  );
  check("6.3 B1 고스트 저주: 사용자 랭크는 변하지 않는다", a1.stages.atk === 0 && a1.stages.def === 0 && a1.stages.spe === 0);

  const t2 = run(t1.nextState, "저주", "칼춤");
  check(
    "6.3 B1 이미 저주 상태인 상대에겐 실패 — HP 소비 없음",
    t2.nextState.a.currentHp === a1.currentHp && t2.result.actions[0].curseSetFailed === true,
    `${a1.currentHp} → ${t2.nextState.a.currentHp}`,
  );

  const guard = battle([mon("따라큐", ["저주"])], [mon("하마돈", ["칼춤"])]);
  guard.b.effectiveAbilityId = "매직가드";
  const g1 = run(guard, "저주", "칼춤");
  check("6.3 B1 매직가드는 저주 턴 종료 피해 면제", g1.nextState.b.currentHp === maxB && !!g1.nextState.b.volatile.active.curse);

  const sub = battle([mon("따라큐", ["저주"])], [mon("하마돈", ["칼춤"])]);
  sub.b.substituteHp = 50;
  check("6.3 B1 저주는 대타를 통과한다", !!run(sub, "저주", "칼춤").nextState.b.volatile.active.curse);

  const plain = battle([mon("하마돈", ["저주"])], [mon("갸라도스", ["칼춤"])]);
  const p1 = run(plain, "저주", "칼춤").nextState;
  check(
    "6.3 B1 비고스트 저주: 공격↑ 방어↑ 스피드↓, 상대 저주 없음, HP 소비 없음",
    p1.a.stages.atk === 1 && p1.a.stages.def === 1 && p1.a.stages.spe === -1 && !p1.b.volatile.active.curse && p1.a.currentHp === plain.a.maxHp,
    JSON.stringify(p1.a.stages),
  );

  // AI: 고스트 저주를 평가에 넣어도 정상 선택(만 HP 따라큐가 버리는 선택지가 아니어야 한다는 가정은 두지 않는다)
  const aiSt = battle([mon("따라큐", ["저주", "칼춤"])], [mon("하마돈", ["칼춤"])]);
  const d = ai.chooseAiAction(aiSt, "a", 0.5);
  check("6.3 B1 AI가 고스트 저주를 포함해도 정상 선택", d.action.kind === "move" && d.scored.every((s) => Number.isFinite(s.score) || s.score === Infinity), d.scored.map((s) => s.score).join(","));
}
