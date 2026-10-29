// 트랙 M1·M2(ver.1.8) 엔진 신규 변화기·AI 평가
export default async function ({ server, data, ev, dec, pts, mon, battle, opt, check }) {
  // ── 트랙 M1(ver.1.8): 엔진 신규 변화기 + 구애 잠금 엔진 이관 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const st0 = await server.ssrLoadModule("/src/lib/battle/state.ts");
    const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
    const P = dec.DEFAULT_DECISION_PARAMS;
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const turn = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.5).nextState;
    const score = (o, params = P) => dec.scoreOption(o, 0.5, params);
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    // 구애 잠금: 구애스카프를 지닌 채 기술을 쓰면 그 기술로 잠기고, 트릭으로 넘기면 넘긴 쪽은 풀리고 받은 쪽은 다음 기술부터
    {
      const st = battle([mon("팬텀", ["트릭", "섀도볼"], null, "구애스카프")], [mon("잠만보", ["누르기", "하품"], null, "먹다남은음식", pts({ hp: 32 }))]);
      const s1 = turn(st, "섀도볼", "누르기");
      const lockedBefore = st0.choiceLockedMoveOf(s1.a);
      const s2 = turn(s1, "트릭", "누르기");
      const s3 = turn(s2, "섀도볼", "하품");
      check(
        "M1: 트릭 — 도구 교환 + 구애 잠금 이전(넘긴 쪽 해제, 받은 쪽은 받은 뒤 처음 쓴 기술로 잠김 — 같은 턴 후공이면 그 기술)",
        lockedBefore === "섀도볼" && s2.a.currentItemId === "먹다남은음식" && s2.b.currentItemId === "구애스카프" && st0.choiceLockedMoveOf(s2.a) === null && st0.choiceLockedMoveOf(s2.b) === "누르기" && st0.choiceLockedMoveOf(s3.b) === "누르기",
        `잠금전=${lockedBefore} 내도구=${s2.a.currentItemId} 상대도구=${s2.b.currentItemId} 상대잠금=${st0.choiceLockedMoveOf(s2.b)}`,
      );
      const none = battle([mon("팬텀", ["트릭"])], [mon("잠만보", ["누르기"])]);
      const s4 = turn(none, "트릭", "누르기");
      const sticky = battle([mon("팬텀", ["트릭"], null, "구애스카프")], [mon("잠만보", ["누르기"], "점착", "먹다남은음식")]);
      const s5 = turn(sticky, "트릭", "누르기");
      check("M1: 트릭 실패 — 둘 다 무도구·점착", !s4.a.currentItemId && s5.b.currentItemId === "먹다남은음식", `점착=${s5.b.currentItemId}`);
    }
    // 아픔나누기: 두 HP 합을 반씩
    {
      const st = battle([mon("팬텀", ["아픔나누기"], null, null, pts())], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]);
      st.a.currentHp = 20;
      const total = st.a.currentHp + st.b.currentHp;
      const s1 = turn(st, "아픔나누기", "칼춤");
      const half = Math.floor(total / 2);
      check("M1: 아픔나누기 — HP 합을 반씩(최대 HP까지)", s1.a.currentHp === Math.min(s1.a.maxHp, half) && s1.b.currentHp === Math.min(s1.b.maxHp, half), `${s1.a.currentHp}/${s1.b.currentHp} 반=${half}`);
      const o = optOf(battle([mon("팬텀", ["아픔나누기", "섀도볼"], null, null, pts())], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]), "아픔나누기");
      check("M1: 아픔나누기 AI — HP 변화 반영(hpAfter)", !!o.support?.effect?.hpAfter && Number.isFinite(score(o)), JSON.stringify(o.support?.effect?.hpAfter));
    }
    // 순풍: 4턴(쓴 턴 포함) 스피드 2배, 이미 불면 실패, 끝나면 "멈췄다"
    {
      const st = battle([mon("잠만보", ["순풍", "누르기"])], [mon("팬텀", ["칼춤"])]);
      const before = toi.computeTurnOrderSpeed(st, st.a);
      let s = turn(st, "순풍", "칼춤");
      const doubled = toi.computeTurnOrderSpeed(s, s.a);
      const again = rt.runTurn(s, act("순풍"), act("칼춤"), () => 0.5).result.actions.find((x) => x.actor === "a");
      let expired = false;
      for (let i = 0; i < 3; i++) {
        const out = rt.runTurn(s, act("누르기"), act("칼춤"), () => 0.5);
        if (out.result.expiredTailwind?.includes("a")) expired = i === 2;
        s = out.nextState;
      }
      const e = optOf(battle([mon("잠만보", ["순풍", "누르기"])], [mon("팬텀", ["칼춤"])]), "순풍").support?.effect;
      check(
        "M1: 순풍 — 스피드 2배·중복 실패·4턴째 끝에 멈춤 + AI 선공 반영",
        doubled === before * 2 && again?.tailwindSetFailed === true && expired && !(s.sideA.tailwindTurnsRemaining > 0) && e && e.hit.firstProbability >= e.base.firstProbability,
        `스피드 ${before}→${doubled} 멈춤=${expired} p ${e?.base.firstProbability}→${e?.hit.firstProbability}`,
      );
    }
    // 생명의물방울(1/4 회복)·꿀꺽(비축 2 → 1/2 회복·비축과 방어/특방 되돌림, 0이면 실패)·리사이클
    {
      const dew = battle([mon("잠만보", ["생명의물방울"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["칼춤"])]);
      dew.a.currentHp = Math.floor(dew.a.maxHp / 2);
      const d1 = turn(dew, "생명의물방울", "칼춤");
      const sw = battle([mon("잠만보", ["꿀꺽"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["칼춤"])]);
      sw.a.currentHp = 10;
      sw.a.stockpileCount = 2;
      sw.a.stages = { ...sw.a.stages, def: 2, spd: 2 };
      const w1 = turn(sw, "꿀꺽", "칼춤");
      const empty = battle([mon("잠만보", ["꿀꺽"])], [mon("팬텀", ["칼춤"])]);
      const wAct = rt.runTurn(empty, act("꿀꺽"), act("칼춤"), () => 0.5).result.actions.find((x) => x.actor === "a");
      const rc = battle([mon("잠만보", ["리사이클"])], [mon("팬텀", ["칼춤"])]);
      rc.a.currentItemId = null;
      rc.a.lastConsumedItemId = "자뭉열매";
      const r1 = turn(rc, "리사이클", "칼춤");
      check(
        "M1: 생명의물방울·꿀꺽·리사이클",
        d1.a.currentHp - dew.a.currentHp === Math.floor(dew.a.maxHp / 4) &&
          w1.a.currentHp === 10 + Math.floor(w1.a.maxHp / 2) && w1.a.stockpileCount === 0 && w1.a.stages.def === 0 &&
          wAct?.stockpileHealFailed === true && r1.a.currentItemId === "자뭉열매",
        `물방울+${d1.a.currentHp - dew.a.currentHp} 꿀꺽HP=${w1.a.currentHp} 비축=${w1.a.stockpileCount} 리사이클=${r1.a.currentItemId}`,
      );
    }
  }
  // ── 트랙 M2(ver.1.8): 자기암시·원한·봉인·트집·흉내쟁이·경혈찌르기·파워셰어 (엔진) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.5);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 자기암시: 상대 랭크 복사 / 파워셰어: 공격·특공 평균
    {
      const st = battle([mon("팬텀", ["자기암시", "파워셰어"])], [mon("잠만보", ["칼춤"])]);
      st.b.stages = { ...st.b.stages, atk: 2, spe: -1 };
      st.b.accuracyStages = { ...st.b.accuracyStages, evasion: 1 };
      const s1 = run(st, "자기암시", "칼춤").nextState;
      const avgAtk = Math.floor((st.a.realStats.atk + st.b.realStats.atk) / 2);
      const avgSpa = Math.floor((st.a.realStats.spa + st.b.realStats.spa) / 2);
      const s2 = run(st, "파워셰어", "칼춤").nextState;
      check(
        "M2: 자기암시(랭크 복사)·파워셰어(공격·특공 평균)",
        s1.a.stages.atk === 2 && s1.a.stages.spe === -1 && s1.a.accuracyStages.evasion === 1 &&
          s2.a.realStats.atk === avgAtk && s2.b.realStats.atk === avgAtk && s2.a.realStats.spa === avgSpa && s2.b.realStats.spa === avgSpa,
        `복사 atk=${s1.a.stages.atk} spe=${s1.a.stages.spe} 공격=${s2.a.realStats.atk}/${s2.b.realStats.atk}(${avgAtk})`,
      );
    }
    // 원한: 상대 직전 기술 PP −4, 쓴 기술이 없으면 실패
    {
      const st = battle([mon("팬텀", ["원한"])], [mon("잠만보", ["누르기", "칼춤"])]);
      const fresh = actionOf(run(st, "원한", "칼춤"), "a");
      st.b.lastMoveId = "누르기";
      const before = st.b.remainingPp["누르기"];
      const out = run(st, "원한", "칼춤");
      check(
        "M2: 원한 — 직전 기술 PP −4 / 쓴 기술 없으면 실패",
        fresh?.spiteFailed === true && out.nextState.b.remainingPp["누르기"] === before - 4 && actionOf(out, "a")?.spitePp?.amount === 4,
        `PP ${before}→${out.nextState.b.remainingPp["누르기"]} 실패=${fresh?.spiteFailed}`,
      );
    }
    // 트집: 같은 기술 연속 불가 / 봉인: 시전자가 배운 기술 사용 불가
    {
      const st = battle([mon("팬텀", ["트집", "봉인", "누르기"])], [mon("잠만보", ["누르기", "칼춤"])]);
      const t1 = run(st, "트집", "누르기");
      const t2 = run(t1.nextState, "누르기", "누르기");
      const t3 = run(t2.nextState, "누르기", "칼춤");
      const i1 = run(st, "봉인", "누르기");
      const i2 = run(i1.nextState, "누르기", "칼춤");
      const again = actionOf(run(i1.nextState, "봉인", "칼춤"), "a");
      check(
        "M2: 트집(연속 사용 불가)·봉인(시전자 기술 사용 불가·중복 실패)",
        actionOf(t2, "b")?.moveRestrictionKind === "torment" && !actionOf(t3, "b")?.blockedReason &&
          actionOf(i1, "b")?.moveRestrictionKind === "imprison" && !actionOf(i2, "b")?.blockedReason && again?.statusInflictFailed === true,
        `트집=${actionOf(t2, "b")?.moveRestrictionKind} 봉인=${actionOf(i1, "b")?.moveRestrictionKind} 재봉인실패=${again?.statusInflictFailed}`,
      );
    }
    // 흉내쟁이: 이번 턴 먼저 나온 상대 기술을 따라 씀 / 나온 기술이 없거나 방어류면 실패
    {
      const st = battle([mon("잠만보", ["흉내쟁이"])], [mon("팬텀", ["칼춤", "방어"])]);
      const c1 = run(st, "흉내쟁이", "칼춤");
      const fast = battle([mon("팬텀", ["흉내쟁이"])], [mon("잠만보", ["칼춤", "방어"])]);
      const c2 = actionOf(run(fast, "흉내쟁이", "칼춤"), "a");
      const c3 = actionOf(run(st, "흉내쟁이", "방어"), "a");
      // 턴·기절 교체를 넘어서도 직전 기술을 기억한다(사용자 제보: 죽기살기 → 객기로 기절 → 교체해 나온 흉내쟁이 = 객기)
      const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
      const chain = battle([mon("시비꼬", ["죽기살기"]), mon("마임맨", ["흉내쟁이"])], [mon("가디안", ["객기", "사이코키네시스"])]);
      chain.a.currentHp = 5;
      const k1 = run(chain, "죽기살기", "객기");
      const afterFaint = k1.forcedSwitch?.a ? sw.applySwitch(k1.nextState, "a", 1).nextState : k1.nextState;
      const k2 = actionOf(run(afterFaint, "흉내쟁이", "사이코키네시스"), "a");
      check(
        "M2: 흉내쟁이 — 기절 교체 뒤 다음 턴에도 직전 기술(객기)을 따라 씀",
        afterFaint.lastMoveUsedId === "객기" && k2?.copycatCalledMoveName === "객기" && k2.damage > 0,
        `교체 뒤 기록=${afterFaint.lastMoveUsedId} 따라씀=${k2?.copycatCalledMoveName} 데미지=${k2?.damage}`,
      );
      check(
        "M2: 흉내쟁이 — 직전 기술 따라 쓰기 / 없음·방어류면 실패",
        c1.nextState.a.stages.atk === 2 && actionOf(c1, "a")?.copycatCalledMoveName === "칼춤" && c2?.blockedReason === "usageCondition" && c3?.blockedReason === "usageCondition",
        `공격=${c1.nextState.a.stages.atk} 선공=${c2?.blockedReason} 방어=${c3?.blockedReason}`,
      );
    }
    // 경혈찌르기: +6이 아닌 능력 하나가 2 오른다 / 전부 +6이면 실패
    {
      const st = battle([mon("잠만보", ["경혈찌르기"])], [mon("팬텀", ["칼춤"])]);
      const s1 = run(st, "경혈찌르기", "칼춤");
      const sum = (f) => Object.values(f.stages).reduce((a, b) => a + b, 0) + f.accuracyStages.accuracy + f.accuracyStages.evasion;
      const maxed = battle([mon("잠만보", ["경혈찌르기"])], [mon("팬텀", ["칼춤"])]);
      maxed.a.stages = { atk: 6, def: 6, spa: 6, spd: 6, spe: 6 };
      maxed.a.accuracyStages = { accuracy: 6, evasion: 6 };
      const failed = actionOf(run(maxed, "경혈찌르기", "칼춤"), "a");
      check(
        "M2: 경혈찌르기 — 무작위 능력 +2 / 전부 +6이면 실패",
        sum(s1.nextState.a) === 2 && actionOf(s1, "a")?.acupressureRaised?.delta === 2 && failed?.acupressureFailed === true,
        `합=${sum(s1.nextState.a)} ${JSON.stringify(actionOf(s1, "a")?.acupressureRaised)}`,
      );
    }
  }
  // ── 트랙 M2(ver.1.8): AI 평가 ──
  {
    const P = dec.DEFAULT_DECISION_PARAMS;
    const score = (o, params = P) => dec.scoreOption(o, 0.5, params);
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    const offM = { ...P, trackMAware: false };
    // 자기암시: 상대 공격 +2를 복사하면 처치가 빨라진다 / 같은 랭크면 안 씀
    {
      const st = battle([mon("잠만보", ["자기암시", "누르기"], null, null, pts({ atk: 32, hp: 32 }))], [mon("블래키", ["깨물어부수기", "칼춤"])]);
      st.b.stages = { ...st.b.stages, atk: 2, spa: 2 };
      const o = optOf(st, "자기암시");
      const e = o.support?.effect;
      const flat = optOf(battle([mon("잠만보", ["자기암시", "누르기"])], [mon("블래키", ["깨물어부수기"])]), "자기암시");
      check(
        "M2 AI: 자기암시 — 복사한 랭크로 대면 재계산 / 같은 랭크면 안 씀·토글",
        e?.kind === "copyStages" && e.hit.killTurns < e.base.killTurns && Number.isFinite(score(o)) && score(flat) === -Infinity && score(o, offM) === -Infinity,
        `c ${e?.base.killTurns}→${e?.hit.killTurns}`,
      );
    }
    // 파워셰어: 공격이 약한 쪽이 쓰면 처치가 빨라진다
    {
      const st = battle([mon("블래키", ["파워셰어", "지구던지기"], null, null, pts({ hp: 32, def: 32 }))], [mon("메타그로스", ["코멧펀치"])]);
      const e = optOf(st, "파워셰어").support?.effect;
      check("M2 AI: 파워셰어 — 공격·특공 평균 반영", e?.kind === "powerSplit" && e.hit.survivalTurns > e.base.survivalTurns, `d ${e?.base.survivalTurns}→${e?.hit.survivalTurns}`);
    }
    // 원한: 직전 기술 PP를 0으로 만들 때만
    {
      const mk = (pp) => {
        const st = battle([mon("메타그로스", ["원한", "코멧펀치"])], [mon("잠만보", ["누르기"])]);
        st.b.lastMoveId = "누르기";
        st.b.remainingPp["누르기"] = pp;
        return optOf(st, "원한");
      };
      const zero = mk(4);
      const many = mk(12);
      check(
        "M2 AI: 원한 — PP를 0으로 만들면 평가(유일한 공격기 봉쇄) / 아니면 안 씀",
        zero.support?.effect?.kind === "spite" && Number.isFinite(score(zero)) && zero.support.effect.hit.survivalTurns > zero.support.effect.base.survivalTurns && score(many) === -Infinity,
        `d ${zero.support?.effect?.base.survivalTurns}→${zero.support?.effect?.hit.survivalTurns}`,
      );
    }
    // 봉인: 상대 공격기를 나도 배웠으면 그 기술을 막는다 / 겹치는 기술이 없으면 안 씀
    {
      const st = battle([mon("팬텀", ["봉인", "섀도볼"])], [mon("블래키", ["섀도볼"])]);
      const o = optOf(st, "봉인");
      const none = optOf(battle([mon("팬텀", ["봉인", "섀도볼"])], [mon("잠만보", ["누르기"])]), "봉인");
      check(
        "M2 AI: 봉인 — 겹치는 공격기 봉쇄 / 겹치는 기술 없으면 안 씀",
        o.support?.effect?.kind === "imprison" && o.support.effect.hit.survivalTurns > o.support.effect.base.survivalTurns && score(none) === -Infinity,
        `d ${o.support?.effect?.base.survivalTurns}→${o.support?.effect?.hit.survivalTurns}`,
      );
    }
    // 트집: 최선 공격기를 한 턴 걸러 쓰게 된다(대면 절반만큼 섞음)
    {
      const st = battle([mon("잠만보", ["트집", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("메타그로스", ["코멧펀치", "전광석화"])]);
      const e = optOf(st, "트집").support?.effect;
      check(
        "M2 AI: 트집 — 최선 공격기 격턴 봉쇄로 생존 턴 증가",
        e?.kind === "torment" && e.hit.survivalTurns > e.base.survivalTurns && Number.isFinite(e.party?.turns),
        `d ${e?.base.survivalTurns}→${e?.hit.survivalTurns} 섞은턴=${e?.party?.turns}`,
      );
    }
    // 경혈찌르기: 능력별 갈래 평균
    {
      const o = optOf(battle([mon("잠만보", ["경혈찌르기", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("팬텀", ["섀도볼"])]), "경혈찌르기");
      const e = o.support?.effect;
      check("M2 AI: 경혈찌르기 — 7갈래 평균", e?.kind === "acupressure" && e.branches?.length === 7 && Number.isFinite(score(o)), `갈래=${e?.branches?.length}`);
    }
    // 흉내쟁이: 후공이면 상대가 이번 턴 낼 기술 갈래 / 선공인데 나온 기술이 없으면 안 씀
    {
      const slow = optOf(battle([mon("잠만보", ["흉내쟁이", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("메타그로스", ["코멧펀치", "칼춤"])]), "흉내쟁이");
      const fast = optOf(battle([mon("팬텀", ["흉내쟁이", "섀도볼"])], [mon("잠만보", ["누르기"])]), "흉내쟁이");
      const copied = slow.copycat?.branches.filter((b) => b.option).map((b) => b.option.move.id) ?? [];
      check(
        "M2 AI: 흉내쟁이 — 후공 상대 기술 갈래 평가 / 선공·기록 없음이면 안 씀·토글",
        copied.length > 0 && Number.isFinite(score(slow)) && score(fast) === -Infinity && score(slow, offM) === -Infinity,
        `갈래=${copied.join(",")} 점수=${score(slow).toFixed(3)}`,
      );
    }
  }
}
