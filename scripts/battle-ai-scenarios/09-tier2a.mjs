// 변화기 판단 Tier 2-A(ver.1.8)
export default async function ({ server, data, ev, ai, dec, pts, mon, battle, opt, check }) {
  // ── 변화기 판단 Tier 2-A(ver.1.8) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.3);
    const P = dec.DEFAULT_DECISION_PARAMS;
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    // 엔진: 치료방울은 대기 포켓몬까지 · 코트체인지는 순풍도 맞바꿈
    {
      const st = battle([mon("잠만보", ["치료방울"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["칼춤"])]);
      st.a.status = { condition: "burn", turnsElapsed: 0 };
      st.sideA.party[1].status = { condition: "paralysis", turnsElapsed: 0 };
      const bell = run(st, "치료방울", "칼춤").nextState;
      const court = battle([mon("블래키", ["코트체인지"])], [mon("잠만보", ["칼춤"])]);
      court.sideB.tailwindTurnsRemaining = 3;
      court.sideB.hazards = { ...court.sideB.hazards, stealthRock: true };
      const c1 = run(court, "코트체인지", "칼춤").nextState;
      check(
        "T2-A: 치료방울 대기 포켓몬까지 치료 · 코트체인지 순풍·설치물 맞바꿈",
        !bell.a.status.condition && !bell.sideA.party[1].status.condition && c1.sideA.tailwindTurnsRemaining > 0 && c1.sideB.hazards.stealthRock === false && c1.sideA.hazards.stealthRock === true,
        `치료=${bell.a.status.condition}/${bell.sideA.party[1].status.condition} 순풍 A=${c1.sideA.tailwindTurnsRemaining}`,
      );
    }
    // AI: 파워스왑(상대 +2 공격을 가져옴)·뒤집어엎기(상대 +2 → −2)·변신 평가 + 토글
    {
      const swapSt = battle([mon("잠만보", ["파워스왑", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("블래키", ["깨물어부수기"])]);
      swapSt.b.stages = { ...swapSt.b.stages, atk: 2 };
      const swap = optOf(swapSt, "파워스왑");
      const topsySt = battle([mon("잠만보", ["뒤집어엎기", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("블래키", ["깨물어부수기"])]);
      topsySt.b.stages = { ...topsySt.b.stages, atk: 2 };
      const topsy = optOf(topsySt, "뒤집어엎기").support?.effect;
      const tf = optOf(battle([mon("메타그로스", ["변신", "코멧펀치"])], [mon("한카리아스", ["지진"])]), "변신");
      const se = swap.support?.effect;
      check(
        "T2-A AI: 파워스왑·뒤집어엎기·변신 재평가 + tier2Aware 토글",
        se?.kind === "stageSwap" && se.hit.killTurns < se.base.killTurns && se.hit.survivalTurns > se.base.survivalTurns &&
          topsy?.kind === "invertStages" && topsy.hit.survivalTurns > topsy.base.survivalTurns &&
          tf.support?.effect?.kind === "transform" && Number.isFinite(dec.scoreOption(tf, 0.5)) &&
          dec.scoreOption(swap, 0.5, { ...P, tier2Aware: false }) === -Infinity,
        `파워스왑 c ${se?.base.killTurns}→${se?.hit.killTurns} d ${se?.base.survivalTurns}→${se?.hit.survivalTurns} 뒤집어 d ${topsy?.base.survivalTurns}→${topsy?.hit.survivalTurns}`,
      );
    }
    // 엔진: 다과회는 양쪽 모두 열매를 바로 먹는다(HP 조건 무시) · 아무도 없으면 실패
    {
      const st = battle([mon("잠만보", ["다과회"], null, "자뭉열매")], [mon("블래키", ["칼춤"], null, "리샘열매")]);
      st.a.currentHp -= 30;
      st.b.status = { condition: "sleep", turnsElapsed: 0, sleepTurns: 3 };
      const out = run(st, "다과회", "칼춤");
      const tea = out.result.actions.find((x) => x.actor === "a");
      const none = run(battle([mon("잠만보", ["다과회"])], [mon("블래키", ["칼춤"])]), "다과회", "칼춤").result.actions.find((x) => x.actor === "a");
      check(
        "T2-B: 다과회 양쪽 열매 즉시 발동 · 열매 없으면 실패",
        tea?.teaTime?.self?.healed > 0 && tea?.teaTime?.opponent?.curedStatus === "sleep" && !out.nextState.a.currentItemId && !out.nextState.b.currentItemId && none?.teaTimeFailed === true,
        `회복=${tea?.teaTime?.self?.healed} 치료=${tea?.teaTime?.opponent?.curedStatus} 실패=${none?.teaTimeFailed}`,
      );
    }
    // AI: 회생의기도(쓰러진 동료 부활)·멸망의노래(긴 대면에서 양쪽 기절)·다과회·문어굳히기 평가 + 토글
    {
      const revSt = battle([mon("잠만보", ["회생의기도", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]);
      revSt.sideA.party[1].currentHp = 0;
      const rev = optOf(revSt, "회생의기도");
      const noRev = optOf(battle([mon("잠만보", ["회생의기도", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]), "회생의기도");
      // 서로 못 쓰러뜨리는 긴 대면(둘 다 변화기뿐)이면 멸망의노래가 평가된다 / 짧은 대면이면 고르지 않는다
      const perish = optOf(battle([mon("팬텀", ["멸망의노래", "섀도볼"]), mon("잠만보", ["누르기"])], [mon("블래키", ["칼춤"])]), "멸망의노래");
      const shortPerish = optOf(battle([mon("팬텀", ["멸망의노래", "섀도볼"]), mon("잠만보", ["누르기"])], [mon("한카리아스", ["지진"])]), "멸망의노래");
      const teaSt = battle([mon("잠만보", ["다과회", "누르기"], null, "자뭉열매")], [mon("블래키", ["깨물어부수기"])]);
      teaSt.a.currentHp = Math.floor(teaSt.a.maxHp / 2);
      const tea = optOf(teaSt, "다과회");
      const octo = optOf(battle([mon("메타그로스", ["문어굳히기", "코멧펀치"])], [mon("잠만보", ["누르기"])]), "문어굳히기");
      const re = rev.support?.effect;
      check(
        "T2-B AI: 회생의기도·멸망의노래·다과회·문어굳히기 평가 + tier2Aware 토글",
        re?.kind === "revive" && re.partyShift?.extraCount === 1 && Number.isFinite(dec.scoreOption(rev, 0.5)) && !noRev.support?.effect &&
          perish.support?.effect?.kind === "perishSong" && Number.isFinite(dec.scoreOption(perish, 0.5)) && !shortPerish.support?.effect &&
          tea.support?.effect?.kind === "teaTime" && octo.support?.effect?.kind === "octolock" &&
          octo.support.effect.hit.killTurns <= octo.support.effect.base.killTurns &&
          dec.scoreOption(rev, 0.5, { ...P, tier2Aware: false }) === -Infinity,
        `회생=${dec.scoreOption(rev, 0.5).toFixed(3)} 멸망=${dec.scoreOption(perish, 0.5).toFixed(3)} 문어 c ${octo.support?.effect?.base.killTurns}→${octo.support?.effect?.hit.killTurns}`,
      );
    }
    // 엔진(T2-C에서 발견): 눈이면 얼음 타입 방어 1.5배 · 모래바람이면 바위 타입 특방 1.5배(데미지 감소)
    {
      const dmg = (weather, a, b, move) => {
        const st = battle([mon(a, [move])], [mon(b, ["칼춤"])]);
        if (weather) {
          st.weather = weather;
          st.weatherTurnsRemaining = 5;
        }
        const out = run(st, move, "칼춤");
        // 마기라스(바위)는 모래바람 틱 면제라 차이는 기술 데미지뿐
        return st.b.currentHp - out.nextState.b.currentHp;
      };
      const clear = dmg(undefined, "한카리아스", "크레베이스", "지진");
      const snow = dmg("눈", "한카리아스", "크레베이스", "지진");
      const snowSpecial = dmg("눈", "리자몽", "크레베이스", "화염방사");
      const clearSpecial = dmg(undefined, "리자몽", "크레베이스", "화염방사");
      const sandClear = dmg(undefined, "밀로틱", "마기라스", "하이드로펌프");
      const sandSpecial = dmg("모래바람", "밀로틱", "마기라스", "하이드로펌프");
      check(
        "T2-C 엔진: 눈 얼음 방어 1.5배 · 모래바람 바위 특방 1.5배",
        snow < clear && snowSpecial === clearSpecial && sandSpecial < sandClear,
        `눈 지진 ${clear}→${snow} 눈 특수 ${clearSpecial}→${snowSpecial} 모래 특수 ${sandClear}→${sandSpecial}`,
      );
    }
    // AI(T2-C): 꼬리자르기 — 대타를 넘겨받은 후보로 교체 평가(HP 절반 이하면 실패) · 썰렁개그 — 눈 state로 교체 평가 + 토글
    {
      const tailSt = battle([mon("잠만보", ["꼬리자르기", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]);
      const tail = optOf(tailSt, "꼬리자르기");
      const lowSt = battle([mon("잠만보", ["꼬리자르기", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]);
      lowSt.a.currentHp = Math.floor(lowSt.a.maxHp / 2);
      const low = optOf(lowSt, "꼬리자르기");
      const plain = optOf(battle([mon("잠만보", ["누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]), "누르기");
      const plainSwitch = ev.evaluateOptions(tailSt, "a").find((o) => o.optionType === "switch");
      const tc = tail.pivot?.candidates[0];
      const chillSt = battle([mon("잠만보", ["썰렁개그", "누르기"]), mon("크레베이스", ["눈사태"])], [mon("한카리아스", ["지진"])]);
      const chill = optOf(chillSt, "썰렁개그");
      const chillSwitch = ev.evaluateOptions(chillSt, "a").find((o) => o.optionType === "switch");
      check(
        "T2-C AI: 꼬리자르기(대타 인계 후보)·썰렁개그(눈 후보) 교체 평가 + tier2Aware 토글",
        tail.pivot?.tier2 && Math.abs(tail.pivot.selfCost - 0.5) < 0.01 && tc.hitsToBeKilled.expected > plainSwitch.hitsToBeKilled.expected && !low.pivot &&
          Number.isFinite(dec.scoreOption(tail, 0.5)) && dec.scoreOption(tail, 0.5, { ...P, tier2Aware: false }) === -Infinity &&
          chill.pivot?.tier2 && chill.pivot.candidates[0].hitsToBeKilled.expected > chillSwitch.hitsToBeKilled.expected && Number.isFinite(dec.scoreOption(chill, 0.5)) &&
          !!plain,
        `꼬리 후보 d ${plainSwitch?.hitsToBeKilled.expected}→${tc?.hitsToBeKilled.expected} 썰렁 후보 d ${chillSwitch?.hitsToBeKilled.expected}→${chill.pivot?.candidates[0].hitsToBeKilled.expected}`,
      );
    }
    // 로드맵 3: 상대 자발적 교체 — 지는 대면의 상대는 내 공격을 받지 않는 대기 포켓몬으로 교체한다고 본다
    {
      const OFF = { ...P, oppSwitchAware: false };
      const st = battle([mon("한카리아스", ["지진", "검은눈빛"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["화염방사"])]);
      const opts = ev.evaluateOptions(st, "a");
      const quake = opt(opts, "지진");
      const trap = opt(opts, "검은눈빛");
      const on = dec.scoreOption(quake, 0.5);
      const off = dec.scoreOption(quake, 0.5, OFF);
      check(
        "로드맵 3: 상대 교체 모델링 — 이기는 대면 공격 값이 상대 교체(지진 무효 리자몽)만큼 낮아짐 · 검은눈빛은 켤 때만",
        on < off - 0.05 && trap.support?.effect?.kind === "trap" && trap.support.effect.party?.model.oppTrapped === true &&
          Number.isFinite(dec.scoreOption(trap, 0.5)) && dec.scoreOption(trap, 0.5, OFF) === -Infinity,
        `지진 켬 ${on.toFixed(3)} 끔 ${off.toFixed(3)} 검은눈빛 ${dec.scoreOption(trap, 0.5).toFixed(3)}`,
      );
    }
    // 로드맵 3: 멸망의노래 — 상대가 갇혀 있으면(교체 불가) 카운트로 쓰러지고, 아니면 교체로 피한다
    {
      const mk = () => battle([mon("잠만보", ["멸망의노래", "누르기"], null, null, pts({ hp: 32, def: 32 })), mon("메타그로스", ["코멧펀치"])], [mon("잠만보", ["깨물어부수기"]), mon("메타그로스", ["코멧펀치"])]);
      const free = opt(ev.evaluateOptions(mk(), "a"), "멸망의노래");
      const lockedSt = mk();
      lockedSt.b.volatile = { active: { ...lockedSt.b.volatile.active, meanLook: { turnsRemaining: undefined } } };
      const locked = opt(ev.evaluateOptions(lockedSt, "a"), "멸망의노래");
      const vFree = dec.scoreOption(free, 0.5);
      const vLocked = dec.scoreOption(locked, 0.5);
      check(
        "로드맵 3: 멸망의노래 — 갇힌 상대는 카운트로 쓰러짐(값 큼) · 교체 가능한 상대는 피함",
        Number.isFinite(vFree) && Number.isFinite(vLocked) && vLocked > vFree + 0.2,
        `교체 가능 ${vFree.toFixed(3)} 갇힘 ${vLocked.toFixed(3)}`,
      );
    }
    // 턴 종료 효과(ver.1.8): 대면 턴 수에 먹다남은음식·자뭉열매·그래스필드·모래바람(남은 턴만큼)을 센다 + 토글
    {
      const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
      const surv = (item, setup) => {
        const st = battle([mon("잠만보", ["누르기"], null, item)], [mon("메타그로스", ["코멧펀치"])]);
        setup?.(st);
        return opt(ev.evaluateOptions(st, "a"), "누르기").hitsToBeKilled.expected;
      };
      const plain = surv(null);
      const lefties = surv("먹다남은음식");
      const sitrus = surv("자뭉열매");
      const grassy = surv(null, (st) => {
        st.field = "그래스필드";
        st.fieldTurnsRemaining = 5;
      });
      const leftiesOff = tr.withEndOfTurnModel(false, () => surv("먹다남은음식"));
      const kill = (turns) => {
        const st = battle([mon("한카리아스", ["지진"])], [mon("잠만보", ["누르기"])]);
        if (turns) {
          st.weather = "모래바람";
          st.weatherTurnsRemaining = turns;
        }
        return opt(ev.evaluateOptions(st, "a"), "지진").hitsToKill.expected;
      };
      const k0 = kill(0);
      const k1 = kill(1);
      const k5 = kill(5);
      check(
        "턴 종료 효과: 먹다남은음식·자뭉열매·그래스필드로 버티는 턴 증가 · 모래바람은 남은 턴만큼 처치 턴 감소 · 토글",
        lefties > plain && sitrus > plain && grassy > plain && leftiesOff === plain && k5 < k1 && k1 < k0,
        `버팀 ${plain.toFixed(2)} 음식 ${lefties.toFixed(2)} 자뭉 ${sitrus.toFixed(2)} 그래스 ${grassy.toFixed(2)} · 처치 ${k0.toFixed(2)}/${k1.toFixed(2)}/${k5.toFixed(2)}`,
      );
    }
    // 3선출 AI(ver.1.8 로드맵 7): 공격기 없는 빌드는 고르지 않고, 서로 다른 3마리를 선봉 먼저 돌려준다
    {
      const full = battle(
        [mon("잠만보", ["칼춤"]), mon("한카리아스", ["지진", "드래곤클로"]), mon("블래키", ["칼춤"]), mon("메타그로스", ["코멧펀치", "지진"]), mon("팬텀", ["칼춤"]), mon("리자몽", ["화염방사", "에어슬래시"])],
        [mon("잠만보", ["누르기"]), mon("블래키", ["깨물어부수기"]), mon("팬텀", ["섀도볼"]), mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["화염방사"]), mon("한카리아스", ["지진"])],
      );
      const sel = ai.chooseAiSelection(full, "a", { random: () => 0.5 });
      check(
        "3선출 AI: 공격기 없는 빌드 제외 · 서로 다른 3마리",
        sel.length === 3 && new Set(sel).size === 3 && sel.every((i) => [1, 3, 5].includes(i)),
        `선출 ${sel.join(",")}`,
      );
      // 고정 선출(5.2 C5): 고정한 마리는 AI가 안 고를 마리(공격기 없는 빌드)여도 항상 들어가고, 3마리를 고정하면 그 3마리, 빈 배열은 AI 선출과 같다
      const pickWith = (fixed) => ai.chooseAiSelection(full, "a", { random: () => 0.5, fixed });
      const f1 = pickWith([0]);
      const f2 = pickWith([0, 2]);
      const f3 = pickWith([1, 3, 5]);
      check(
        "고정 선출: 고정 마리는 항상 포함 · 3마리 고정이면 그 3마리 · 빈 배열은 AI 선출과 같음",
        f1.length === 3 && f1.includes(0) && f2.length === 3 && f2.includes(0) && f2.includes(2) && f3.length === 3 && [1, 3, 5].every((i) => f3.includes(i)) && pickWith([]).join() === sel.join(),
        `1마리 ${f1.join(",")} · 2마리 ${f2.join(",")} · 3마리 ${f3.join(",")}`,
      );
    }
    // 한계점 정리(ver.1.8): 필드 기술 접지 조건(엔진) · 페어리록 평가 · 끈적끈적네트 대면표 반영
    {
      const pe = await server.ssrLoadModule("/src/lib/battle/ai/partyEval.ts");
      const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
      const fe = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
      const glideSt = battle([mon("리자몽", ["그래스슬라이더"]), mon("이상해꽃", ["그래스슬라이더"])], [mon("잠만보", ["누르기"])]);
      glideSt.field = "그래스필드";
      glideSt.fieldTurnsRemaining = 5;
      const flyingPrio = toi.computeTurnOrderPriority(glideSt, glideSt.a, data.getMove("그래스슬라이더"));
      const groundPrio = toi.computeTurnOrderPriority(glideSt, glideSt.sideA.party[1], data.getMove("그래스슬라이더"));
      const volt = data.getMove("라이징볼트");
      const voltFlying = fe.getFieldPowerMultiplier(volt, "일렉트릭필드", true, false);
      const voltGround = fe.getFieldPowerMultiplier(volt, "일렉트릭필드", false, true);
      const lockSt = battle([mon("한카리아스", ["지진", "페어리록"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["화염방사"])]);
      const lock = opt(ev.evaluateOptions(lockSt, "a"), "페어리록");
      const webSt = battle([mon("잠만보", ["누르기"]), mon("한카리아스", ["지진"])], [mon("메타그로스", ["코멧펀치"])]);
      webSt.sideA.hazards = { ...webSt.sideA.hazards, stickyWeb: true };
      const benchSpe = pe.createPartyModel(webSt, "a").pair(1, false, 0).me.stages.spe;
      check(
        "한계점 정리: 그래스슬라이더·라이징볼트 접지 조건 · 페어리록 평가(교체 모델링 켤 때만) · 끈적끈적네트 등장 스피드 −1",
        flyingPrio === 0 && groundPrio === 1 && voltFlying === 1 && voltGround === 2 &&
          lock.support?.effect?.kind === "fairyLock" && lock.support.effect.party?.model.switchLockedNextTurn === true &&
          Number.isFinite(dec.scoreOption(lock, 0.5)) && dec.scoreOption(lock, 0.5, { ...P, oppSwitchAware: false }) === -Infinity &&
          benchSpe === -1,
        `우선도 비행 ${flyingPrio}/땅 ${groundPrio} 라이징볼트 ${voltFlying}/${voltGround} 페어리록 ${dec.scoreOption(lock, 0.5).toFixed(3)} 네트 ${benchSpe}`,
      );
    }
    // 한계점 정리 ②: 매 턴 쌓이는 랭크 — 가속은 긴 대면일수록 선공 확률↑, 문어굳히기 건 상대는 방어·특방이 대면 중간만큼 더 떨어짐
    {
      const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
      const mk = () => battle([mon("잠만보", ["막치기"], "가속", null, pts({ hp: 32, def: 32 }))], [mon("잠만보", ["막치기"], null, null, pts({ hp: 32, def: 32, spe: 32 }))]);
      const pOn = opt(ev.evaluateOptions(mk(), "a"), "막치기").firstProbability;
      const pOff = tr.withEndOfTurnModel(false, () => opt(ev.evaluateOptions(mk(), "a"), "막치기").firstProbability);
      const octoSt = battle([mon("메타그로스", ["코멧펀치"])], [mon("잠만보", ["누르기"], null, null, pts({ hp: 32, def: 32 }))]);
      octoSt.b.volatile = { active: { ...octoSt.b.volatile.active, octolock: {} } };
      const cOn = opt(ev.evaluateOptions(octoSt, "a"), "코멧펀치").hitsToKill.expected;
      const cOff = tr.withEndOfTurnModel(false, () => opt(ev.evaluateOptions(octoSt, "a"), "코멧펀치").hitsToKill.expected);
      check(
        "한계점 정리 ②: 가속 누적 선공 확률↑ · 문어굳히기 누적 처치 턴↓ · 턴 종료 토글",
        pOn > pOff && cOn < cOff,
        `가속 p ${pOff.toFixed(2)}→${pOn.toFixed(2)} 문어 c ${cOff.toFixed(2)}→${cOn.toFixed(2)}`,
      );
    }
    // 한계점 정리 ③: 상대 변화기 위협 환산 — 칼춤·HP회복을 가진 상대에게 도발의 가치(공격 대비)가 켤 때 더 크다
    {
      const opm = await server.ssrLoadModule("/src/lib/battle/ai/opponentMoveModel.ts");
      const mk = () => battle([mon("한카리아스", ["도발", "드래곤클로"])], [mon("잠만보", ["칼춤", "HP회복", "누르기"], null, null, pts({ hp: 32, def: 32 }))]);
      const gap = (model) =>
        opm.withThreatModel(model, () => {
          const os = ev.evaluateOptions(mk(), "a");
          return dec.scoreOption(opt(os, "도발"), 0.5) - dec.scoreOption(opt(os, "드래곤클로"), 0.5);
        });
      const on = gap(opm.DEFAULT_THREAT_MODEL);
      const off = gap({ ...opm.DEFAULT_THREAT_MODEL, statusThreat: false });
      check("한계점 정리 ③: 위협 환산 — 칼춤·HP회복 상대에게 도발 가치(공격 대비)↑", on > off, `도발−공격 끔 ${off.toFixed(3)} → 켬 ${on.toFixed(3)}`);
    }
    // 한계점 정리 ④: 내 자발적 교체 — 이어지는 대면에서 불리한 대면이 오면 교체로 피한다(켤 때 판세 ≥ 끌 때)
    {
      const pe = await server.ssrLoadModule("/src/lib/battle/ai/partyEval.ts");
      const st = battle(
        [mon("한카리아스", ["지진"]), mon("잠만보", ["누르기"]), mon("밀로틱", ["하이드로펌프"])],
        [mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["에어슬래시"])],
      );
      const model = pe.createPartyModel(st, "a");
      const base = { lambda: 0.5, noise: 0.5 };
      const off = pe.partyMatchValue(model, [1, 1, 1], [1, 1], 0, 0, base);
      const on = pe.partyMatchValue(model, [1, 1, 1], [1, 1], 0, 0, { ...base, mySwitch: { margin: 0.1, limit: 1 } });
      check("한계점 정리 ④: 내 자발적 교체 — 켤 때 판세 ≥ 끌 때", on >= off - 1e-9, `끔 ${off.toFixed(3)} 켬 ${on.toFixed(3)}`);
    }
  }
}
