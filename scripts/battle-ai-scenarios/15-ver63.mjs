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
  // ── B2 미배선 감사 수정 ──
  const hpLoss = (st, a, b, key = "b") => st[key].currentHp - run(st, a, b).nextState[key].currentHp;
  const idle = "칼춤";
  {
    // 확률 부가효과(A): 난수 0이면 발동, 1에 가까우면 불발
    const rngRun = (st, a, b, r) => rt.runTurn(st, act(a), act(b), () => r).nextState;
    const cm = rngRun(battle([mon("한카리아스", ["코멧펀치"])], [mon("하마돈", [idle])]), "코멧펀치", idle, 0.01);
    check("6.3 B2 코멧펀치 20% 공격↑ 발동", cm.a.stages.atk === 1, String(cm.a.stages.atk));
    const cm2 = rngRun(battle([mon("한카리아스", ["코멧펀치"])], [mon("하마돈", [idle])]), "코멧펀치", idle, 0.99);
    check("6.3 B2 코멧펀치 불발 시 랭크 그대로", cm2.a.stages.atk === 0);
    const ss = rngRun(battle([mon("한카리아스", ["스톤샤워"])], [mon("하마돈", [idle])]), "스톤샤워", idle, 0.01);
    check("6.3 B2 스톤샤워 풀죽음 필드 연결(발동 확률 굴림)", ss.b.currentHp < ss.b.maxHp);
  }
  {
    // 병상첨병: 상대가 상태이상이면 위력 2배
    const clean = battle([mon("따라큐", ["병상첨병"])], [mon("하마돈", [idle])]);
    const sick = battle([mon("따라큐", ["병상첨병"])], [mon("하마돈", [idle])]);
    sick.b.status = { condition: "paralysis", turnsElapsed: 0 };
    check("6.3 B2 병상첨병: 상태이상 상대에게 더 큰 데미지", hpLoss(sick, "병상첨병", idle) > hpLoss(clean, "병상첨병", idle) * 1.5);
  }
  {
    // 탁쳐서떨구기: 도구 떨어뜨림 + 위력 1.5배(도구 있을 때)
    const withItem = battle([mon("한카리아스", ["탁쳐서떨구기"])], [mon("하마돈", [idle], null, "먹다남은음식")]);
    const noItem = battle([mon("한카리아스", ["탁쳐서떨구기"])], [mon("하마돈", [idle])]);
    const r = run(withItem, "탁쳐서떨구기", idle);
    check("6.3 B2 탁쳐서떨구기: 도구를 떨어뜨린다", r.nextState.b.currentItemId === null && r.result.actions[0].itemEffect?.kind === "knockOff");
    check("6.3 B2 탁쳐서떨구기: 도구 있으면 위력 ↑", hpLoss(withItem, "탁쳐서떨구기", idle) > hpLoss(noItem, "탁쳐서떨구기", idle));
  }
  {
    const st = battle([mon("한카리아스", ["도둑질"])], [mon("하마돈", [idle], null, "먹다남은음식")]);
    const r = run(st, "도둑질", idle);
    check("6.3 B2 도둑질: 상대 도구를 빼앗는다", r.nextState.a.currentItemId === "먹다남은음식" && r.nextState.b.currentItemId === null);
    const holding = battle([mon("한카리아스", ["도둑질"], null, "자뭉열매")], [mon("하마돈", [idle], null, "먹다남은음식")]);
    check("6.3 B2 도둑질: 자신이 도구를 지니면 못 훔친다", run(holding, "도둑질", idle).nextState.b.currentItemId === "먹다남은음식");
    const sticky = battle([mon("한카리아스", ["도둑질"])], [mon("하마돈", [idle], "점착", "먹다남은음식")]);
    check("6.3 B2 도둑질: 점착이면 못 훔친다", run(sticky, "도둑질", idle).nextState.b.currentItemId === "먹다남은음식");
  }
  {
    const st = battle([mon("한카리아스", ["벌레먹기"])], [mon("하마돈", [idle], null, "자뭉열매")]);
    st.a.currentHp = Math.floor(st.a.maxHp / 4);
    const hp0 = st.a.currentHp;
    const r = run(st, "벌레먹기", idle);
    check("6.3 B2 벌레먹기: 상대 열매를 먹어 효과를 받는다", r.nextState.b.currentItemId === null && r.nextState.a.currentHp > hp0 && r.result.actions[0].itemEffect?.kind === "eatBerry");
  }
  {
    const st = battle([mon("한카리아스", ["클리어스모그"])], [mon("하마돈", [idle])]);
    st.b.stages = { ...st.b.stages, atk: 2 };
    st.a.stages = { ...st.a.stages, atk: 1 };
    const r = run(st, "클리어스모그", "하품").nextState;
    check("6.3 B2 클리어스모그: 상대 랭크만 초기화", r.b.stages.atk === 0 && r.a.stages.atk === 1, `${r.b.stages.atk} / ${r.a.stages.atk}`);
  }
  {
    const none = battle([mon("따라큐", ["폴터가이스트"])], [mon("하마돈", [idle])]);
    const has = battle([mon("따라큐", ["폴터가이스트"])], [mon("하마돈", [idle], null, "먹다남은음식")]);
    check("6.3 B2 폴터가이스트: 도구 없으면 실패, 있으면 성공", run(none, "폴터가이스트", idle).result.actions[0].blockedReason === "usageCondition" && hpLoss(has, "폴터가이스트", idle) > 0);
  }
  {
    const hit = battle([mon("한카리아스", ["기선제압"])], [mon("하마돈", ["전광석화"])]);
    const miss = battle([mon("한카리아스", ["기선제압"])], [mon("하마돈", [idle])]);
    check(
      "6.3 B2 기선제압: 선제기에만 성공, 아니면 실패",
      hpLoss(hit, "기선제압", "전광석화") > 0 && run(miss, "기선제압", idle).result.actions[0].blockedReason === "usageCondition",
    );
  }
  {
    // 상대가 먼저 움직여 능력을 올린 턴에만 혼란(내가 느리게)
    const slow = (b) => { const st = battle([mon("따라큐", ["매혹의보이스"])], [mon("하마돈", [b])]); st.a.stages = { ...st.a.stages, spe: -6 }; return st; };
    const risen = run(slow(idle), "매혹의보이스", idle).nextState.b;
    const calm = run(slow("하품"), "매혹의보이스", "하품").nextState.b;
    check("6.3 B2 매혹의보이스: 능력이 오른 상대만 혼란", !!risen.volatile.active.confusion && !calm.volatile.active.confusion);
  }
  {
    const st = battle([mon("따라큐", ["돌림노래"])], [mon("하마돈", [idle])]);
    const t1 = run(st, "돌림노래", idle);
    const d1 = st.b.currentHp - t1.nextState.b.currentHp;
    const d2 = t1.nextState.b.currentHp - run(t1.nextState, "돌림노래", idle).nextState.b.currentHp;
    check("6.3 B2 돌림노래: 연속 사용 시 데미지 증가", d2 > d1 * 1.5, `${d1} → ${d2}`);
  }
  // 회복봉인·소리 봉인·미래예지
  {
    const st = battle([mon("따라큐", ["사이코노이즈"])], [mon("하마돈", ["HP회복"], null, "먹다남은음식")]);
    st.b.currentHp = Math.floor(st.b.maxHp / 2);
    const t1 = run(st, "사이코노이즈", "HP회복");
    check(
      "6.3 B2 사이코노이즈: 회복봉인(상대가 같은 턴 HP회복·먹다남은음식 못 받음)",
      !!t1.nextState.b.volatile.active.healBlock && t1.nextState.b.currentHp < st.b.currentHp,
      `${st.b.currentHp} → ${t1.nextState.b.currentHp}`,
    );
    const t2 = run(t1.nextState, "사이코노이즈", "HP회복");
    check("6.3 B2 회복봉인 중 HP회복은 사용 불가", t2.result.actions.some((a) => a.blockedReason === "moveRestricted" && a.moveRestrictionKind === "healBlock"));
    const t3 = run(t2.nextState, "사이코노이즈", idle);
    const t4 = run(t3.nextState, idle, idle);
    check("6.3 B2 회복봉인은 2턴 뒤 풀린다(재감염 없이)", !t4.nextState.b.volatile.active.healBlock);
  }
  {
    const st = battle([mon("한카리아스", ["지옥찌르기"])], [mon("하마돈", ["하이퍼보이스", "칼춤"])]);
    const t1 = run(st, "지옥찌르기", idle);
    const t2 = rt.runTurn(t1.nextState, act("지옥찌르기"), act("하이퍼보이스"), () => 0.5);
    check(
      "6.3 B2 지옥찌르기: 맞은 상대는 소리 기술 사용 불가",
      !!t1.nextState.b.volatile.active.throatChop && t2.result.actions.some((a) => a.blockedReason === "moveRestricted" && a.moveRestrictionKind === "throatChop"),
    );
  }
  {
    const st = battle([mon("따라큐", ["미래예지"])], [mon("하마돈", [idle])]);
    const hp0 = st.b.currentHp;
    const t1 = run(st, "미래예지", idle);
    const t2 = run(t1.nextState, idle, idle);
    const t3 = run(t2.nextState, idle, idle);
    check(
      "6.3 B2 미래예지: 쓴 턴·다음 턴엔 데미지 없고 2턴 뒤 턴 종료에 맞는다",
      t1.result.actions[0].futureSightSet === true && t1.nextState.b.currentHp === hp0 && t2.nextState.b.currentHp === hp0 && t3.nextState.b.currentHp < hp0,
      `${hp0} → ${t1.nextState.b.currentHp}, ${t2.nextState.b.currentHp}, ${t3.nextState.b.currentHp} `,
    );
    const again = run(t1.nextState, "미래예지", idle);
    check("6.3 B2 미래예지: 이미 예약돼 있으면 실패", again.result.actions[0].futureSightFailed === true);
  }
}
