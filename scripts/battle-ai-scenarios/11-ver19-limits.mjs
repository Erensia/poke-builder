// ver.1.9 한계점 A1~A5·난동
export default async function ({ server, data, ev, pts, mon, battle, opt, check }) {
  // ── ver.1.9 한계점 A1: 모으기·반동 — 엔진(교체 불가·반동 턴 PP 없음·반동 먼저) + AI(턴 비용·숨은 상대·상대 반동 턴) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const own = (out, key) => out.result.actions.find((x) => x.actor === key);
    const tank = (moves) => mon("잠만보", moves, null, null, pts({ hp: 32, def: 32, spd: 32 }));
    // 반동: 맞힌 다음 턴 — 교체·다른 기술을 골라도 움직이지 못하고, 고른 기술 PP는 그대로, 마비여도 반동으로 막히고 반동이 풀린다
    const r0 = battle([mon("켄타로스", ["기가임팩트", "막치기"]), mon("피카츄", ["10만볼트"])], [tank(["막치기"])]);
    const r1 = rt.runTurn(r0, act("기가임팩트"), act("막치기"), () => 0).nextState;
    const recharged = !!r1.a.volatile.active.recharge;
    r1.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const pp = r1.a.remainingPp["막치기"];
    const r2out = rt.runTurn(r1, { kind: "switch", toIndex: 1 }, act("막치기"), () => 0);
    const r2 = r2out.nextState;
    const rechargeOk =
      recharged &&
      r2out.result.switches.length === 0 &&
      own(r2out, "a")?.blockedReason === "recharge" &&
      r2.a.remainingPp["막치기"] === pp &&
      !r2.a.volatile.active.recharge;
    // 모으기: 공중날기 준비 다음 턴 — 교체를 골라도 공중날기가 나간다
    const f0 = battle([mon("리자몽", ["공중날기"]), mon("피카츄", ["10만볼트"])], [tank(["막치기"])]);
    const f1 = rt.runTurn(f0, act("공중날기"), act("막치기"), () => 0).nextState;
    const f2out = rt.runTurn(f1, { kind: "switch", toIndex: 1 }, act("막치기"), () => 0);
    const chargeOk = f1.a.chargingMoveId === "공중날기" && f2out.result.switches.length === 0 && own(f2out, "a")?.move.id === "공중날기";
    check(
      "1.9 A1 엔진: 반동 턴·모으기 2턴째 교체 불가, 반동 턴 PP 없음·마비보다 반동 먼저(반동 소모)",
      rechargeOk && chargeOk,
      `반동 ${rechargeOk} 모으기 ${chargeOk}`,
    );
    // AI 턴 비용: 반동기는 (쓴 횟수 + 맞힌 횟수 − 1)턴, 솔라빔은 2배(쾌청이면 그대로)
    const est = (st, id) => md.estimateMoveHits({ state: st, attacker: st.a, defender: st.b, defenderSide: st.sideB, attackerMovesSecond: false }, data.getMove(id));
    const gs = battle([mon("켄타로스", ["기가임팩트"])], [tank(["막치기"])]);
    const g = est(gs, "기가임팩트");
    const gUses = g.rawHits / g.accuracy;
    const gOk = Math.abs(g.expected - (gUses + Math.max(0, g.rawHits - 1))) < 1e-9;
    const ss = battle([mon("라플레시아", ["솔라빔"], null, null, pts({ spa: 32 }))], [tank(["막치기"])]);
    const s1 = est(ss, "솔라빔");
    ss.weather = "쾌청";
    ss.weatherTurnsRemaining = 5;
    const s2 = est(ss, "솔라빔");
    const solarOk = Math.abs(s1.expected - (2 * s1.rawHits) / s1.accuracy) < 1e-9 && Math.abs(s2.expected - s2.rawHits / s2.accuracy) < 1e-9;
    // AI 이번 턴: 상대 반동 턴이면 모든 선택지 lostShift −1, 상대가 공중날기로 숨었고 내가 빠르면 공격 +1(번개는 맞힘)
    const ai = await server.ssrLoadModule("/src/lib/battle/ai/index.ts");
    const idle = battle([mon("피카츄", ["10만볼트", "번개"]), mon("잠만보", ["누르기"])], [mon("켄타로스", ["기가임팩트"])]);
    idle.b.volatile = { active: { recharge: { turnsRemaining: 1 } } };
    const idleShift = ev.evaluateOptions(idle, "a").every((o) => o.lostShift === -1);
    const sky = battle([mon("피카츄", ["10만볼트", "번개"], null, null, pts({ spe: 32, spa: 32 }))], [mon("리자몽", ["공중날기"], null, null, pts({ hp: 2 }))]);
    sky.b.chargingMoveId = "공중날기";
    const skyOpts = ev.evaluateOptions(sky, "a");
    const skyShift = opt(skyOpts, "10만볼트").lostShift === 1 && opt(skyOpts, "번개").lostShift === undefined;
    // AI가 반동 턴이면 평가 없이 강제 행동
    const me = battle([mon("켄타로스", ["기가임팩트", "막치기"])], [tank(["막치기"])]);
    me.a.volatile = { active: { recharge: { turnsRemaining: 1 } } };
    me.a.lastMoveId = "기가임팩트";
    const forced = ai.chooseAiAction(me, "a", 0.5);
    const forcedOk = forced.scored.length === 0 && forced.action.kind === "move" && forced.action.move.id === "기가임팩트";
    check(
      "1.9 A1 AI: 반동기·모으기 턴 비용, 상대 반동 턴 −1·숨은 상대에게 먼저 치는 공격 +선공, 내 반동 턴은 강제 행동",
      gOk && solarOk && idleShift && skyShift && forcedOk,
      `반동기 ${gOk}(${g.expected.toFixed(2)}턴) 솔라빔 ${solarOk} 상대 반동 ${idleShift} 숨음 ${skyShift} 강제 ${forcedOk}`,
    );
  }
  // ── ver.1.9 한계점 A5: 엔진 미구현 특성 12종 + 매직가드(무릎차기·철제광선) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const own = (out, key) => out.result.actions.find((x) => x.actor === key);
    const tank = (moves, ability = null, item = null) => mon("잠만보", moves, ability, item, pts({ hp: 32, def: 32, spd: 32 }));
    const results = {};
    // 그림자밟기: 맞은편은 교체 불가(교체를 골라도 안 됨), 고스트·같은 특성은 예외
    {
      const st = battle([mon("팬텀", ["섀도볼"], "그림자밟기")], [tank(["막치기"]), mon("피카츄", ["10만볼트"])]);
      const out = rt.runTurn(st, act("섀도볼"), { kind: "switch", toIndex: 1 }, () => 0.5);
      const ghost = battle([mon("팬텀", ["섀도볼"], "그림자밟기")], [mon("팬텀", ["섀도볼"])]);
      results.shadowTag = sw.isTrappedFromSwitching(st.b, st) && out.result.switches.length === 0 && !sw.isTrappedFromSwitching(ghost.b, ghost);
    }
    // 돌머리: 반동 없음
    {
      const run = (ability) => own(rt.runTurn(battle([mon("프테라", ["브레이브버드"], ability)], [tank(["막치기"])]), act("브레이브버드"), act("막치기"), () => 0.5), "a").recoilDamage ?? 0;
      results.rockHead = run("돌머리") === 0 && run(null) > 0;
    }
    // 분노의경혈: 급소에 맞으면 공격 +6
    {
      const st = battle([mon("한카리아스", ["막치기"])], [tank(["막치기"], "분노의경혈")]);
      const next = rt.runTurn(st, act("막치기"), act("막치기"), () => 0).nextState;
      results.angerPoint = next.b.stages.atk === 6;
    }
    // 속보: 상태이상이면 ×1.5(마비 반감 무시) · 서핑테일: 일렉트릭필드면 ×2
    {
      const st = battle([mon("쥬피썬더", ["10만볼트"], "속보")], [mon("알로라라이츄", ["10만볼트"], "서핑테일")]);
      const base = toi.computeTurnOrderSpeed(st, st.a);
      st.a.status = { condition: "paralysis", turnsElapsed: 1 };
      const quickFeet = toi.computeTurnOrderSpeed(st, st.a) / base;
      const surfBase = toi.computeTurnOrderSpeed(st, st.b);
      st.field = "일렉트릭필드";
      st.fieldTurnsRemaining = 5;
      results.speed = Math.abs(quickFeet - 1.5) < 1e-9 && Math.abs(toi.computeTurnOrderSpeed(st, st.b) / surfBase - 2) < 1e-9;
    }
    // 퀵드로: 공격기면 30%로 먼저(난수 0 → 발동), 변화기면 없음
    {
      const st = () => battle([mon("가라르야도란", ["사이코키네시스", "명상"], "퀵드로", null, pts({ hp: 2 }))], [mon("피카츄", ["10만볼트"])]);
      const first = (moveId) => rt.runTurn(st(), act(moveId), act("10만볼트"), () => 0).result.actions[0].actor;
      results.quickDraw = first("사이코키네시스") === "a" && first("명상") === "b";
    }
    // 애널라이즈: 후공이면 위력 ×1.3
    {
      const dmg = (ability) =>
        own(rt.runTurn(battle([mon("보르그", ["10만볼트"], ability, null, pts({ spa: 32, hp: 2 }))], [mon("메가니움", ["칼춤"], null, null, pts({ hp: 32, spe: 32 }))]), act("10만볼트"), act("칼춤"), () => 0.5), "a").damage;
      const ratio = dmg("애널라이즈") / dmg(null);
      results.analytic = ratio > 1.2 && ratio < 1.4;
    }
    // 촉촉바디: 비면 턴 끝에 상태이상 치료
    {
      const st = battle([mon("샤미드", ["칼춤"], "촉촉바디")], [tank(["칼춤"])]);
      st.a.status = { condition: "poison", turnsElapsed: 1 };
      st.weather = "비";
      st.weatherTurnsRemaining = 5;
      results.hydration = rt.runTurn(st, act("칼춤"), act("칼춤"), () => 0.9).nextState.a.status.condition === null;
    }
    // 포자: 접촉하면 30%로 독·마비·잠듦(난수 0 → 발동·첫 번째 독), 풀 타입은 무효
    {
      const hit = (attacker) => rt.runTurn(battle([attacker], [mon("라플레시아", ["칼춤"], "포자", null, pts({ hp: 32, def: 32 }))]), act("막치기"), act("칼춤"), () => 0).nextState.a.status.condition;
      results.effectSpore = hit(mon("한카리아스", ["막치기"])) === "poison" && hit(mon("메가니움", ["막치기"])) !== "poison";
    }
    // 잠복: 이번 턴 교체해 들어온 상대에게 ×2
    {
      const st = battle([mon("마피티프", ["깨물어부수기"], "잠복")], [mon("피카츄", ["10만볼트"]), tank(["칼춤"])]);
      const switched = own(rt.runTurn(st, act("깨물어부수기"), { kind: "switch", toIndex: 1 }, () => 0.5), "a").damage;
      const stay = own(rt.runTurn(battle([mon("마피티프", ["깨물어부수기"], "잠복")], [tank(["칼춤"])]), act("깨물어부수기"), act("칼춤"), () => 0.5), "a").damage;
      results.stakeout = Math.abs(switched / stay - 2) < 0.15;
    }
    // 되새김질: 자뭉열매를 먹은 다음 턴 끝에 한 번 더
    {
      const st = battle([mon("키키링", ["칼춤"], "되새김질", "자뭉열매", pts({ hp: 32 }))], [tank(["칼춤"])]);
      st.a.currentHp = Math.floor(st.a.maxHp * 0.4);
      const t1 = rt.runTurn(st, act("칼춤"), act("칼춤"), () => 0.9);
      const t2 = rt.runTurn(t1.nextState, act("칼춤"), act("칼춤"), () => 0.9);
      const chewed = t2.result.endOfTurn.some((e) => e.cudChewBerryName === "자뭉열매" && e.berryHeal > 0);
      results.cudChew = chewed && t2.nextState.a.currentHp > t1.nextState.a.currentHp;
    }
    // 독치장: 물리 피격 → 공격자 편 독압정
    {
      const next = rt.runTurn(battle([mon("한카리아스", ["막치기"])], [mon("킬라플로르", ["칼춤"], "독치장", null, pts({ hp: 32, def: 32 }))]), act("막치기"), act("칼춤"), () => 0.5).nextState;
      results.toxicDebris = next.sideA.hazards.toxicSpikesLayers === 1;
    }
    // 매직가드: 철제광선 HP 손실 없음
    {
      const next = rt.runTurn(battle([mon("픽시", ["철제광선"], "매직가드", null, pts({ hp: 32 }))], [tank(["칼춤"])]), act("철제광선"), act("칼춤"), () => 0.5).nextState;
      results.magicGuard = next.a.currentHp === next.a.maxHp;
    }
    check("1.9 A5: 특성 12종 + 매직가드", Object.values(results).every(Boolean), `실패: ${Object.keys(results).filter((k) => !results[k]).join(",") || "없음"}`);
  }
  // ── ver.1.9 한계점 A2: 공격의 자기 HP 변화 — 반동·생명의구슬·접촉 페널티는 내가 버티는 턴↓, 흡수는↑(해감액이면↓), 상대 반동은 내 처치 턴↓ ──
  {
    const tank = (moves, ability = null, item = null) => mon("잠만보", moves, ability, item, pts({ hp: 32, def: 32, spd: 32 }));
    const d = (st, moveId) => opt(ev.evaluateOptions(st, "a"), moveId).hitsToBeKilled.expected;
    const c = (st, moveId) => opt(ev.evaluateOptions(st, "a"), moveId).hitsToKill.expected;
    const recoil = battle([mon("찌르호크", ["브레이브버드", "막치기"])], [tank(["막치기"])]);
    const recoilLower = d(recoil, "브레이브버드") < d(recoil, "막치기");
    const orb = d(battle([mon("찌르호크", ["막치기"], null, "생명의구슬")], [tank(["막치기"])]), "막치기");
    const noOrb = d(battle([mon("찌르호크", ["막치기"])], [tank(["막치기"])]), "막치기");
    const sp = () => mon("라플레시아", ["기가드레인", "에너지볼"], null, null, pts({ spa: 32, hp: 32 }));
    const drain = battle([sp()], [tank(["막치기"])]);
    const ooze = battle([sp()], [tank(["막치기"], "해감액")]);
    const drainUp = d(drain, "기가드레인") > d(drain, "에너지볼");
    const oozeDown = d(ooze, "기가드레인") < d(ooze, "에너지볼");
    const pika = () => mon("피카츄", ["막치기", "10만볼트"], null, null, pts({ spa: 32, atk: 32 }));
    const helmet = battle([pika()], [tank(["막치기"], null, "울퉁불퉁멧")]);
    const plain = battle([pika()], [tank(["막치기"])]);
    const helmetDown = d(helmet, "막치기") < d(helmet, "10만볼트") && d(plain, "막치기") === d(plain, "10만볼트");
    const oppRecoil = c(battle([mon("한카리아스", ["막치기"])], [mon("찌르호크", ["브레이브버드"])]), "막치기");
    const oppPlain = c(battle([mon("한카리아스", ["막치기"])], [mon("찌르호크", ["막치기"])]), "막치기");
    check(
      "1.9 A2: 반동·생명의구슬·울퉁불퉁멧은 버티는 턴↓, 흡수는↑(해감액이면↓), 상대 반동은 내 처치 턴↓",
      recoilLower && orb < noOrb && drainUp && oozeDown && helmetDown && oppRecoil < oppPlain,
      `반동 ${recoilLower} 구슬 ${noOrb.toFixed(2)}→${orb.toFixed(2)} 흡수 ${drainUp} 해감액 ${oozeDown} 멧 ${helmetDown} 상대 반동 c ${oppPlain.toFixed(2)}→${oppRecoil.toFixed(2)}`,
    );
  }
  // ── ver.1.9 난동(역린·꽃잎댄스·난동부리기·대격분·소란피기): 고정 턴·PP 첫 턴만·끝나면 혼란·끊기면 혼란 없음·소란 중 잠듦 불가 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.5) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => r);
    const own = (out, key) => out.result.actions.find((x) => x.actor === key);
    const tank = (moves) => mon("잠만보", moves, null, null, pts({ hp: 32, def: 32 }));
    // 난수 0.5 → 지속 3턴(0.5 < 0.5 아님). 1턴째 역린 → 2·3턴째는 다른 기술·교체를 골라도 역린, PP는 첫 턴만, 3턴째 끝에 혼란
    const st0 = battle([mon("한카리아스", ["역린", "지진"]), mon("잠만보", ["누르기"])], [tank(["칼춤"])]);
    const pp0 = st0.a.remainingPp["역린"];
    const t1 = run(st0, "역린", "칼춤");
    const s1 = t1.nextState;
    const t2 = run(s1, { kind: "switch", toIndex: 1 }, act("칼춤"));
    const s2 = t2.nextState;
    const t3 = run(s2, "지진", "칼춤");
    const s3 = t3.nextState;
    const forced = own(t2, "a")?.move.id === "역린" && own(t3, "a")?.move.id === "역린" && t2.result.switches.length === 0;
    const ppUsed = pp0 - s3.a.remainingPp["역린"];
    const lockedLeft = [s1, s2].map((s) => s.a.volatile.active.rampage?.turnsRemaining);
    const confusedEnd = !!s3.a.volatile.active.confusion && !s3.a.volatile.active.rampage && own(t3, "a")?.rampageConfused === true;
    check(
      "1.9 난동: 역린 3턴 고정(입력·교체 무시), PP 첫 턴만, 끝까지 쓰면 혼란",
      forced && ppUsed === 1 && lockedLeft[0] === 2 && lockedLeft[1] === 1 && confusedEnd,
      `강제 ${forced} PP −${ppUsed} 남은 턴 ${lockedLeft.join("→")} 끝 혼란 ${confusedEnd}`,
    );
    // 난수 0.4 → 2턴. 2턴째가 방어에 막히면(마지막 턴) 혼란 없이 끝 · 마이페이스는 끝까지 써도 혼란 없음
    const p0 = battle([mon("한카리아스", ["역린"])], [tank(["방어", "칼춤"])]);
    const p1 = run(p0, "역린", "칼춤", 0.4).nextState;
    const p2out = run(p1, "역린", "방어", 0.4);
    const blockedEnd = !p2out.nextState.a.volatile.active.rampage && !p2out.nextState.a.volatile.active.confusion;
    const ot0 = battle([mon("한카리아스", ["역린"], "마이페이스")], [tank(["칼춤"])]);
    const ot2 = run(run(ot0, "역린", "칼춤", 0.4).nextState, "역린", "칼춤", 0.4).nextState;
    const ownTempo = !ot2.a.volatile.active.rampage && !ot2.a.volatile.active.confusion;
    check(
      "1.9 난동: 2턴(50%) · 마지막 턴이 방어에 막히면 혼란 없이 끝 · 마이페이스는 혼란 없음",
      p1.a.volatile.active.rampage?.turnsRemaining === 1 && blockedEnd && ownTempo,
      `2턴 남은 ${p1.a.volatile.active.rampage?.turnsRemaining} 방어 끊김 ${blockedEnd} 마이페이스 ${ownTempo}`,
    );
    // 소란피기: 잠든 상대는 깨고, 소란 중엔 수면가루·잠자기 실패, 3턴 뒤 혼란 없이 끝
    const u0 = battle([mon("잠만보", ["소란피기"])], [mon("후딘", ["최면술", "잠자기"], null, null, pts({ hp: 32, spe: 32 }))]);
    u0.b.status = { condition: "sleep", turnsElapsed: 0, sleepTurnsRemaining: 3 };
    const u1 = run(u0, "소란피기", "최면술");
    const woke = (own(u1, "a")?.uproarWokeIds ?? []).includes(u0.b.slot.pokemonId);
    const u2out = run(u1.nextState, "소란피기", "최면술");
    const noSleep = u2out.nextState.a.status.condition !== "sleep";
    const restOut = run(u2out.nextState, "소란피기", "잠자기");
    const restFailed = own(restOut, "b")?.blockedReason === "usageCondition";
    const uEnd = restOut.nextState.a;
    const uproarEnded = !uEnd.volatile.active.rampage && !uEnd.volatile.active.confusion && own(restOut, "a")?.rampageEnded === true;
    check(
      "1.9 소란피기: 잠든 상대 깨움 · 소란 중 최면술·잠자기 실패 · 3턴 뒤 혼란 없이 끝",
      woke && noSleep && restFailed && uproarEnded,
      `깨움 ${woke} 잠듦 막힘 ${noSleep} 잠자기 실패 ${restFailed} 끝 ${uproarEnded}`,
    );
    // AI: 역린을 새로 쓰면 긴 대면에선 끝난 뒤 혼란 비용(처치 턴↑) — 마이페이스는 비용 없음
    const cost = (ability) => opt(ev.evaluateOptions(battle([mon("한카리아스", ["역린"], ability)], [tank(["누르기"])]), "a"), "역린").hitsToKill.expected;
    const withCost = cost(null);
    const noCost = cost("마이페이스");
    check("1.9 난동: AI 역린 선택 시 끝난 뒤 혼란 비용(긴 대면 처치 턴↑, 마이페이스는 없음)", withCost > noCost, `${noCost.toFixed(2)} → ${withCost.toFixed(2)}`);
    // AI: 난동 중엔 선택지가 그 기술 하나(교체 없음)
    const aiOpts = ev.evaluateOptions(s1, "a");
    check(
      "1.9 난동: AI 선택지는 난동 기술 하나(교체 없음)",
      aiOpts.length === 1 && aiOpts[0].move?.id === "역린",
      aiOpts.map((o) => o.move?.id ?? `교체${o.toIndex}`).join(","),
    );
  }
}
