// 8.3 D3-fix-46 (E8-18·E8-19·E8-20·E8-24 + 검수 R1~R5·N1·N2 + 리프가드) 상태이상 면역 묶음.
//  정화의소금 맹독 면역, 면역 사유 로그(statusBlocked), 하품은 특성·신비의부적을 즉시 막고 2턴 뒤엔 신비의부적을 안 보며,
//  잠자기는 이미 수면·풀피·수면 면역 특성·일렉트릭/미스트필드(접지)·소란이면 실패, 리프가드는 쾌청에 상태이상·하품·잠자기를 막는다.
//  설계 `8.3-D3-fix46-상태이상면역설계.md` §4.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sm = await server.ssrLoadModule("/src/lib/battle/ai/statusMoveEffects.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const play = (st, a, b = "칼춤") => { try { return rt.runTurn(st, mv(a), mv(b), () => 0.5); } catch (e) { return { err: String(e) }; } };
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const act = (o, key = "a") => (o?.result ?? o?.partialResult)?.actions.find((x) => x.actor === key);
  const stat = (f) => f?.status?.condition ?? null;
  const drowsy = (f) => !!f?.volatile?.active?.drowsy;
  // a: 사용자(하마돈 기본, 예비 잠만보), b: 대상. aAbility·bAbility는 특성 이름(null 가능).
  const mk = ({ user = "하마돈", userMoves, userAbility = null, target = "잠만보", targetAbility = null } = {}) =>
    battle([mon(user, userMoves, userAbility, null, bulky), mon("잠만보", ["칼춤"])], [mon(target, ["칼춤"], targetAbility, null, bulky), mon("잠만보", ["칼춤"])]);
  const burn = () => ({ condition: "burn", turnsElapsed: 1 });
  const half = (f) => Math.floor(f.maxHp / 2);

  // ── 1~2 (E8-18) 정화의소금 ──
  {
    const salt = play(mk({ userMoves: ["맹독"], target: "콜로솔트", targetAbility: "정화의소금" }), "맹독");
    const ctl = play(mk({ userMoves: ["맹독"], target: "잠만보" }), "맹독");
    check("D3-fix46 1: 정화의소금은 맹독도 막는다 · 대조(일반)는 맹독", stat(salt?.nextState.b) === null && stat(ctl?.nextState.b) === "badly-poisoned", `정화=${stat(salt?.nextState.b)} 대조=${stat(ctl?.nextState.b)}`);
    const all = ["독가루", "도깨비불", "전기자석파", "수면가루"].map((m) => stat(play(mk({ userMoves: [m], target: "콜로솔트", targetAbility: "정화의소금" }), m)?.nextState.b));
    check("D3-fix46 2: 정화의소금 + 독가루·도깨비불·전기자석파·수면가루 전부 면역(회귀)", all.every((s) => s === null), JSON.stringify(all));
  }
  // ── 3~9 (E8-24) 면역 사유 로그 ──
  {
    const o = play(mk({ userMoves: ["도깨비불"], target: "드닐레이브", targetAbility: "열교환" }), "도깨비불");
    const sb = act(o)?.statusBlocked;
    check("D3-fix46 3: 도깨비불 vs 열교환 → 상태 없음 + statusBlocked(ability·열교환·burn)", stat(o?.nextState.b) === null && sb?.kind === "ability" && sb?.abilityName === "열교환" && sb?.status === "burn", JSON.stringify(sb));
    const kinds = [["도깨비불", "리자몽"], ["전기자석파", "쥬피썬더"], ["독가루", "메타그로스"]].map(([m, t]) => act(play(mk({ userMoves: [m], target: t }), m))?.statusBlocked?.kind);
    check("D3-fix46 4: 도깨비불 vs 불꽃 타입·전기자석파 vs 전기 타입·독가루 vs 강철 타입 → statusBlocked.kind other", kinds.every((k) => k === "other"), JSON.stringify(kinds));
    const a1 = act(play(mk({ userMoves: ["수면가루"], target: "에브이", targetAbility: "불면" }), "수면가루"))?.statusBlocked;
    const a2 = act(play(mk({ userMoves: ["맹독"], target: "잠만보", targetAbility: "면역" }), "맹독"))?.statusBlocked;
    check("D3-fix46 5: 수면가루 vs 불면·맹독 vs 면역 → ability + 특성명", a1?.kind === "ability" && a1.abilityName === "불면" && a2?.kind === "ability" && a2.abilityName === "면역", JSON.stringify({ a1, a2 }));
    const sg = mk({ userMoves: ["도깨비불"] }); sg.sideB.safeguardTurnsRemaining = 3;
    check("D3-fix46 6: 도깨비불 vs 신비의부적 → other", act(play(sg, "도깨비불"))?.statusBlocked?.kind === "other", JSON.stringify(act(play(sg, "도깨비불"))?.statusBlocked));
    const dmg = act(play(mk({ userMoves: ["화염방사"], target: "드닐레이브", targetAbility: "열교환" }), "화염방사"));
    check("D3-fix46 7: 데미지 기술(화염방사 vs 열교환)의 부가 상태이상은 조용하다 — statusBlocked 없음", dmg?.statusBlocked === undefined, JSON.stringify(dmg?.statusBlocked));
    const al = mk({ userMoves: ["도깨비불"] }); al.b.status = burn();
    const alo = act(play(al, "도깨비불"));
    check("D3-fix46 8: 대조 — 이미 화상이면 statusInflictFailed만(statusBlocked 없음)", alo?.statusInflictFailed === true && alo?.statusBlocked === undefined, JSON.stringify({ f: alo?.statusInflictFailed, b: alo?.statusBlocked }));
    const rf = play(mk({ user: "리자몽", userMoves: ["도깨비불"], target: "에브이", targetAbility: "매직미러" }), "도깨비불");
    check("D3-fix46 9: 반사된 도깨비불 vs 불꽃 타입 사용자 → 사용자 무상태 + statusBlocked", stat(rf?.nextState.a) === null && act(rf)?.bouncedMoveName === "도깨비불" && act(rf)?.statusBlocked?.kind === "other", JSON.stringify({ a: stat(rf?.nextState.a), b: act(rf)?.statusBlocked }));
  }
  // ── 10~12 (E8-19) 하품 ──
  {
    const r = (target, ab) => { const o = play(mk({ userMoves: ["하품"], target, targetAbility: ab }), "하품"); return { dr: drowsy(o?.nextState.b), vb: act(o)?.volatileBlockedByAbility }; };
    const i = r("에브이", "불면"), s = r("콜로솔트", "정화의소금"), c = r("잠만보", null);
    check("D3-fix46 10: 하품 vs 불면·정화의소금 → 졸음 없음 + volatileBlockedByAbility(drowsy) · 대조는 졸음", !i.dr && !s.dr && i.vb?.volatile === "drowsy" && s.vb?.volatile === "drowsy" && c.dr, JSON.stringify({ i, s, c: c.dr }));
    const grass = r("이상해꽃", "플라워베일"), fairy = r("플라제스", "플라워베일");
    check("D3-fix46 11: 하품 vs 풀 타입 플라워베일 → 졸음 없음 / 페어리 보유자(플라제스) → 졸음", !grass.dr && fairy.dr, JSON.stringify({ grass: grass.dr, fairy: fairy.dr }));
    const mist = mk({ userMoves: ["하품"] }); mist.field = "미스트필드";
    let o = play(mist, "하품"); const d1 = drowsy(o?.nextState.b);
    for (let i2 = 0; i2 < 3 && o?.nextState; i2++) o = play(o.nextState, "하품");
    check("D3-fix46 12: 미스트필드(접지) 하품 → 졸음은 걸리고 끝내 잠들지 않는다(2턴 뒤 무산, 회귀)", d1 && stat(o?.nextState.b) === null, `졸음=${d1} 상태=${stat(o?.nextState.b)}`);
  }
  // ── 13~16 (E8-20) 잠자기 ──
  const rest = ({ user = "잠만보", ability = null, hp = "half", field, status, uproar = false } = {}) => {
    const st = battle([mon(user, ["잠자기"], ability, null, bulky), mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"], null, null, bulky), mon("잠만보", ["칼춤"])]);
    if (hp === "half") st.a.currentHp = half(st.a);
    if (field) st.field = field;
    if (status) st.a.status = status;
    if (uproar) st.a.sleepBlockedByUproar = true;
    const before = st.a.currentHp;
    const o = play(st, "잠자기");
    return { o, before, hp: o?.nextState.a.currentHp, st: stat(o?.nextState.a), a: act(o) };
  };
  {
    const x = rest({ ability: "불면" });
    check("D3-fix46 13: 잠자기 + 불면 → HP·상태 불변 + statusBlocked(ability·self)", x.hp === x.before && x.st === null && x.a?.statusBlocked?.kind === "ability" && x.a.statusBlocked.self === true, JSON.stringify({ hp: [x.before, x.hp], st: x.st, sb: x.a?.statusBlocked }));
    const full = rest({ hp: "full" }), elec = rest({ field: "일렉트릭필드" }), misty = rest({ field: "미스트필드" });
    const failed = (z) => z.hp === z.before && z.st === null && z.a?.statusInflictFailed === true;
    check("D3-fix46 14: 잠자기 풀피·일렉트릭필드(접지)·미스트필드(접지) → HP·상태 불변 + statusInflictFailed", failed(full) && failed(elec) && failed(misty), JSON.stringify({ full: [full.before, full.hp, full.st], elec: [elec.hp, elec.st], misty: [misty.hp, misty.st] }));
    const fly = rest({ user: "리자몽", field: "일렉트릭필드" });
    const ctl = rest({});
    check("D3-fix46 14b: 대조 — 일렉트릭필드 + 비행(비접지)은 성공 / HP 절반(일반)은 완전 회복 + 수면", fly.st === "sleep" && ctl.st === "sleep" && ctl.hp === ctl.o?.nextState.a.maxHp, JSON.stringify({ fly: fly.st, ctl: [ctl.hp, ctl.st] }));
    const burnHalf = rest({ status: burn() });
    check("D3-fix46 15: HP 절반 + 화상 + 잠자기 → 화상이 치료되고 수면(회귀)", burnHalf.st === "sleep" && burnHalf.a?.curedStatus === "burn", JSON.stringify({ st: burnHalf.st, c: burnHalf.a?.curedStatus }));
    const fullBurn = rest({ hp: "full", status: burn() });
    check("D3-fix46 16: 풀피 + 화상 + 잠자기 → 실패(화상 유지)", fullBurn.st === "burn" && fullBurn.a?.statusInflictFailed === true, JSON.stringify({ st: fullBurn.st, f: fullBurn.a?.statusInflictFailed }));
    const up = battle([mon("잠만보", ["잠자기"], null, null, pts({ hp: 32, def: 32 })), mon("잠만보", ["칼춤"])], [mon("에브이", ["소란피기"], null, null, pts({ spe: 32 })), mon("잠만보", ["칼춤"])]);
    up.a.currentHp = half(up.a);
    const uo = play(up, "잠자기", "소란피기");
    // 소란 중 잠자기는 기존 가드(preHitEffects `restSleep && sleepBlockedByUproar` → usageCondition 차단)가 이미 막는다 — 회귀로 고정
    check("D3-fix46 14c: 상대가 소란피기 중이면 잠자기 실패(기존 가드, 회귀)", stat(uo?.nextState.a) === null && !act(uo)?.restSlept, `상태=${stat(uo?.nextState.a)} restSlept=${act(uo)?.restSlept} blocked=${act(uo)?.blockedReason}`);
  }
  // ── 17 AI 공용 판정 ──
  {
    const rf = sm.restFails;
    const full = mk({ user: "잠만보", userMoves: ["잠자기"] }); full.a.status = burn();
    const ins = mk({ user: "잠만보", userMoves: ["잠자기"], userAbility: "불면" }); ins.a.currentHp = half(ins.a);
    const ok = mk({ user: "잠만보", userMoves: ["잠자기"] }); ok.a.currentHp = half(ok.a);
    check("D3-fix46 17: AI restFails — 풀피+상태이상 true · 불면 true · HP 절반 일반 false", typeof rf === "function" && rf(full, "a") === true && rf(ins, "a") === true && rf(ok, "a") === false, typeof rf === "function" ? `${rf(full, "a")},${rf(ins, "a")},${rf(ok, "a")}` : "함수 없음");
  }
  // ── 18 (R2) 잠꼬대 → 잠자기 ──
  {
    const st = battle([mon("잠만보", ["잠꼬대", "잠자기"], null, null, bulky), mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"], null, null, bulky), mon("잠만보", ["칼춤"])]);
    st.a.status = { condition: "sleep", turnsElapsed: 1 }; st.a.currentHp = half(st.a);
    const before = st.a.currentHp;
    const o = play(st, "잠꼬대");
    check("D3-fix46 18: 잠꼬대로 고른 잠자기는 이미 수면이라 실패 — HP 불변·restSlept 아님", o?.nextState.a.currentHp <= before && !act(o)?.restSlept, `hp=${before}→${o?.nextState.a.currentHp} restSlept=${act(o)?.restSlept}`);
  }
  // ── 19 (R3) 하품 vs 신비의부적: 사용 시 즉시 막힘 / 하품 후 설치는 잠든다 ──
  {
    const sg = mk({ userMoves: ["하품"] }); sg.sideB.safeguardTurnsRemaining = 3;
    const o = play(sg, "하품");
    check("D3-fix46 19: 하품 vs (이미 설치된) 신비의부적 → 즉시 막힘(졸음 없음)", !drowsy(o?.nextState.b), `졸음=${drowsy(o?.nextState.b)}`);
    let t = play(mk({ userMoves: ["하품"] }), "하품"); const dr = drowsy(t?.nextState.b);
    t.nextState.sideB.safeguardTurnsRemaining = 5;
    for (let i = 0; i < 3 && t?.nextState && stat(t.nextState.b) === null; i++) t = play(t.nextState, "칼춤");
    check("D3-fix46 19b: 하품을 건 뒤 신비의부적을 깔아도 2턴 뒤 잠든다", dr && stat(t?.nextState.b) === "sleep", `졸음=${dr} 상태=${stat(t?.nextState.b)}`);
  }
  // ── 20 리프가드 + 쾌청 ──
  {
    const sun = (m, user = "하마돈", userMoves = [m]) => { const st = mk({ user, userMoves, target: "리피아", targetAbility: "리프가드" }); st.weather = "쾌청"; st.weatherTurnsRemaining = 5; return st; };
    const yo = play(sun("하품"), "하품"), bo = play(sun("도깨비불"), "도깨비불");
    const none = mk({ userMoves: ["도깨비불"], target: "리피아", targetAbility: "리프가드" });
    const no = play(none, "도깨비불");
    check("D3-fix46 20: 리프가드 + 쾌청 → 도깨비불·하품 면역(+statusBlocked 리프가드) · 쾌청 아님 → 화상(대조)", stat(bo?.nextState.b) === null && !drowsy(yo?.nextState.b) && act(bo)?.statusBlocked?.abilityName === "리프가드" && stat(no?.nextState.b) === "burn", JSON.stringify({ bo: stat(bo?.nextState.b), yo: drowsy(yo?.nextState.b), sb: act(bo)?.statusBlocked, no: stat(no?.nextState.b) }));
    const rs = battle([mon("리피아", ["잠자기"], "리프가드", null, bulky), mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"], null, null, bulky), mon("잠만보", ["칼춤"])]);
    rs.weather = "쾌청"; rs.weatherTurnsRemaining = 5; rs.a.currentHp = half(rs.a);
    const before = rs.a.currentHp; const ro = play(rs, "잠자기");
    check("D3-fix46 20b: 리프가드 + 쾌청 → 잠자기 실패(HP·상태 불변)", ro?.nextState.a.currentHp === before && stat(ro?.nextState.a) === null, `hp=${before}→${ro?.nextState.a.currentHp} st=${stat(ro?.nextState.a)}`);
    const ex = sun("칼춤"); ex.b.status = burn(); const eo = play(ex, "칼춤");
    check("D3-fix46 20c: 리프가드는 이미 걸린 상태이상을 치료하지 않는다(쾌청이어도 화상 유지)", stat(eo?.nextState.b) === "burn", `상태=${stat(eo?.nextState.b)}`);
  }
  // ── 21 (N2) 잠자기 + 풀 타입 플라워베일(자기 자신) → 성공 ──
  {
    const x = rest({ user: "이상해꽃", ability: "플라워베일" });
    check("D3-fix46 21: 잠자기 + 풀 타입 플라워베일(자기 자신) → 성공(수면)", x.st === "sleep", `상태=${x.st}`);
  }
  // ── 22 (N1) 틀깨기·틈새포착 ──
  {
    const mb = play(mk({ userMoves: ["전기자석파"], userAbility: "틀깨기", target: "콜로솔트", targetAbility: "정화의소금" }), "전기자석파");
    check("D3-fix46 22a: 틀깨기 전기자석파 vs 정화의소금 → 마비가 걸리고 면역 로그 없음", stat(mb?.nextState.b) === "paralysis" && act(mb)?.statusBlocked === undefined, JSON.stringify({ st: stat(mb?.nextState.b), sb: act(mb)?.statusBlocked }));
    const sg = (m) => { const st = mk({ userMoves: [m], userAbility: "틈새포착" }); st.sideB.safeguardTurnsRemaining = 3; return play(st, m); };
    const bo = sg("도깨비불"), yo = sg("하품");
    check("D3-fix46 22b: 틈새포착은 신비의부적을 뚫는다 — 도깨비불 화상·하품 졸음, statusBlocked 없음", stat(bo?.nextState.b) === "burn" && drowsy(yo?.nextState.b) && act(bo)?.statusBlocked === undefined, JSON.stringify({ bo: stat(bo?.nextState.b), yo: drowsy(yo?.nextState.b) }));
  }
  // ── 23 (R4) 특성 획득 치료: 정화의소금·스위트베일은 치료하지 않는다 / 열교환은 치료 ──
  {
    const swap = (user, ab) => { const st = battle([mon(user, ["스킬스왑"], ab, null, bulky), mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"], null, null, bulky), mon("잠만보", ["칼춤"])]); st.b.status = burn(); return play(st, "스킬스왑"); };
    const salt = swap("콜로솔트", "정화의소금"), therm = swap("드닐레이브", "열교환");
    check("D3-fix46 23: 스킬스왑으로 정화의소금을 얻어도 화상 유지 · 열교환을 얻으면 화상 치료(회귀)", stat(salt?.nextState.b) === "burn" && stat(therm?.nextState.b) === null, JSON.stringify({ salt: stat(salt?.nextState.b), therm: stat(therm?.nextState.b) }));
  }
}
