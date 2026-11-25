// 8.3 D3-fix-45 (E8-13·E8-14 + 검수 R1·Q1) 매직미러 반사와 대타·면역의 순서, 대타를 무시하는 기술(bypasssub).
//  Showdown: 방어류 → 매직미러 → 황금몸·방음·방탄 → 가루 면역 → 대타. 반사는 반사한 쪽이 원래 사용자에게 기술을 새로 쓰는 것이라 사용자의 대타·면역이 다시 판정된다.
//  대타를 무시하는 기준은 소리가 아니라 `bypasssub`(소리 + 비소리 28종 — Move.bypassesSubstitute). 설계 `8.3-D3-fix45-매직미러대타설계.md` §4.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const pre = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
  const sm = await server.ssrLoadModule("/src/lib/battle/ai/statusMoveEffects.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const play = (st, a, b = "칼춤") => { try { return rt.runTurn(st, mv(a), mv(b), () => 0.5); } catch { return null; } };
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const forcedSides = (o) => ((o?.result ?? o?.partialResult)?.switches ?? []).filter((s) => s.forced).map((s) => s.side).join("");
  const act = (o, key = "a") => (o?.result ?? o?.partialResult)?.actions.find((x) => x.actor === key);
  // a: 사용자(+예비), b: 방어측(기본 에브이 매직미러 + 예비). 사용자 대타 aSub, 방어측 대타 bSub(HP 50).
  const mk = ({ user = "하마돈", userAbility = null, move = "독가루", bPoke = "에브이", bAbility = "매직미러", aSub = false, bSub = false } = {}) => {
    const st = battle([mon(user, [move], userAbility, null, bulky), mon("잠만보", ["칼춤"])], [mon(bPoke, ["칼춤"], bAbility, null, bulky), mon("잠만보", ["칼춤"])]);
    if (aSub) st.a.substituteHp = 50;
    if (bSub) st.b.substituteHp = 50;
    return st;
  };
  const stat = (f) => f?.status?.condition ?? null;

  // ── 1~3 (E8-13) 반사된 독가루·도깨비불·뒤집어엎기는 사용자 대타에 막힌다 ──
  for (const [n, m] of [[1, "독가루"], [2, "도깨비불"]]) {
    const o = play(mk({ move: m, aSub: true }), m);
    check(`D3-fix45 ${n}: ${m} 반사 + 사용자 대타 → 상태 없음·대타 HP 유지`, stat(o?.nextState.a) === null && o?.nextState.a.substituteHp === 50, `a=${stat(o?.nextState.a)} sub=${o?.nextState.a.substituteHp}`);
  }
  {
    const st = mk({ move: "뒤집어엎기", aSub: true }); st.a.stages = { ...st.a.stages, def: -1 };
    const o = play(st, "뒤집어엎기");
    check("D3-fix45 3: 뒤집어엎기 반사 + 사용자 대타 → 사용자 def 그대로(−1)", o?.nextState.a.stages.def === -1, `def=${o?.nextState.a.stages.def}`);
  }
  // ── 4 대조: 사용자 대타 없음 → 반사돼 그대로 적용 ──
  {
    const p = play(mk({ move: "독가루" }), "독가루"), w = play(mk({ move: "도깨비불" }), "도깨비불");
    const st = mk({ move: "뒤집어엎기" }); st.a.stages = { ...st.a.stages, def: -1 };
    const t = play(st, "뒤집어엎기");
    check("D3-fix45 4: 대조(사용자 대타 없음) → 중독·화상·랭크 뒤집힘", stat(p?.nextState.a) === "poison" && stat(w?.nextState.a) === "burn" && t?.nextState.a.stages.def === 1, `${stat(p?.nextState.a)} ${stat(w?.nextState.a)} def=${t?.nextState.a.stages.def}`);
  }
  // ── 5 날려버리기·울부짖기: 사용자 대타 O → 대타 무시하고 사용자가 끌려 나옴 ──
  for (const m of ["날려버리기", "울부짖기"]) {
    const o = play(mk({ move: m, aSub: true }), m);
    check(`D3-fix45 5: ${m} 반사 + 사용자 대타 → 대타를 무시하고 사용자(a)가 끌려 나옴`, forcedSides(o) === "a", forcedSides(o));
  }
  // ── 6 스텔스록: 사용자 대타 O → 사용자 편 설치 / 7 싫은소리: 사용자 def −2 ──
  {
    const o = play(mk({ user: "잠만보", move: "스텔스록", aSub: true }), "스텔스록");
    check("D3-fix45 6: 스텔스록 반사 + 사용자 대타 → 사용자 편에 설치(대타 무관)", o?.nextState.sideA.hazards.stealthRock === true, String(o?.nextState.sideA.hazards.stealthRock));
    const s = play(mk({ move: "싫은소리", aSub: true }), "싫은소리");
    check("D3-fix45 7: 싫은소리 반사 + 사용자 대타 → 사용자 def −2(소리는 대타 무시)", s?.nextState.a.stages.def === -2, `def=${s?.nextState.a.stages.def}`);
  }
  // ── 8 사용자의 틈새포착은 반사에 끼어들지 못한다(반사된 기술은 반사한 쪽이 쓴다) ──
  {
    const o = play(mk({ move: "독가루", userAbility: "틈새포착", aSub: true }), "독가루");
    check("D3-fix45 8: 사용자 틈새포착 + 대타 → 독가루 반사돼도 사용자 대타가 막음", stat(o?.nextState.a) === null && o?.nextState.a.substituteHp === 50, `a=${stat(o?.nextState.a)}`);
  }
  // ── 9 (E8-14) 반사하는 쪽만 대타여도 반사된다 ──
  for (const [m, s] of [["독가루", "poison"], ["도깨비불", "burn"]]) {
    const o = play(mk({ move: m, bSub: true }), m);
    check(`D3-fix45 9: ${m} vs 매직미러 쪽만 대타 → 반사돼 사용자가 ${s}, 매직미러 쪽 대타 유지`, stat(o?.nextState.a) === s && stat(o?.nextState.b) === null && o?.nextState.b.substituteHp === 50, `a=${stat(o?.nextState.a)} b=${stat(o?.nextState.b)} bSub=${o?.nextState.b.substituteHp}`);
  }
  // ── 10 양쪽 대타 → 사용자 대타가 막음 ──
  {
    const o = play(mk({ move: "독가루", aSub: true, bSub: true }), "독가루");
    check("D3-fix45 10: 양쪽 대타 → 사용자 상태 없음·양쪽 대타 유지", stat(o?.nextState.a) === null && o?.nextState.a.substituteHp === 50 && o?.nextState.b.substituteHp === 50, `a=${stat(o?.nextState.a)}`);
  }
  // ── 11 날려버리기, 매직미러 쪽만 대타 → 반사돼 사용자가 끌려 나옴(R2) / 11b·c·d 반사하는 쪽만 대타 ──
  {
    const o = play(mk({ move: "날려버리기", bSub: true }), "날려버리기");
    check("D3-fix45 11: 날려버리기 vs 매직미러 쪽만 대타 → 반사돼 사용자(a)가 끌려 나옴", forcedSides(o) === "a", forcedSides(o));
    const h = play(mk({ user: "잠만보", move: "스텔스록", bSub: true }), "스텔스록");
    check("D3-fix45 11b: 스텔스록 vs 매직미러 쪽만 대타 → 사용자 편 설치", h?.nextState.sideA.hazards.stealthRock === true, String(h?.nextState.sideA.hazards.stealthRock));
    const t = play(mk({ move: "도발", bSub: true }), "도발");
    check("D3-fix45 11c: 도발 vs 매직미러 쪽만 대타 → 사용자가 도발에 걸림", !!t?.nextState.a.volatile.active.taunt, JSON.stringify(t?.nextState.a.volatile.active));
    const s = play(mk({ move: "싫은소리", bSub: true }), "싫은소리");
    check("D3-fix45 11d: 싫은소리 vs 매직미러 쪽만 대타 → 사용자 def −2", s?.nextState.a.stages.def === -2, `def=${s?.nextState.a.stages.def}`);
  }
  // ── 12 대조: 매직미러 아님 + 방어측 대타 → 독가루 막힘·반사 없음 ──
  {
    const o = play(mk({ move: "독가루", bAbility: null, bPoke: "잠만보", bSub: true }), "독가루");
    check("D3-fix45 12: 매직미러 아님 + 방어측 대타 → 독가루 막힘(반사 없음, 양쪽 상태 없음)", stat(o?.nextState.a) === null && stat(o?.nextState.b) === null && !act(o)?.bouncedMoveName, `a=${stat(o?.nextState.a)} b=${stat(o?.nextState.b)}`);
  }
  // ── 13 로그 ──
  {
    const blocked = act(play(mk({ move: "독가루", aSub: true }), "독가루"));
    const onlyB = act(play(mk({ move: "독가루", bSub: true }), "독가루"));
    check("D3-fix45 13: 사용자 대타가 막은 반사 → bouncedMoveName+blockedBySubstituteMoveName / 반사하는 쪽만 대타 → bouncedMoveName만", !!blocked?.bouncedMoveName && !!blocked?.blockedBySubstituteMoveName && !!onlyB?.bouncedMoveName && !onlyB?.blockedBySubstituteMoveName, JSON.stringify({ blocked: [blocked?.bouncedMoveName, blocked?.blockedBySubstituteMoveName], onlyB: [onlyB?.bouncedMoveName, onlyB?.blockedBySubstituteMoveName] }));
  }
  // ── 14 단위: 공용 함수 ──
  {
    const target = { substituteHp: 50 };
    const f = pre.substituteBlocksMove;
    const g = (name, ability) => typeof f === "function" && f(data.getMove(name), ability, target);
    const infil = data.getAbility ? data.getAbility("틈새포착") : undefined;
    const ok = typeof f === "function" && g("독가루") === true && g("싫은소리") === false && g("도발") === false && g("트집") === false && g("독가루", infil) === false && f(data.getMove("독가루"), undefined, { substituteHp: undefined }) === false;
    check("D3-fix45 14a: substituteBlocksMove — 독가루+대타 true · 싫은소리(소리)·도발·트집(bypassesSubstitute)·틈새포착 false · 대타 없으면 false", ok, typeof f === "function" ? [g("독가루"), g("싫은소리"), g("도발"), g("트집"), g("독가루", infil)].join(",") : "함수 없음");
    const bf = pre.opponentEffectBlockers;
    check("D3-fix45 14b: opponentEffectBlockers — 대타·풀 타입 가루·방음 소리·황금몸 변화기를 사유별로 돌려준다", typeof bf === "function" && (() => {
      const gr = { substituteHp: undefined, types: ["풀"] }, sp = { substituteHp: undefined, types: ["노말"] };
      const ab = (n) => data.getAbility(n);
      return bf(data.getMove("수면가루"), undefined, gr, undefined).powder === true && bf(data.getMove("싫은소리"), undefined, sp, ab("방음")).soundproofAbilityName === "방음" &&
        bf(data.getMove("이상한빛"), undefined, sp, ab("황금몸")).goldBodyAbilityName === "황금몸" && bf(data.getMove("독가루"), undefined, { substituteHp: 50, types: ["노말"] }, undefined).substitute === true &&
        bf(data.getMove("독가루"), undefined, sp, undefined).any === false;
    })(), typeof bf);
  }
  // ── 15 R1 반사: 도발·트집, 사용자 대타 O → 사용자에게 걸리고 대타 유지(E8-13 단계 뒤에도 통과해야 한다) ──
  for (const [m, key] of [["도발", "taunt"], ["트집", "torment"]]) {
    const o = play(mk({ move: m, aSub: true }), m);
    check(`D3-fix45 15: ${m} 반사 + 사용자 대타 → 사용자에게 걸리고 대타 유지(bypasssub)`, !!o?.nextState.a.volatile.active[key] && o?.nextState.a.substituteHp === 50, JSON.stringify({ vol: o?.nextState.a.volatile.active, sub: o?.nextState.a.substituteHp }));
  }
  // ── 16 R1 직접: 대타 뒤 방어측(반사 없음)에게 도발·트집·사슬묶기·안개제거가 걸린다 ──
  {
    const direct = (m, prep) => { const st = mk({ move: m, bAbility: null, bPoke: "잠만보", bSub: true }); prep?.(st); return play(st, m); };
    for (const [m, key] of [["도발", "taunt"], ["트집", "torment"]]) {
      const o = direct(m);
      check(`D3-fix45 16: ${m} 직접 + 방어측 대타 → 걸리고 대타 유지(bypasssub)`, !!o?.nextState.b.volatile.active[key] && o?.nextState.b.substituteHp === 50, JSON.stringify(o?.nextState.b.volatile.active));
    }
    const dis = direct("사슬묶기", (st) => { st.b.lastMoveId = "칼춤"; });
    check("D3-fix45 16: 사슬묶기 직접 + 방어측 대타 → 칼춤이 봉인되고 대타 유지", act(dis)?.setDisabledMoveName === "칼춤" && dis?.nextState.b.substituteHp === 50, `disabled=${act(dis)?.setDisabledMoveName} failed=${act(dis)?.disableSetFailed}`);
    // 안개제거는 Showdown `bypasssub`이지만 회피 하락만 코드에서 대타를 따로 본다(`!target.volatiles["substitute"]`, 실행 확인) — 대타 뒤면 회피는 그대로, 장판 제거는 진행(fix-29). 그래서 bypassesSubstitute를 달지 않는다.
    const dfg = direct("안개제거");
    check("D3-fix45 16: 안개제거 직접 + 방어측 대타 → 회피율은 그대로(Showdown: 대타가 회피 하락만 막음, fix-29와 일치)", (dfg?.nextState.b.accuracyStages?.evasion ?? 0) === 0, JSON.stringify(dfg?.nextState.b.accuracyStages));
  }
  // ── 17 대조: 독가루 직접 + 대타 → 막힘 / 싫은소리 직접 + 대타 → def −2 ──
  {
    const p = play(mk({ move: "독가루", bAbility: null, bPoke: "잠만보", bSub: true }), "독가루");
    const s = play(mk({ move: "싫은소리", bAbility: null, bPoke: "잠만보", bSub: true }), "싫은소리");
    check("D3-fix45 17: 대조 — 독가루 직접 + 대타는 막힘, 싫은소리 직접 + 대타는 def −2", stat(p?.nextState.b) === null && s?.nextState.b.stages.def === -2, `독=${stat(p?.nextState.b)} def=${s?.nextState.b.stages.def}`);
  }
  // ── 18~20 (Q1) 반사 후 사용자 쪽 대타 외 면역 ──
  {
    const grass = play(mk({ user: "이상해꽃", move: "수면가루" }), "수면가루");
    const ctl1 = play(mk({ user: "잠만보", move: "수면가루" }), "수면가루");
    check("D3-fix45 18: 풀 타입 사용자의 수면가루가 반사돼도 사용자는 안 잠(+powderBlockedMoveName) · 대조(잠만보)는 잠", stat(grass?.nextState.a) === null && !!act(grass)?.powderBlockedMoveName && stat(ctl1?.nextState.a) === "sleep", `풀=${stat(grass?.nextState.a)} 대조=${stat(ctl1?.nextState.a)} 로그=${act(grass)?.powderBlockedMoveName}`);
    const sp = play(mk({ user: "짜랑고우거", userAbility: "방음", move: "싫은소리" }), "싫은소리");
    const ctl2 = play(mk({ user: "잠만보", move: "싫은소리" }), "싫은소리");
    check("D3-fix45 19: 방음 사용자의 싫은소리가 반사돼도 def 불변(+soundproofBlockedByAbilityName) · 대조는 def −2", sp?.nextState.a.stages.def === 0 && !!act(sp)?.soundproofBlockedByAbilityName && ctl2?.nextState.a.stages.def === -2, `방음 def=${sp?.nextState.a.stages.def} 로그=${act(sp)?.soundproofBlockedByAbilityName} 대조 def=${ctl2?.nextState.a.stages.def}`);
    const gg = play(mk({ user: "타부자고", userAbility: "황금몸", move: "이상한빛" }), "이상한빛");
    const ctl3 = play(mk({ user: "잠만보", move: "이상한빛" }), "이상한빛");
    check("D3-fix45 20: 황금몸 사용자의 이상한빛이 반사돼도 혼란 없음(+goodAsGoldBlockedByAbilityName) · 대조는 혼란", !gg?.nextState.a.volatile.active.confusion && !!act(gg)?.goodAsGoldBlockedByAbilityName && !!ctl3?.nextState.a.volatile.active.confusion, `황금몸=${JSON.stringify(gg?.nextState.a.volatile.active)} 로그=${act(gg)?.goodAsGoldBlockedByAbilityName} 대조=${!!ctl3?.nextState.a.volatile.active.confusion}`);
  }
  // ── 21 AI: 대타 뒤 상대에게 도발은 실패가 아니고 독가루는 실패(엔진과 같은 규칙) ──
  {
    const st = mk({ bAbility: null, bPoke: "잠만보", bSub: true });
    const f = sm.effectMoveFails;
    check("D3-fix45 21: effectMoveFails — 대타 뒤 상대에게 도발은 실패 아님·독가루는 실패", typeof f === "function" && f(st, "a", data.getMove("도발")) === false && f(st, "a", data.getMove("독가루")) === true, typeof f === "function" ? `${f(st, "a", data.getMove("도발"))},${f(st, "a", data.getMove("독가루"))}` : "없음");
  }
}
