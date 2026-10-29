// ver.1.9 기술 엔진 배선·AI 정확도·조건부 위력·급소·교체 봉쇄
export default async function ({ server, data, ev, dec, pts, mon, battle, opt, check }) {
  // ── ver.1.9 기술 엔진 배선: 독침천발·백귀야행·분화·해수스파우팅·그림자꿰매기·배수의진·섬뜩한주문 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.5) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => r);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    const dmg = (st, moveId) => actionOf(run(st, moveId, "칼춤"), "a")?.damage ?? 0;
    // 조건부 2배(독침천발 = 상대 독·맹독, 백귀야행 = 상대 아무 상태이상) · HP 비례 위력(분화)
    {
      // 한카리아스(드래곤·땅): 독·고스트·불꽃 모두 등배
      const base = () => battle([mon("팬텀", ["독침천발", "백귀야행", "분화"])], [mon("한카리아스", ["칼춤"], null, null, pts({ hp: 32, def: 32, spd: 32 }))]);
      const plain = base();
      const poisoned = base();
      poisoned.b.status = { condition: "poison", turnsElapsed: 0 };
      const paralyzed = base();
      paralyzed.b.status = { condition: "paralysis", turnsElapsed: 0 };
      const half = base();
      half.a.currentHp = Math.floor(half.a.maxHp / 2);
      const ratio = (a, b) => (b > 0 ? a / b : 0);
      const barb = ratio(dmg(poisoned, "독침천발"), dmg(plain, "독침천발"));
      const barbPar = ratio(dmg(paralyzed, "독침천발"), dmg(plain, "독침천발"));
      const hex = ratio(dmg(paralyzed, "백귀야행"), dmg(plain, "백귀야행"));
      const erupt = ratio(dmg(half, "분화"), dmg(plain, "분화"));
      check(
        "1.9: 독침천발(독이면 2배)·백귀야행(상태이상이면 2배)·분화(HP 절반이면 위력 절반)",
        barb > 1.8 && barb < 2.2 && Math.abs(barbPar - 1) < 0.05 && hex > 1.8 && hex < 2.2 && erupt > 0.4 && erupt < 0.6,
        `독침천발 ×${barb.toFixed(2)}(마비 ×${barbPar.toFixed(2)}) 백귀야행 ×${hex.toFixed(2)} 분화 ×${erupt.toFixed(2)}`,
      );
      // 매치업 계산기(AI 공유): 상태이상·HP 비율 입력이 같은 배율로
      const slot = mon("팬텀", ["독침천발"]).slot;
      const foe = mon("한카리아스", ["칼춤"]).slot;
      const off = (id, o) => me.evaluateSlotMatchup(slot, data.getMove(id), foe, o)?.offensePower ?? 0;
      check(
        "1.9: 매치업 계산기 — 독 상태·HP 비율 반영(독침천발 ×2, 분화 HP 50% ×0.5)",
        Math.abs(off("독침천발", { defenderStatus: "poison" }) / off("독침천발", {}) - 2) < 0.02 &&
          Math.abs(off("분화", { attackerHpFraction: 0.5 }) / off("분화", {}) - 0.5) < 0.02,
        `독침천발 ${off("독침천발", {})}→${off("독침천발", { defenderStatus: "poison" })} 분화 ${off("분화", {})}→${off("분화", { attackerHpFraction: 0.5 })}`,
      );
    }
    // 결정력·내구력 페이지 가정 토글(ver.1.9): 늦게 행동(보복·눈사태 2배)·공격측 상태이상(객기)·HP 비례(기사회생)·특성 HP 조건 분리
    {
      const atk = mon("한카리아스", ["보복"], "맹화").slot;
      const foe = mon("잠만보", ["칼춤"]).slot;
      const off = (id, o) => me.evaluateSlotMatchup(atk, data.getMove(id), foe, o)?.offensePower ?? 0;
      const solo = (id, o) => me.computeSoloOffensePower(atk, data.getMove(id), o) ?? 0;
      const r = (a, b) => (b > 0 ? a / b : 0);
      const payback = r(off("보복", { attackerMovesLast: true }), off("보복", {}));
      const avalanche = r(solo("눈사태", { attackerTookDamageThisTurn: true }), solo("눈사태", {}));
      const avalancheLast = r(solo("눈사태", { attackerMovesLast: true }), solo("눈사태", {}));
      const facade = r(off("객기", { attackerStatus: "burn" }), off("객기", {}));
      const reversal = r(off("기사회생", { attackerHpFraction: 0.1 }), off("기사회생", {}));
      // 맹화: 불꽃 기술, HP 슬라이더(attackerHpFraction)가 아니라 abilityHpFraction으로만 발동
      const blaze = r(off("화염방사", { abilityHpFraction: 1 / 3 }), off("화염방사", { attackerHpFraction: 0.2, abilityHpFraction: 1 }));
      check(
        "1.9 계산기: 늦게 행동(보복 2배)·이번 턴 데미지 입음(눈사태 2배, 늦게 행동만으론 ×1)·객기 화상 2배·기사회생 HP 10%(위력 150)·맹화는 특성 HP 가정으로만",
        Math.abs(payback - 2) < 0.02 && Math.abs(avalanche - 2) < 0.02 && Math.abs(avalancheLast - 1) < 0.02 && Math.abs(facade - 2) < 0.02 && Math.abs(reversal - 7.5) < 0.05 && Math.abs(blaze - 1.5) < 0.02,
        `보복 ×${payback.toFixed(2)} 눈사태 ×${avalanche.toFixed(2)} 객기 ×${facade.toFixed(2)} 기사회생 ×${reversal.toFixed(2)} 맹화 ×${blaze.toFixed(2)}`,
      );
    }
    // 근성(ver.1.9 본가 규칙): 상태이상이면 물리 ×1.5, 화상이어도 반감 없음 — 엔진·계산기(AI) 같은 배율
    {
      const base = () => battle([mon("괴력몬", ["인파이트"], "근성")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))]);
      const plain = base();
      const burned = base();
      burned.a.status = { condition: "burn", turnsElapsed: 0 };
      const noGuts = battle([mon("괴력몬", ["인파이트"], "노가드")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))]);
      noGuts.a.status = { condition: "burn", turnsElapsed: 0 };
      const noGutsPlain = battle([mon("괴력몬", ["인파이트"], "노가드")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))]);
      const guts = dmg(burned, "인파이트") / dmg(plain, "인파이트");
      const burnOnly = dmg(noGuts, "인파이트") / dmg(noGutsPlain, "인파이트");
      const sc = await server.ssrLoadModule("/src/lib/statusConditions.ts");
      check(
        "1.9: 근성 — 상태이상이면 물리 ×1.5(화상 반감 없음), 근성 없으면 화상 ×0.5",
        guts > 1.4 && guts < 1.6 && burnOnly > 0.45 && burnOnly < 0.55 && sc.computeStatusAttackMultiplier("poison", "physical", true, 1.5) === 1.5 &&
          sc.computeStatusAttackMultiplier("poison", "special", true, 1.5) === 1,
        `근성 화상 ×${guts.toFixed(2)} 화상만 ×${burnOnly.toFixed(2)}`,
      );
    }
    // 그림자꿰매기: 명중하면 상대 교체 봉쇄(고스트 면제, 실패 문구 없음) / 배수의진: 5스탯 +1 + 자신 교체 봉쇄, 이미 걸려 있으면 실패
    {
      const st = battle([mon("팬텀", ["그림자꿰매기"])], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32, def: 32 })), mon("한카리아스", ["지진"])]);
      const s1 = run(st, "그림자꿰매기", "칼춤").nextState;
      const ghostOut = run(battle([mon("팬텀", ["그림자꿰매기"])], [mon("팬텀", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))]), "그림자꿰매기", "칼춤");
      const nr = battle([mon("잠만보", ["배수의진"]), mon("팬텀", ["칼춤"])], [mon("메타그로스", ["칼춤"])]);
      const n1 = run(nr, "배수의진", "칼춤").nextState;
      const again = actionOf(run(n1, "배수의진", "칼춤"), "a");
      check(
        "1.9: 그림자꿰매기(상대 교체 봉쇄·고스트 면제)·배수의진(5스탯 +1·자신 교체 봉쇄·중복 실패)",
        sw.isTrappedFromSwitching(s1.b, s1) && !sw.isTrappedFromSwitching(ghostOut.nextState.b, ghostOut.nextState) &&
          !actionOf(ghostOut, "a")?.statusInflictFailed &&
          n1.a.stages.atk === 1 && n1.a.stages.spe === 1 && sw.isTrappedFromSwitching(n1.a, n1) && again?.blockedReason === "usageCondition",
        `그림자꿰매기 봉쇄=${sw.isTrappedFromSwitching(s1.b, s1)} 배수의진 atk=${n1.a.stages.atk} 봉쇄=${sw.isTrappedFromSwitching(n1.a, n1)} 재사용=${again?.blockedReason}`,
      );
    }
    // 섬뜩한주문: 상대 직전 기술 PP −3, 쓴 기술이 없으면 조용히 무산(데미지 기술이라 실패 문구 없음)
    {
      const st = battle([mon("팬텀", ["섬뜩한주문"])], [mon("잠만보", ["누르기", "칼춤"], null, null, pts({ hp: 32, spd: 32 }))]);
      const fresh = actionOf(run(st, "섬뜩한주문", "칼춤"), "a");
      st.b.lastMoveId = "누르기";
      const before = st.b.remainingPp["누르기"];
      const out = run(st, "섬뜩한주문", "칼춤");
      check(
        "1.9: 섬뜩한주문 — 직전 기술 PP −3 / 쓴 기술 없으면 조용히 무산",
        !fresh?.spiteFailed && out.nextState.b.remainingPp["누르기"] === before - 3 && actionOf(out, "a")?.spitePp?.amount === 3,
        `PP ${before}→${out.nextState.b.remainingPp["누르기"]} 실패문구=${fresh?.spiteFailed}`,
      );
    }
  }
  // ── ver.1.9 6-1 AI 정확도 묶음: 기습 양쪽·사이코필드 접지·보복·눈사태·분함의발구르기·반감 열매 첫 타만 ──
  {
    const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
    const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
    const htk = await server.ssrLoadModule("/src/lib/battle/ai/hitsToKill.ts");
    const tank = (moves, item = null) => mon("잠만보", moves, null, item, pts({ hp: 32, def: 32 }));
    // 내 기습: 성공 확률 = 상대가 공격기를 고를 확률(의미 있는 변화기 1개당 0.08) — 변화기뿐이면 0
    {
      const acc = (foeMoves) => opt(ev.evaluateOptions(battle([mon("앱솔", ["기습", "치근거리기"])], [tank(foeMoves)]), "a"), "기습")?.accuracy ?? -1;
      const allAttack = acc(["누르기", "지진"]);
      const twoStatus = acc(["누르기", "칼춤", "하품"]);
      const statusOnly = acc(["칼춤", "하품"]);
      check(
        "1.9 6-1: 내 기습 — 상대 공격기 확률만큼 성공(공격기뿐 1, 변화기 2개 0.84, 변화기뿐 0)",
        Math.abs(allAttack - 1) < 1e-9 && Math.abs(twoStatus - 0.84) < 1e-9 && statusOnly === 0,
        `공격기뿐 ${allAttack} 변화기2 ${twoStatus.toFixed(2)} 변화기뿐 ${statusOnly}`,
      );
    }
    // 상대 기습: AI가 변화기·교체를 고르면 상대 행동이 헛수고(확률 = 상대 기습 사용 확률), 공격기면 성공. 사이코필드면 땅에 있는 AI에게 실패
    {
      const st = battle([mon("한카리아스", ["지진", "칼춤"]), mon("잠만보", ["누르기"])], [mon("앱솔", ["기습"])]);
      const opts = ev.evaluateOptions(st, "a");
      const statusIdle = opt(opts, "칼춤")?.opponentIdleChance ?? 0;
      const attackIdle = opt(opts, "지진")?.opponentIdleChance ?? 0;
      const switchIdle = opts.find((o) => o.optionType === "switch")?.opponentIdleChance ?? 0;
      const psychic = (flyer) => {
        const b = battle([mon(flyer ? "리자몽" : "한카리아스", ["칼춤"])], [mon("앱솔", ["기습"])]);
        b.field = "사이코필드";
        b.fieldTurnsRemaining = 5;
        return opt(ev.evaluateOptions(b, "a"), "칼춤")?.hitsToBeKilled.expected;
      };
      const groundedD = psychic(false);
      const flyingD = psychic(true);
      check(
        "1.9 6-1: 상대 기습 — AI 변화기·교체면 헛수고 확률 1, 공격기면 0 / 사이코필드: 땅 AI에겐 실패, 비행 AI에겐 통함",
        statusIdle === 1 && switchIdle === 1 && attackIdle === 0 && groundedD === Infinity && Number.isFinite(flyingD),
        `변화기 ${statusIdle} 교체 ${switchIdle} 공격기 ${attackIdle} 사이코필드 d 땅 ${groundedD} 비행 ${flyingD?.toFixed(2)}`,
      );
      // 헛수고 확률만큼 lost=0과 섞으므로 칼춤 점수가 오른다
      const sd = opt(opts, "칼춤");
      const withIdle = dec.scoreOption(sd, 0.5);
      const withoutIdle = dec.scoreOption({ ...sd, opponentIdleChance: undefined }, 0.5);
      check("1.9 6-1: 상대 기습 헛수고 → AI 변화기 점수 상승", withIdle > withoutIdle, `${withoutIdle.toFixed(3)} → ${withIdle.toFixed(3)}`);
    }
    // 보복(후공 2배)·눈사태(후공이면 상대 공격 확률만큼 2배)·분함의발구르기(계산기는 직전 실패 가정일 때만 2배)
    {
      const st = battle([mon("마기라스", ["보복", "눈사태", "분함의발구르기"])], [tank(["누르기"])]);
      const statusFoe = battle([mon("마기라스", ["눈사태"])], [tank(["칼춤", "하품"])]);
      const frac = (b, id, second) =>
        md.estimateMoveHits({ state: b, attacker: b.a, defender: b.b, defenderSide: b.sideB, attackerMovesSecond: second }, data.getMove(id))?.damageFraction ?? 0;
      const payback = frac(st, "보복", true) / frac(st, "보복", false);
      const avalanche = frac(st, "눈사태", true) / frac(st, "눈사태", false);
      const avalancheStatus = frac(statusFoe, "눈사태", true) / frac(statusFoe, "눈사태", false);
      const calc = me.evaluateSlotMatchup(st.a.slot, data.getMove("분함의발구르기"), st.b.slot, { attackerMoveFailedLastTurn: true })?.offensePower ?? 0;
      const calcAi = me.evaluateSlotMatchup(st.a.slot, data.getMove("분함의발구르기"), st.b.slot, {})?.offensePower ?? 0;
      check(
        "1.9 6-1: AI 보복 후공 ×2·눈사태 후공 ×(1+공격 확률)·분함의발구르기 계산기 직전 실패 가정 ×2(기본 ×1)",
        Math.abs(payback - 2) < 0.02 && Math.abs(avalanche - 2) < 0.02 && Math.abs(avalancheStatus - 1) < 0.02 && Math.abs(calc / calcAi - 2) < 0.02,
        `보복 ×${payback.toFixed(2)} 눈사태 ×${avalanche.toFixed(2)}(변화기뿐 ×${avalancheStatus.toFixed(2)}) 발구르기 가정/기본 ×${(calc / calcAi).toFixed(2)}`,
      );
    }
    // 반감 열매는 첫 타만: 계산기 다단히트 5타 = 내구력 ×1/(0.2/2+0.8)·2타 ×1/(0.5/2+0.5), AI 처치 턴 = 열매 없음 < 첫 타만 < 매 타 반감(이전 근사)
    {
      const atk = mon("한카리아스", ["스케일샷"]).slot;
      const foe = (item) => mon("한카리아스", ["칼춤"], null, item, pts({ hp: 32, def: 32 })).slot;
      const bulk = (item, hits) => me.evaluateSlotMatchup(atk, data.getMove("스케일샷"), foe(item), { multiHitCount: hits })?.bulkPower ?? 0;
      const multi = bulk("하반열매", 5) / bulk(null, 5);
      const twoHits = bulk("하반열매", 2) / bulk(null, 2);
      const quake = (item) => battle([mon("한카리아스", ["지진"])], [mon("메타그로스", ["코멧펀치"], null, item, pts({ hp: 32, def: 32 }))]);
      const cOf = (b) => opt(ev.evaluateOptions(b, "a"), "지진")?.hitsToKill.expected ?? 0;
      const none = cOf(quake(null));
      const berry = cOf(quake("슈캐열매"));
      const b = quake("슈캐열매");
      const r = me.evaluateSlotMatchup(b.a.slot, data.getMove("지진"), b.b.slot, {});
      // 매 타 반감(이전 근사)이면 열매 몫이 모든 사용에 곱해진다
      const p = r.damageParts;
      const halvedRest = { ...p, finalMultiplier: p.finalMultiplier * p.firstHitFinalMultiplier, firstHitFinalMultiplier: undefined };
      const allHalved = htk.estimateKills({ first: halvedRest, rest: halvedRest, critChance: 0, defenseStat: r.defenseStat, hitCounts: [[1, 1]] }, b.b.currentHp).expected;
      check(
        "1.9 6-1: 반감 열매 첫 타만 — 계산기 다단히트 5타 ×1.11·2타 ×1.33, AI 처치 턴 열매 없음 < 첫 타만 < 매 타 반감",
        Math.abs(multi - 1 / 0.9) < 0.01 && Math.abs(twoHits - 4 / 3) < 0.01 && none < berry && berry < allHalved,
        `5타 ×${multi.toFixed(3)} 2타 ×${twoHits.toFixed(2)} c ${none.toFixed(2)} < ${berry.toFixed(2)} < ${allHalved.toFixed(2)}`,
      );
    }
  }
  // ── ver.1.9 조건부 위력 엔진 배선: 분함의발구르기·열불내기(직전 턴 실패) · 분풀이(이번 턴 능력 하락) · 승부굳히기(이번 턴 대상 피해) · 작아지기 보너스 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const mf = await server.ssrLoadModule("/src/lib/battle/moveFailure.ts");
    const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.5) => rt.runTurn(st, act(a), act(b), () => r);
    const own = (out, key) => out.result.actions.find((x) => x.actor === key);
    const tank = (moves) => mon("잠만보", moves, null, null, pts({ hp: 32, def: 32 }));
    // 1턴 행동 → 실패 기록
    const failedAfter = (aMove, bMove, r = 0.5, setup = () => {}) => {
      const st = battle([mon("마기라스", [aMove, "분함의발구르기", "열불내기"])], [tank([bMove])]);
      setup(st);
      const out = run(st, aMove, bMove, r);
      return { failed: !!out.nextState.a.lastTurnMoveFailed, out };
    };
    const miss = failedAfter("스톤에지", "칼춤", 0.99).failed; // 명중 80%를 0.99로 빗나감
    const hit = failedAfter("스톤에지", "칼춤", 0.5).failed;
    const protectedHit = failedAfter("스톤에지", "방어", 0.5).failed; // 방어에 막힘 → 실패 아님
    const taunted = failedAfter("칼춤", "칼춤", 0.5, (st) => {
      st.a.volatile = { active: { ...st.a.volatile.active, taunt: { turnsRemaining: 3 } } };
    }).failed;
    const fullHeal = failedAfter("HP회복", "칼춤").failed; // HP 가득인데 회복기
    const maxedUp = failedAfter("칼춤", "칼춤", 0.5, (st) => {
      st.a.stages = { ...st.a.stages, atk: 6 };
    }).failed;
    const recharge = failedAfter("파괴광선", "칼춤", 0.5, (st) => {
      st.a.volatile = { active: { ...st.a.volatile.active, recharge: { turnsRemaining: 1 } } };
    });
    check(
      "1.9 엔진: 직전 턴 실패 기록 — 빗나감·도발로 막힘·HP 가득 회복기·+6 랭크업기는 실패, 명중·방어에 막힘·반동으로 쉼은 아님",
      miss && !hit && !protectedHit && taunted && fullHeal && maxedUp && !recharge.failed && own(recharge.out, "a")?.blockedReason === "recharge",
      `빗나감 ${miss} 명중 ${hit} 방어 ${protectedHit} 도발 ${taunted} 회복 ${fullHeal} +6 ${maxedUp} 반동 ${recharge.failed}(${own(recharge.out, "a")?.blockedReason})`,
    );
    // 2턴째 분함의발구르기·열불내기 데미지 2배(실패 기록 있음/없음), 교체하면 기록이 지워진다
    const tantrum = (moveId, failed) => {
      const st = battle([mon("마기라스", [moveId])], [tank(["칼춤"])]);
      st.a.lastTurnMoveFailed = failed || undefined;
      return own(run(st, moveId, "칼춤"), "a")?.damage ?? 0;
    };
    const stomp = tantrum("분함의발구르기", true) / tantrum("분함의발구르기", false);
    const flare = tantrum("열불내기", true) / tantrum("열불내기", false);
    // 분풀이: 먼저 움직인 상대가 내 방어를 내리면 2배 / 승부굳히기: 먼저 움직인 상대가 반동으로 HP를 잃었으면 2배
    const dmgAfter = (aMove, bMove) => {
      const st = battle([mon("마기라스", [aMove], null, null, pts({ hp: 32 }))], [mon("잠만보", [bMove], null, null, pts({ hp: 32, def: 32, spe: 32 }))]);
      return own(run(st, aMove, bMove), "a")?.damage ?? 0;
    };
    const lashOut = dmgAfter("분풀이", "싫은소리") / dmgAfter("분풀이", "칼춤");
    const assurance = dmgAfter("승부굳히기", "이판사판태클") / dmgAfter("승부굳히기", "칼춤");
    // 작아지기 보너스(누르기 데이터 수정): 대상이 작아지기를 썼으면 2배 — 엔진·AI 계산 모두
    const minimize = (used) => {
      const st = battle([mon("잠만보", ["누르기"])], [tank(["칼춤"])]);
      if (used) st.b.usedMoveIds = { ...(st.b.usedMoveIds ?? {}), 작아지기: true };
      const engine = own(run(st, "누르기", "칼춤"), "a")?.damage ?? 0;
      const fresh = battle([mon("잠만보", ["누르기"])], [tank(["칼춤"])]);
      if (used) fresh.b.usedMoveIds = { ...(fresh.b.usedMoveIds ?? {}), 작아지기: true };
      const ai = md.estimateMoveHits({ state: fresh, attacker: fresh.a, defender: fresh.b, defenderSide: fresh.sideB, attackerMovesSecond: false }, data.getMove("누르기"))?.damageFraction ?? 0;
      return { engine, ai };
    };
    const minOn = minimize(true);
    const minOff = minimize(false);
    const near2 = (x) => x > 1.8 && x < 2.2;
    check(
      "1.9 엔진: 분함의발구르기·열불내기 직전 실패 2배 · 분풀이 능력 하락 2배 · 승부굳히기 대상 피해 2배 · 누르기 작아지기 2배(AI 동일)",
      near2(stomp) && near2(flare) && near2(lashOut) && near2(assurance) && near2(minOn.engine / minOff.engine) && near2(minOn.ai / minOff.ai) &&
        data.getMove("승부굳히기").makesContact === true,
      `발구르기 ×${stomp.toFixed(2)} 열불내기 ×${flare.toFixed(2)} 분풀이 ×${lashOut.toFixed(2)} 승부굳히기 ×${assurance.toFixed(2)} 작아지기 엔진 ×${(minOn.engine / minOff.engine).toFixed(2)} AI ×${(minOn.ai / minOff.ai).toFixed(2)}`,
    );
    // actionFailed 판정 표(정의 목록): 행동불능·풀죽음·필드 무효는 실패, 헤롱헤롱·대타 흡수는 아님
    const base = { move: data.getMove("스톤에지"), hit: true, typeEffectiveness: 1 };
    const table = {
      paralysis: mf.actionFailed({ ...base, blockedReason: "status" }),
      flinch: mf.actionFailed({ ...base, blockedReason: "flinch" }),
      confusion: mf.actionFailed({ ...base, blockedReason: "confusion" }),
      psychicField: mf.actionFailed({ ...base, blockedReason: "psychicFieldPriority" }),
      immune: mf.actionFailed({ ...base, typeEffectiveness: 0 }),
      absorbed: mf.actionFailed({ ...base, abilityAbsorbAbilityName: "저수" }),
      subFailed: mf.actionFailed({ ...base, move: data.getMove("대타출동"), substituteSetFailed: true }),
      attract: mf.actionFailed({ ...base, blockedReason: "attract" }),
      substituteHit: mf.actionFailed({ ...base, hitSubstitute: true }),
      disguise: mf.actionFailed({ ...base, hitNegatedByAbilityName: "탈" }),
    };
    const expected = { paralysis: true, flinch: true, confusion: true, psychicField: true, immune: true, absorbed: true, subFailed: true, attract: false, substituteHit: false, disguise: false };
    check(
      "1.9 엔진: 실패 판정 표 — 행동불능·풀죽음·혼란·필드 무효·면역·흡수·대타출동 실패는 실패 / 헤롱헤롱·대타 흡수·탈은 아님",
      Object.entries(expected).every(([k, v]) => table[k] === v),
      Object.entries(table).map(([k, v]) => `${k}=${v}`).join(" "),
    );
  }
  // ── ver.1.9 6-2 급소: 계산기 급소 가정(랭크·벽 무시·×1.5·스나이퍼·조가비갑옷류) + AI 처치 턴에 급소 확률 ──
  {
    const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
    const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
    const neutral = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
    const atk = (ability = null) => mon("한카리아스", ["스톤에지", "지진"], ability).slot;
    const foe = (ability = null) => mon("잠만보", ["누르기"], ability, null, pts({ hp: 32, def: 32 })).slot;
    const ratio = (o, a = atk(), f = foe()) => {
      const hit = (crit) => me.evaluateSlotMatchup(a, data.getMove("지진"), f, { ...o, critical: crit });
      const on = hit(true);
      const off = hit(false);
      return on.offensePower / on.bulkPower / (off.offensePower / off.bulkPower);
    };
    const plain = ratio({});
    const atkDown = ratio({ attackerStages: { ...neutral, atk: -2 } }); // 급소면 −2 무시 → ×1.5 × 2
    const defUp = ratio({ defenderStages: { ...neutral, def: 2 } }); // 급소면 +2 무시 → ×1.5 × 2
    const reflect = ratio({ screen: "reflect" }); // 급소면 벽 무시 → ×1.5 × 2
    const sniper = ratio({}, atk("스나이퍼"));
    const armor = me.evaluateSlotMatchup(atk(), data.getMove("지진"), foe("전투무장"), { critical: true });
    const armorRatio = ratio({}, atk(), foe("전투무장"));
    const solo = (me.computeSoloOffensePower(atk(), data.getMove("지진"), { critical: true }) ?? 0) / (me.computeSoloOffensePower(atk(), data.getMove("지진"), {}) ?? 1);
    check(
      "1.9 6-2: 계산기 급소 가정 — ×1.5, 공격 −2·방어 +2·리플렉터 무시(×3), 스나이퍼 ×2.25, 전투무장 무효, 상대 없는 결정력 ×1.5",
      [plain, sniper, atkDown, defUp, reflect, armorRatio, solo].every(Number.isFinite) &&
        Math.abs(plain - 1.5) < 0.01 && Math.abs(atkDown - 3) < 0.02 && Math.abs(defUp - 3) < 0.02 && Math.abs(reflect - 3) < 0.02 &&
        Math.abs(sniper - 2.25) < 0.01 && armor.criticalBlocked === true && Math.abs(armorRatio - 1) < 1e-9 && Math.abs(solo - 1.5) < 0.01,
      `×${plain.toFixed(2)} −2 ×${atkDown.toFixed(2)} +2 ×${defUp.toFixed(2)} 벽 ×${reflect.toFixed(2)} 스나이퍼 ×${sniper.toFixed(2)} 전투무장 ${armorRatio} 단독 ×${solo.toFixed(2)}`,
    );
    // AI: 급소율 높은 스톤에지는 급소를 켜면 처치 턴↓(지진보다 크게), 반드시 급소 기술은 1.5배로, 전투무장 상대는 무변화
    const est = (moveId, foeAbility = null, on = true) => {
      const b = battle([mon("한카리아스", ["스톤에지", "지진", "얼음숨결"])], [mon("잠만보", ["누르기"], foeAbility, null, pts({ hp: 32, def: 32 }))]);
      return md.withCritModel(on, () => md.estimateMoveHits({ state: b, attacker: b.a, defender: b.b, defenderSide: b.sideB, attackerMovesSecond: false }, data.getMove(moveId)));
    };
    const edgeGain = est("스톤에지", null, false).rawHits / est("스톤에지").rawHits;
    const quakeGain = est("지진", null, false).rawHits / est("지진").rawHits;
    const breathDmg = est("얼음숨결").damageFraction / est("얼음숨결", null, false).damageFraction;
    const armorSame = est("스톤에지", "전투무장").rawHits === est("스톤에지", "전투무장", false).rawHits;
    check(
      "1.9 6-2: AI 급소 — 급소율 높은 기술일수록 처치 턴↓, 반드시 급소 ×1.5, 전투무장 상대 무변화",
      edgeGain > quakeGain && quakeGain >= 1 && Math.abs(breathDmg - 1.5) < 0.03 && armorSame,
      `스톤에지 ×${edgeGain.toFixed(3)} 지진 ×${quakeGain.toFixed(3)} 얼음숨결 데미지 ×${breathDmg.toFixed(2)} 전투무장 ${armorSame}`,
    );
  }
  // ── ver.1.9 6-3 교체 봉쇄: 그림자꿰매기 가두기 가치(상대 갇힌 대면표) · 배수의진 자기 봉쇄 비용(내 교체 막힌 대면표) ──
  {
    const st = () =>
      battle(
        [mon("팬텀", ["그림자꿰매기", "섀도볼"]), mon("잠만보", ["누르기"])],
        [mon("마기라스", ["깨물어부수기"], null, null, pts({ hp: 32, def: 32 })), mon("후딘", ["사이코키네시스"])],
      );
    const on = opt(ev.evaluateOptions(st(), "a"), "그림자꿰매기");
    const off = ev.withTrapModel(false, () => opt(ev.evaluateOptions(st(), "a"), "그림자꿰매기"));
    const ghost = opt(ev.evaluateOptions(battle([mon("팬텀", ["그림자꿰매기"])], [mon("팬텀", ["섀도볼"], null, null, pts({ hp: 32, def: 32 }))]), "a"), "그림자꿰매기");
    const nr = () => battle([mon("루카리오", ["배수의진", "인파이트"]), mon("잠만보", ["누르기"])], [mon("잠만보", ["누르기"], null, null, pts({ hp: 32, def: 32 }))]);
    const nrOn = opt(ev.evaluateOptions(nr(), "a"), "배수의진");
    const nrOff = ev.withTrapModel(false, () => opt(ev.evaluateOptions(nr(), "a"), "배수의진"));
    const trappedOn = on.party?.model.oppTrapped;
    const trappedOff = off.party?.model.oppTrapped;
    const selfOn = nrOn.support?.effect?.party?.model.myTrapped;
    const selfOff = nrOff.support?.effect?.party?.model.myTrapped;
    check(
      "1.9 6-3: 그림자꿰매기 이어지는 대면 = 상대 갇힘(고스트 상대·토글 끔이면 없음) · 배수의진 적용 대면표 = 내 교체 봉쇄",
      trappedOn === true && trappedOff === false && ghost.trapPartyModel === undefined && selfOn === true && selfOff === false,
      `꿰매기 ${trappedOn}/${trappedOff} 고스트 ${!!ghost.trapPartyModel} 배수의진 ${selfOn}/${selfOff}`,
    );
  }
  // ── ver.1.9 6-4 탈피·수확: 대면 턴 수에 기대값(탈피 = 상태이상 남는 비율, 수확 = 절반 이하 구간 열매 반복 회복) ──
  {
    const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
    const tank = (ability, item = null) => mon("잠만보", ["막치기"], ability, item, pts({ hp: 32, def: 32 }));
    const both = (build) => {
      const on = build();
      const off = tr.withChanceEffectsModel(false, build);
      return [on, off];
    };
    // 독 걸린 탈피 상대: 지속 피해가 줄어 내 처치 턴↑
    const [shedOn, shedOff] = both(() => {
      const b = battle([mon("한카리아스", ["막치기"])], [tank("탈피")]);
      b.b.status = { condition: "poison", turnsElapsed: 0 };
      return opt(ev.evaluateOptions(b, "a"), "막치기").hitsToKill.expected;
    });
    // 마비 걸린 탈피 상대: 행동불능이 줄어 내가 버티는 턴↓
    const [parOn, parOff] = both(() => {
      const b = battle([mon("한카리아스", ["막치기"], null, null, pts({ hp: 32, def: 32 }))], [mon("잠만보", ["막치기"], "탈피")]);
      b.b.status = { condition: "paralysis", turnsElapsed: 0 };
      return opt(ev.evaluateOptions(b, "a"), "막치기").hitsToBeKilled.expected;
    });
    // 자뭉열매를 든 수확 상대: 절반 이하 구간에 반복 회복 → 내 처치 턴↑, 수확 없는 같은 상대는 무변화
    const [harvestOn, harvestOff] = both(() => opt(ev.evaluateOptions(battle([mon("한카리아스", ["막치기"])], [tank("수확", "자뭉열매")]), "a"), "막치기").hitsToKill.expected);
    const [plainOn, plainOff] = both(() => opt(ev.evaluateOptions(battle([mon("한카리아스", ["막치기"])], [tank(null, "자뭉열매")]), "a"), "막치기").hitsToKill.expected);
    check(
      "1.9 6-4: 탈피(독 상대 처치 턴↑·마비 상대에게 버티는 턴↓)·수확(자뭉열매 처치 턴↑, 수확 없으면 무변화)",
      shedOn > shedOff && parOn < parOff && harvestOn > harvestOff && plainOn === plainOff,
      `탈피 c ${shedOff.toFixed(2)}→${shedOn.toFixed(2)} 마비 d ${parOff.toFixed(2)}→${parOn.toFixed(2)} 수확 c ${harvestOff.toFixed(2)}→${harvestOn.toFixed(2)}`,
    );
  }
  // ── ver.1.9 한계점 A3·A4: 맹독 카운터 누적 · 확정 처치 기술이 여럿이면 점수 최고 ──
  {
    const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
    const st = battle([mon("한카리아스", ["막치기"])], [mon("잠만보", ["막치기"], null, null, pts({ hp: 32, def: 32 }))]);
    const toxicTurns = (counter) => {
      st.b.status = { condition: "badly-poisoned", turnsElapsed: counter };
      return tr.turnsToKo(0.05, st.a, st.b);
    };
    const fixedTurns = 1 / (0.05 + Math.floor(st.b.maxHp / 16) / st.b.maxHp);
    const early = toxicTurns(1);
    const capped = toxicTurns(15);
    const cappedFixed = 1 / (0.05 + Math.floor((st.b.maxHp * 15) / 16) / st.b.maxHp);
    check(
      "1.9 A3: 맹독 대상은 카운터가 늘어나는 만큼 처치 턴↓(카운터 1), 상한 15면 고정 계산과 같음",
      early < fixedTurns && early > 1 && Math.abs(capped - Math.max(1, cappedFixed)) < 1e-9,
      `카운터 1: ${fixedTurns.toFixed(2)} → ${early.toFixed(2)}, 카운터 15: ${capped.toFixed(2)}`,
    );
    // 확정 처치 옵션 둘 — 점수가 높은 쪽(목록 뒤)을 고른다
    const base = opt(ev.evaluateOptions(battle([mon("한카리아스", ["지진"])], [mon("피카츄", ["10만볼트"])]), "a"), "지진");
    const low = { ...base, party: undefined, opponentHpFraction: 0.5 };
    const high = { ...base, party: undefined, opponentHpFraction: 1 };
    const both = [low, high].every((o) => dec.isHardOverride(o));
    const chosen = dec.decide([low, high], 0.5).chosen;
    check("1.9 A4: 하드 오버라이드가 여럿이면 점수 최고", both && chosen === high, `override ${both} 선택 ${chosen === high ? "뒤(높은 점수)" : "앞"}`);
  }
}
