// 8.3 D3-fix-47 (E8-21·E8-22 + 검수 R1~R4) 상대 방향 변화기 16종이 대타·황금몸·방어·흡수에 막힌다.
//  Showdown: 대타는 `bypasssub` 없는 기술만, 방어는 `protect` 플래그 있는 기술만(킹실드는 변화기를 막지 않음), 황금몸은 대상이 있는 변화기 전부를 막는다.
//  흡수 특성은 "사용자 이외의 포켓몬을 겨냥한 기술"에만 반응하고, 흡수하면 기술 전체가 끝난다(씨앗도 안 걸린다).
//  설계 `8.3-D3-fix47-상대방향차단설계.md` §3. 앙코르·사슬묶기는 상대가 직전에 기술을 쓴 상태(`lastMoveId`)에서 판정한다(R3).
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const fe = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const play = (st, a, b = "리플렉터", rnd = () => 0.5) => { try { return rt.runTurn(st, mv(a), mv(b), rnd); } catch (e) { return { err: String(e) }; } };
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const act = (o, key = "a") => (o?.result ?? o?.partialResult)?.actions.find((x) => x.actor === key);
  const forcedSides = (o) => ((o?.result ?? o?.partialResult)?.switches ?? []).filter((s) => s.forced).map((s) => s.side).join("");
  const TRICK_ITEMS = { userItem: "구애스카프", targetItem: "먹다남은음식" };
  const EXTRA = { 트릭: TRICK_ITEMS, 바꿔치기: TRICK_ITEMS, 저주: { user: "팬텀" }, 역할: { targetAbility: "두꺼운지방" } }; // 역할은 복사할 상대 특성이 있어야 한다
  // a: 사용자(기본 하마돈 + 예비 잠만보), b: 대상(기본 잠만보 + 예비). b.lastMoveId는 앙코르·사슬묶기용 "직전 기술".
  const mk = (move, { user = "하마돈", userAbility = null, userItem = null, target = "잠만보", targetAbility = null, targetItem = null, aSub = false, bSub = false, last = "칼춤" } = {}) => {
    const ex = EXTRA[move] ?? {};
    const st = battle(
      [mon(ex.user ?? user, [move, "칼춤"], userAbility, ex.userItem ?? userItem, bulky), mon("잠만보", ["칼춤"])],
      [mon(target, ["리플렉터", "방어", "킹실드", "니들가드", "칼춤"], targetAbility ?? ex.targetAbility ?? null, ex.targetItem ?? targetItem, bulky), mon("잠만보", ["칼춤"])],
    );
    st.b.lastMoveId = last;
    if (aSub) st.a.substituteHp = 50;
    if (bSub) st.b.substituteHp = 50;
    return st;
  };
  // 효과 검출 — 행동 로그 필드와 휘발성 상태.
  const FX = {
    파워셰어: (o) => !!act(o)?.averagedAttacksMoveName,
    가드셰어: (o) => !!act(o)?.averagedDefensesMoveName,
    스피드스왑: (o) => !!act(o)?.swappedSpeedMoveName,
    트릭: (o) => !!act(o)?.swappedItems,
    바꿔치기: (o) => !!act(o)?.swappedItems,
    아픔나누기: (o) => act(o)?.painSplitHp !== undefined,
    자기암시: (o) => !!act(o)?.copiedStagesFromName,
    파워스왑: (o) => !!act(o)?.swappedStagesMoveName,
    가드스왑: (o) => !!act(o)?.swappedStagesMoveName,
    역할: (o) => act(o)?.abilityChange?.kind === "copy",
    미러타입: (o) => !!act(o)?.copiedTypes,
    변신: (o) => !!act(o)?.transformedIntoName,
    사슬묶기: (o) => !!act(o)?.setDisabledMoveName,
    앙코르: (o) => !!act(o)?.setEncoreMoveName,
    씨뿌리기: (o) => !!o?.nextState?.b.volatile.active.leechSeed,
    저주: (o) => !!o?.nextState?.b.volatile.active.curse,
  };
  const ALL = Object.keys(FX);
  const SUB_PASS = ["스피드스왑", "자기암시", "파워스왑", "가드스왑", "역할", "미러타입", "사슬묶기", "앙코르", "저주"];
  const SUB_BLOCK = ALL.filter((m) => !SUB_PASS.includes(m));
  const PROT_PASS = ["자기암시", "역할", "변신", "저주"];
  const PROT_BLOCK = ALL.filter((m) => !PROT_PASS.includes(m));
  // 목록 중 판정이 어긋난 기술 이름들(비면 통과)
  const wrong = (list, opts, bMove, want) => list.filter((m) => FX[m](play(mk(m, opts), m, bMove)) !== want).join(",");
  const GOLD = { target: "타부자고", targetAbility: "황금몸" };

  // ── 1 황금몸: 16종 전부 효과 없음 + 저주는 HP 비용도 없다 ──
  {
    check("D3-fix47 1: 황금몸 vs 16종 → 전부 효과 없음", wrong(ALL, GOLD, undefined, false) === "", wrong(ALL, GOLD, undefined, false));
    const o = play(mk("저주", GOLD), "저주");
    check("D3-fix47 1b: 황금몸 vs 저주(고스트) → HP 비용 없음", (act(o)?.curseHpCost ?? 0) === 0 && o?.nextState.a.currentHp === o?.nextState.a.maxHp, `cost=${act(o)?.curseHpCost} hp=${o?.nextState.a.currentHp}/${o?.nextState.a.maxHp}`);
    check("D3-fix47 1c: 황금몸 막힘 로그(goodAsGoldBlockedByAbilityName)", !!act(play(mk("트릭", GOLD), "트릭"))?.goodAsGoldBlockedByAbilityName, JSON.stringify(act(play(mk("트릭", GOLD), "트릭"))?.goodAsGoldBlockedByAbilityName));
  }
  // ── 2 대타(bypasssub 없음): 7종 막힘 ──
  check("D3-fix47 2: 대타 vs 파워셰어·가드셰어·트릭·바꿔치기·아픔나누기·변신·씨뿌리기 → 효과 없음", wrong(SUB_BLOCK, { bSub: true }, undefined, false) === "", wrong(SUB_BLOCK, { bSub: true }, undefined, false));
  // ── 3 대타(bypasssub): 9종 통과 ──
  check("D3-fix47 3: 대타 vs 스피드스왑·자기암시·파워스왑·가드스왑·역할·미러타입·사슬묶기·앙코르·저주 → 효과 적용", wrong(SUB_PASS, { bSub: true }, undefined, true) === "", wrong(SUB_PASS, { bSub: true }, undefined, true));
  // ── 4 방어(protect 있음): 12종 막힘 ──
  check("D3-fix47 4: 방어 vs 파워셰어·가드셰어·스피드스왑·트릭·바꿔치기·아픔나누기·파워스왑·가드스왑·미러타입·사슬묶기·앙코르·씨뿌리기 → 효과 없음", wrong(PROT_BLOCK, {}, "방어", false) === "", wrong(PROT_BLOCK, {}, "방어", false));
  // ── 5 방어(protect 없음, 데이터 2-0): 자기암시·역할·변신·저주 통과 ──
  check("D3-fix47 5: 방어 vs 자기암시·역할·변신·저주 → 효과 적용(방어 통과)", wrong(PROT_PASS, {}, "방어", true) === "", wrong(PROT_PASS, {}, "방어", true));
  // ── 6 대조: 차단 없음 → 16종 전부 적용(검출 필드가 맞는지도 확인) ──
  check("D3-fix47 6: 대조(차단 없음) → 16종 전부 효과 적용", wrong(ALL, {}, undefined, true) === "", wrong(ALL, {}, undefined, true));
  // ── 7 이미 막히던 것은 계속 막힘 / 흑안개는 어느 쪽에도 안 막힘 ──
  {
    const half = (st) => { st.a.currentHp = Math.floor(st.a.maxHp / 2); return st; };
    const drain = (opts, bMove) => play(half(mk("힘흡수", opts)), "힘흡수", bMove);
    const spite = (opts, bMove) => act(play(mk("원한", opts), "원한", bMove))?.spitePp;
    const swap = (opts, bMove) => act(play(mk("스킬스왑", opts), "스킬스왑", bMove))?.abilityChange;
    const cases = { 황금몸: [GOLD, undefined], 대타: [{ bSub: true }, undefined], 방어: [{}, "방어"] };
    const leaks = [];
    for (const [label, [opts, bMove]] of Object.entries(cases)) {
      if (act(drain(opts, bMove))?.healedAmount) leaks.push(`힘흡수/${label}`); // 힘흡수는 대타·황금몸·방어 모두에 막힌다(Showdown protect·!bypasssub). 설계서 표는 만피 상태로 재서 새는 걸 못 봤다
      if (label !== "대타" && spite(opts, bMove)) leaks.push(`원한/${label}`);
      if (label !== "대타" && swap(opts, bMove)) leaks.push(`스킬스왑/${label}`);
    }
    check("D3-fix47 7: 힘흡수(대타·황금몸·방어)·원한·스킬스왑(황금몸·방어)은 막힌다", leaks.length === 0, leaks.join(","));
    const fog = [];
    for (const [label, [opts, bMove]] of Object.entries(cases)) {
      const st = mk("흑안개", opts); st.b.stages = { ...st.b.stages, atk: 3 };
      const o = play(st, "흑안개", bMove === "방어" ? "방어" : "리플렉터");
      if (o?.nextState?.b.stages.atk !== 0) fog.push(`${label}:atk=${o?.nextState?.b.stages.atk}`);
    }
    check("D3-fix47 7b: 흑안개는 황금몸·대타·방어 어느 쪽에도 막히지 않는다(대상 전체)", fog.length === 0, fog.join(","));
  }
  // ── 8 데이터: 눈물그렁그렁·검은눈빛은 방어를 통과, 울부짖기·날려버리기도 통과 ──
  {
    const tear = play(mk("눈물그렁그렁", {}), "눈물그렁그렁", "방어");
    const look = play(mk("검은눈빛", {}), "검은눈빛", "방어");
    check("D3-fix47 8: 방어 vs 눈물그렁그렁·검은눈빛 → 공격·특공 −1 / 도망 봉쇄(방어 통과)", tear?.nextState?.b.stages.atk === -1 && tear?.nextState?.b.stages.spa === -1 && !!look?.nextState?.b.volatile.active.meanLook, `atk=${tear?.nextState?.b.stages.atk} spa=${tear?.nextState?.b.stages.spa} meanLook=${look?.nextState?.b.volatile.active.meanLook}`);
    const roar = ["울부짖기", "날려버리기"].map((m) => forcedSides(play(mk(m, {}), m, "방어")));
    check("D3-fix47 8b: 방어 vs 울부짖기·날려버리기 → 강제 교체 통과", roar.every((s) => s === "b"), roar.join("|"));
  }
  // ── 9 E8-22 흡수 + 효과: 씨뿌리기 vs 초식 → 공격 +1, 씨앗 없음 / 대조: 일반 대상 → 씨앗 ──
  {
    const o = play(mk("씨뿌리기", { targetAbility: "초식" }), "씨뿌리기");
    const c = play(mk("씨뿌리기", {}), "씨뿌리기");
    check("D3-fix47 9: 씨뿌리기 vs 초식 → 공격 +1·씨앗 없음 / 대조 → 씨앗", o?.nextState?.b.stages.atk === 1 && !FX.씨뿌리기(o) && FX.씨뿌리기(c), `atk=${o?.nextState?.b.stages.atk} seed=${FX.씨뿌리기(o)} 대조=${FX.씨뿌리기(c)}`);
  }
  // ── 10 E8-22 필드·날씨 기술은 흡수 특성에 무반응 ──
  {
    const sun = play(mk("쾌청", { targetAbility: "타오르는불꽃" }), "쾌청");
    const grass = play(mk("그래스필드", { targetAbility: "초식" }), "그래스필드");
    const half = mk("일렉트릭필드", { targetAbility: "축전" }); half.b.currentHp = Math.floor(half.b.maxHp / 2);
    const elec = play(half, "일렉트릭필드");
    const boosted = sun?.nextState?.b.ownMoveTypeBoosts?.["불꽃"];
    check("D3-fix47 10: 쾌청 vs 타오르는불꽃 → 날씨는 걸리고 불꽃 부여 없음", sun?.nextState?.weather === "쾌청" && !boosted, `boost=${boosted} weather=${JSON.stringify(sun?.nextState?.weather)}`);
    check("D3-fix47 10b: 그래스필드 vs 초식 → 공격 불변 / 일렉트릭필드 vs 축전 → 회복 없음", grass?.nextState?.b.stages.atk === 0 && elec?.nextState?.b.currentHp === Math.floor(elec?.nextState?.b.maxHp / 2), `atk=${grass?.nextState?.b.stages.atk} hp=${elec?.nextState?.b.currentHp}/${elec?.nextState?.b.maxHp}`);
  }
  // ── 11 대조: 데미지·상대 대상 변화기는 계속 흡수(회귀) ──
  {
    const absorbed = (move, ability) => act(play(mk(move, { targetAbility: ability }), move))?.abilityAbsorbedMoveType;
    const rows = [["화염방사", "타오르는불꽃"], ["도깨비불", "타오르는불꽃"], ["전기자석파", "축전"], ["10만볼트", "축전"], ["기가드레인", "초식"]];
    const miss = rows.filter(([m, a]) => !absorbed(m, a)).map(([m]) => m);
    check("D3-fix47 11: 화염방사·도깨비불 vs 타오르는불꽃 · 전기자석파·10만볼트 vs 축전 · 기가드레인 vs 초식 → 계속 흡수", miss.length === 0, miss.join(","));
  }
  // ── 12 반사: 반사된 씨뿌리기는 사용자 대타에, 반사된 앙코르는 사용자 황금몸에 막힌다 ──
  {
    const seed = play(mk("씨뿌리기", { target: "에브이", targetAbility: "매직미러", aSub: true }), "씨뿌리기");
    check("D3-fix47 12: 씨뿌리기 반사 + 사용자 대타 → 사용자에게 씨앗 없음", !seed?.nextState?.a.volatile.active.leechSeed && seed?.nextState?.a.substituteHp === 50, JSON.stringify(seed?.nextState?.a.volatile.active));
    const st = mk("앙코르", { user: "타부자고", userAbility: "황금몸", target: "에브이", targetAbility: "매직미러" }); st.a.lastMoveId = "칼춤";
    const enc = play(st, "앙코르");
    check("D3-fix47 12b: 앙코르 반사 + 사용자 황금몸 → 사용자에게 앙코르 없음", !enc?.nextState?.a.volatile.active.encore, JSON.stringify(enc?.nextState?.a.volatile.active));
  }
  // ── 13 빗나감: 씨뿌리기가 빗나가면 효과 없음(회귀) ──
  {
    const o = play(mk("씨뿌리기", {}), "씨뿌리기", "리플렉터", () => 0.99);
    check("D3-fix47 13: 씨뿌리기가 빗나가면 씨앗 없음(회귀)", !FX.씨뿌리기(o), JSON.stringify(o?.nextState?.b.volatile.active));
  }
  // ── 14 R1 킹실드는 변화기를 막지 않는다(니들가드는 막는다) / 킹실드가 막는 데미지·접촉 페널티는 그대로 ──
  {
    const king = ["트릭", "씨뿌리기", "아픔나누기"].filter((m) => !FX[m](play(mk(m, {}), m, "킹실드")));
    check("D3-fix47 14: 킹실드 vs 트릭·씨뿌리기·아픔나누기 → 효과 적용(변화기 통과)", king.length === 0, `막힌 것: ${king.join(",")}`);
    check("D3-fix47 14b: 대조 — 니들가드 vs 트릭 → 막힘", !FX.트릭(play(mk("트릭", {}), "트릭", "니들가드")), "");
    const dmg = play(mk("지진", {}), "지진", "킹실드");
    check("D3-fix47 14c: 킹실드 vs 데미지 기술(지진) → 데미지 없음(회귀)", dmg?.nextState?.b.currentHp === dmg?.nextState?.b.maxHp, `hp=${dmg?.nextState?.b.currentHp}/${dmg?.nextState?.b.maxHp}`);
    const contact = play(mk("누르기", {}), "누르기", "킹실드");
    check("D3-fix47 14d: 킹실드 vs 접촉기 → 사용자 공격 −1(회귀)", contact?.nextState?.a.stages.atk === -1, `atk=${contact?.nextState?.a.stages.atk}`);
  }
  // ── 15 R4 현행 확인(게이트 16곳 밖): 울부짖기·검은눈빛·블록 ──
  {
    check("D3-fix47 15: 울부짖기 vs 황금몸 → 교체 없음", forcedSides(play(mk("울부짖기", GOLD), "울부짖기")) === "", forcedSides(play(mk("울부짖기", GOLD), "울부짖기")));
    const sub = ["울부짖기", "날려버리기"].map((m) => forcedSides(play(mk(m, { bSub: true }), m)));
    check("D3-fix47 15b: 울부짖기·날려버리기 vs 대타 → 교체(bypasssub)", sub.every((s) => s === "b"), sub.join("|"));
    const blk = play(mk("블록", { bSub: true }), "블록");
    check("D3-fix47 15c: 블록 vs 대타 → 도망 봉쇄 실패 / 검은눈빛 vs 황금몸 → 실패", !blk?.nextState?.b.volatile.active.meanLook && !play(mk("검은눈빛", GOLD), "검은눈빛")?.nextState?.b.volatile.active.meanLook, "");
  }
  // ── 16 R4 틀깨기·틈새포착: 틀깨기 앙코르 vs 황금몸 → 걸림 / 틈새포착 트릭·씨뿌리기 vs 대타 → 적용 ──
  {
    const bk = play(mk("앙코르", { ...GOLD, userAbility: "틀깨기" }), "앙코르");
    check("D3-fix47 16: 틀깨기 앙코르 vs 황금몸 → 걸림(황금몸 무시)", FX.앙코르(bk), JSON.stringify(act(bk)?.setEncoreMoveName));
    const inf = ["트릭", "씨뿌리기"].filter((m) => !FX[m](play(mk(m, { bSub: true, userAbility: "틈새포착" }), m)));
    check("D3-fix47 16b: 틈새포착 트릭·씨뿌리기 vs 대타 → 적용", inf.length === 0, `막힌 것: ${inf.join(",")}`);
  }
  // ── 17 R4 방어가 흡수보다 먼저: 씨뿌리기 vs 초식 + 방어 → 공격 불변 ──
  {
    const o = play(mk("씨뿌리기", { targetAbility: "초식" }), "씨뿌리기", "방어");
    check("D3-fix47 17: 씨뿌리기 vs 초식 + 방어 → 방어에 막힘·공격 불변·씨앗 없음", o?.nextState?.b.stages.atk === 0 && !FX.씨뿌리기(o), `atk=${o?.nextState?.b.stages.atk}`);
  }
  // ── 18 R4 흡수가 명중 판정보다 먼저: 빗나가는 씨뿌리기도 초식이 흡수 ──
  {
    const o = play(mk("씨뿌리기", { targetAbility: "초식" }), "씨뿌리기", "리플렉터", () => 0.99);
    check("D3-fix47 18: 빗나가는 씨뿌리기 vs 초식 → 공격 +1(흡수가 명중보다 먼저)", o?.nextState?.b.stages.atk === 1, `atk=${o?.nextState?.b.stages.atk}`);
  }
  // ── 19 R2 자기·아군·진영·필드 기술은 흡수 대상이 아니다 ──
  {
    const half = (st) => { st.b.currentHp = Math.floor(st.b.maxHp / 2); return st; };
    const grass = ["니들가드", "광합성"].map((m) => play(mk(m, { targetAbility: "초식" }), m)).map((o) => o?.nextState?.b.stages.atk);
    const charge = play(half(mk("충전", { targetAbility: "축전" })), "충전");
    const spikes = play(half(mk("압정뿌리기", { target: "꿈트렁", targetAbility: "흙먹기" })), "압정뿌리기");
    const bad = [];
    if (grass.some((v) => v !== 0)) bad.push(`초식 atk=${grass}`);
    if (charge?.nextState?.b.currentHp !== Math.floor(charge?.nextState?.b.maxHp / 2)) bad.push("충전/축전 회복");
    if (spikes?.nextState?.b.currentHp !== Math.floor(spikes?.nextState?.b.maxHp / 2)) bad.push("압정뿌리기/흙먹기 회복");
    check("D3-fix47 19: 니들가드·광합성 vs 초식 · 충전 vs 축전 · 압정뿌리기 vs 흙먹기 → 무반응", bad.length === 0, bad.join(" "));
    const names = ["니들가드", "광합성", "성장", "코튼가드", "뿌리박기", "충전", "전자부유", "아쿠아링", "생명의물방울", "자기장조작", "압정뿌리기", "스텔스록", "쾌청", "비바라기", "그래스필드", "일렉트릭필드", "흑안개"];
    const truthy = names.filter((n) => fe.needsLivingTarget(data.getMove(n)));
    check("D3-fix47 19b: needsLivingTarget — 자기·아군·진영·필드 기술은 전부 false", truthy.length === 0, truthy.join(","));
  }
}
