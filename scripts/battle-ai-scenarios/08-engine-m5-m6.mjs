// 트랙 M5·M6·L(ver.1.8)
export default async function ({ server, data, ev, dec, pts, mon, battle, opt, check }) {
  // ── 트랙 M5(ver.1.8): 데미지 로직이 없던 데미지 기술 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.3) => rt.runTurn(st, act(a), act(b), () => r);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 일렉트릭볼(빠를수록 강함)·하드프레스(상대 HP 많을수록 강함)·분노의앞니(상대 HP 절반)
    {
      const fast = actionOf(run(battle([mon("로토무", ["일렉트릭볼"])], [mon("잠만보", ["칼춤"])]), "일렉트릭볼", "칼춤"), "a").damage;
      const slowSt = battle([mon("로토무", ["일렉트릭볼"])], [mon("잠만보", ["칼춤"])]);
      slowSt.a.stages = { ...slowSt.a.stages, spe: -6 };
      const slow = actionOf(run(slowSt, "일렉트릭볼", "칼춤"), "a").damage;
      const full = actionOf(run(battle([mon("메타그로스", ["하드프레스"])], [mon("잠만보", ["칼춤"])]), "하드프레스", "칼춤"), "a").damage;
      const halfSt = battle([mon("메타그로스", ["하드프레스"])], [mon("잠만보", ["칼춤"])]);
      halfSt.b.currentHp = Math.floor(halfSt.b.maxHp / 4);
      const quarter = actionOf(run(halfSt, "하드프레스", "칼춤"), "a").damage;
      const fangSt = battle([mon("메타그로스", ["분노의앞니"])], [mon("잠만보", ["칼춤"])]);
      const fang = run(fangSt, "분노의앞니", "칼춤").nextState.b.currentHp;
      check(
        "M5: 일렉트릭볼·하드프레스 가변 위력 · 분노의앞니 HP 절반",
        fast > slow && slow > 0 && full > quarter && quarter > 0 && fang === fangSt.b.maxHp - Math.floor(fangSt.b.maxHp / 2),
        `일렉트릭볼 ${fast}/${slow} 하드프레스 ${full}/${quarter} 앞니 남은=${fang}`,
      );
    }
    // 일격기: 명중하면 기절(명중 30%, 랭크 무시) · 옹골참 무효 · 절대영도는 얼음 무효·비얼음 사용자 20%
    {
      const hit = run(battle([mon("한카리아스", ["땅가르기"])], [mon("잠만보", ["칼춤"])]), "땅가르기", "칼춤", 0.29);
      const missSt = battle([mon("한카리아스", ["땅가르기"])], [mon("잠만보", ["칼춤"])]);
      missSt.a.accuracyStages = { ...missSt.a.accuracyStages, accuracy: 6 };
      const miss = actionOf(run(missSt, "땅가르기", "칼춤", 0.31), "a");
      const sturdy = actionOf(run(battle([mon("한카리아스", ["땅가르기"])], [mon("잠만보", ["칼춤"], "옹골참")]), "땅가르기", "칼춤", 0.1), "a");
      const iceImmune = actionOf(run(battle([mon("로토무", ["절대영도"])], [mon("알로라나인테일", ["칼춤"])]), "절대영도", "칼춤", 0.1), "a");
      const nonIce = actionOf(run(battle([mon("로토무", ["절대영도"])], [mon("잠만보", ["칼춤"])]), "절대영도", "칼춤", 0.25), "a");
      check(
        "M5: 일격기 — 30%·랭크 무시·옹골참 무효 · 절대영도 20%(비얼음 사용자)",
        hit.nextState.b.currentHp === 0 && !miss.hit && sturdy?.ohkoBlockedByAbilityName === "옹골참" && nonIce.hit === false && iceImmune?.ohkoImmune === true && iceImmune.damage === 0,
        `기절=${hit.nextState.b.currentHp === 0} 명중+6 빗나감=${!miss.hit} 옹골참=${sturdy?.ohkoBlockedByAbilityName} 비얼음 0.25=${nonIce.hit} 얼음상대=${iceImmune.damage}`,
      );
    }
    // 목숨걸기: 내 HP만큼 주고 기절 · 면역(고스트)이면 기절 안 함 · AI는 희생 평가(파티 모드)
    {
      const st = battle([mon("로토무", ["목숨걸기"])], [mon("잠만보", ["칼춤"])]);
      const myHp = st.a.currentHp;
      const out = run(st, "목숨걸기", "칼춤").nextState;
      const ghost = run(battle([mon("로토무", ["목숨걸기"])], [mon("팬텀", ["칼춤"])]), "목숨걸기", "칼춤").nextState;
      const o = opt(ev.evaluateOptions(battle([mon("로토무", ["목숨걸기", "10만볼트"]), mon("메타그로스", ["코멧펀치"])], [mon("잠만보", ["누르기"])]), "a"), "목숨걸기");
      check(
        "M5: 목숨걸기 — 내 HP만큼·기절 · 고스트 면역이면 기절 안 함 · AI 희생 평가",
        out.a.currentHp === 0 && out.b.maxHp - out.b.currentHp === myHp && ghost.a.currentHp > 0 &&
          o.support?.effect?.kind === "finalGambit" && !!o.support.effect.sacrifice && Number.isFinite(dec.scoreOption(o, 0.5)),
        `데미지=${out.b.maxHp - out.b.currentHp}/${myHp} 고스트 뒤 내 HP=${ghost.a.currentHp} 점수=${dec.scoreOption(o, 0.5).toFixed(3)}`,
      );
    }
  }
  // ── 트랙 M5: 내던지기(도구 위력·소모·도구 효과) + 자폭류 AI 희생 평가 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.3);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    {
      const ball = battle([mon("메타그로스", ["내던지기"], null, "검은철구")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]);
      const b1 = run(ball, "내던지기", "칼춤");
      const orb = run(battle([mon("메타그로스", ["내던지기"], null, "전기구슬")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]), "내던지기", "칼춤");
      const berrySt = battle([mon("메타그로스", ["내던지기"], null, "오랭열매")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]);
      berrySt.b.currentHp = 100;
      const berry = actionOf(run(berrySt, "내던지기", "칼춤"), "a");
      const none = actionOf(run(battle([mon("메타그로스", ["내던지기"])], [mon("잠만보", ["칼춤"])]), "내던지기", "칼춤"), "a");
      check(
        "M5: 내던지기 — 도구 위력·소모(리사이클 가능)·전기구슬 마비·열매는 상대가 먹음·도구 없으면 실패",
        actionOf(b1, "a").damage > 0 && b1.nextState.a.currentItemId === null && b1.nextState.a.lastConsumedItemId === "검은철구" &&
          orb.nextState.b.status.condition === "paralysis" && (berry?.flingEffect?.berry?.healed ?? 0) > 0 && none?.blockedReason === "usageCondition",
        `철구 데미지=${actionOf(b1, "a").damage} 마비=${orb.nextState.b.status.condition} 열매 회복=${berry?.flingEffect?.berry?.healed} 무도구=${none?.blockedReason}`,
      );
    }
    {
      const o = opt(ev.evaluateOptions(battle([mon("메타그로스", ["대폭발", "코멧펀치"]), mon("잠만보", ["누르기"])], [mon("블래키", ["깨물어부수기"])]), "a"), "대폭발");
      const off = dec.scoreOption(o, 0.5, { ...dec.DEFAULT_DECISION_PARAMS, trackMAware: false });
      check(
        "M5 AI: 자폭류(대폭발) — 자신 기절을 반영한 희생 평가",
        o.support?.effect?.kind === "selfDestruct" && !!o.support.effect.sacrifice && Number.isFinite(dec.scoreOption(o, 0.5)) && off === -Infinity,
        `점수=${dec.scoreOption(o, 0.5).toFixed(3)} 성공=${o.support?.effect?.sacrifice?.success}`,
      );
    }
  }
  // ── 트랙 M6(ver.1.8): 교체 봉쇄·치유소원·부식가스·록온·자기장조작·집단구타 + 자동 검사 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.3) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => r);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 검은눈빛: 교체 불가(고스트 면제) · 건 쪽이 물러나면 풀림 · 아름다운허물은 무시 · 페어리록: 다음 턴 교체 불가
    {
      const st = battle([mon("블래키", ["검은눈빛", "칼춤"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["칼춤"]), mon("한카리아스", ["지진"])]);
      const s1 = run(st, "검은눈빛", "칼춤").nextState;
      const trapped = sw.isTrappedFromSwitching(s1.b, s1);
      const tryOut = run(s1, "칼춤", { kind: "switch", toIndex: 1 }).nextState;
      const freed = run(s1, { kind: "switch", toIndex: 1 }, "칼춤").nextState;
      const shed = battle([mon("블래키", ["검은눈빛"])], [mon("메타그로스", ["칼춤"], null, "아름다운허물")]);
      const s2 = run(shed, "검은눈빛", "칼춤").nextState;
      const ghost = actionOf(run(battle([mon("블래키", ["검은눈빛"])], [mon("팬텀", ["칼춤"])]), "검은눈빛", "칼춤"), "a");
      const fl = run(battle([mon("블래키", ["페어리록"])], [mon("메타그로스", ["칼춤"])]), "페어리록", "칼춤").nextState;
      check(
        "M6: 검은눈빛(교체 불가·고스트 면제·건 쪽이 물러나면 해제)·아름다운허물·페어리록",
        trapped && tryOut.sideB.activeIndex === 0 && !sw.isTrappedFromSwitching(freed.b, freed) && !sw.isTrappedFromSwitching(s2.b, s2) &&
          ghost?.statusInflictFailed === true && sw.isTrappedFromSwitching(fl.b, fl),
        `봉쇄=${trapped} 교체시도 후 활성=${tryOut.sideB.activeIndex} 허물=${sw.isTrappedFromSwitching(s2.b, s2)} 페어리록=${sw.isTrappedFromSwitching(fl.b, fl)}`,
      );
    }
    // 치유소원: 자신 기절 → 다음에 나온 포켓몬 HP·상태이상 전부 회복 / 교대할 포켓몬이 없으면 실패
    {
      const st = battle([mon("팬텀", ["치유소원"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["칼춤"])]);
      st.sideA.party[1].currentHp = 10;
      st.sideA.party[1].status = { condition: "burn", turnsElapsed: 0 };
      const out = run(st, "치유소원", "칼춤");
      const after = sw.applySwitch(out.nextState, "a", 1).nextState;
      const alone = actionOf(run(battle([mon("팬텀", ["치유소원"])], [mon("메타그로스", ["칼춤"])]), "치유소원", "칼춤"), "a");
      check(
        "M6: 치유소원 — 기절 후 나온 포켓몬 전부 회복 / 교대 불가면 실패",
        out.nextState.a.currentHp === 0 && after.a.currentHp === after.a.maxHp && !after.a.status.condition && alone?.healingWishFailed === true,
        `기절=${out.nextState.a.currentHp} 나온 HP=${after.a.currentHp}/${after.a.maxHp} 상태=${after.a.status.condition}`,
      );
    }
    // 부식가스(도구 제거·리사이클 불가)·록온(다음 일격기 필중)·자기장조작(플러스만)·집단구타(파티원마다 1타)
    {
      const gas = run(battle([mon("블래키", ["부식가스"])], [mon("메타그로스", ["칼춤"], null, "먹다남은음식")]), "부식가스", "칼춤").nextState;
      const lock = run(battle([mon("한카리아스", ["록온", "땅가르기"])], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]), "록온", "칼춤").nextState;
      const ohko = run(lock, "땅가르기", "칼춤", 0.99).nextState;
      const flux = run(battle([mon("로토무", ["자기장조작"], "플러스")], [mon("메타그로스", ["칼춤"])]), "자기장조작", "칼춤").nextState;
      const noFlux = actionOf(run(battle([mon("로토무", ["자기장조작"])], [mon("메타그로스", ["칼춤"])]), "자기장조작", "칼춤"), "a");
      const beat = actionOf(run(battle([mon("블래키", ["집단구타"]), mon("잠만보", ["누르기"]), mon("메타그로스", ["칼춤"])], [mon("잠만보", ["칼춤"])]), "집단구타", "칼춤"), "a");
      check(
        "M6: 부식가스·록온(일격기 필중)·자기장조작(플러스만)·집단구타(3마리 → 3타)",
        gas.b.currentItemId === null && gas.b.lastConsumedItemId === undefined && ohko.b.currentHp === 0 &&
          flux.a.stages.def === 1 && flux.a.stages.spd === 1 && noFlux?.magneticFluxFailed === true && beat.damage > 0 && beat.hitCount === 3,
        `부식가스=${gas.b.currentItemId} 록온 일격=${ohko.b.currentHp === 0} 자기장=${flux.a.stages.def}/${flux.a.stages.spd} 집단구타 ${beat.hitCount}타 ${beat.damage}`,
      );
    }
    // AI: 부식가스(먹다남은음식 제거)·치유소원(희생 평가)·자기장조작 — 평가 가능 + 토글
    {
      const P = dec.DEFAULT_DECISION_PARAMS;
      const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
      const gas = optOf(battle([mon("블래키", ["부식가스", "깨물어부수기"])], [mon("메타그로스", ["코멧펀치"], null, "먹다남은음식")]), "부식가스");
      const wish = optOf(battle([mon("팬텀", ["치유소원", "섀도볼"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"])]), "치유소원");
      check(
        "M6 AI: 부식가스·치유소원 평가 + 토글",
        gas.support?.effect?.kind === "itemRemove" && Number.isFinite(dec.scoreOption(gas, 0.5)) &&
          wish.support?.effect?.kind === "healingWish" && !!wish.support.effect.sacrifice &&
          dec.scoreOption(gas, 0.5, { ...P, trackMAware: false }) === -Infinity,
        `부식가스=${dec.scoreOption(gas, 0.5).toFixed(3)} 치유소원=${dec.scoreOption(wish, 0.5)}`,
      );
    }
    // 자동 검사(재발 방지 — 트랙 M 원인): 효과 필드가 없는 변화기는 더블 전용 목록에만, 위력 null 데미지 기술은 위력 계산 필드가 있어야
    {
      const baseKeys = new Set(["id", "name", "type", "category", "power", "accuracy", "pp", "priority", "effect", "tags", "makesContact", "classification", "notReflectable", "excludedFromCopycat", "excludedFromSleepTalk", "usageCondition", "requiresWeather"]);
      const doublesOnly = new Set(["도우미", "코칭", "와이드가드", "당신먼저", "사이드체인지", "드래곤옐", "분노가루", "순서미루기", "아로마미스트", "지휘", "데코레이션", "날따름"]);
      const powerKeys = ["fixedDamage", "flingsHeldItem", "damageEqualsUserHp", "counters", "countersAllCategories", "reversalPower", "targetAbsoluteWeightPower", "targetHpRatioPower", "setsTargetHpToUserHp", "spitUpPower", "beatUpPower", "weightRatioPower", "gyroBallPower", "electroBallPower", "halvesTargetHp", "oneHitKo"];
      const all = data.MOVES;
      const noEffect = all.filter((m) => m.category === "status" && Object.keys(m).every((k) => baseKeys.has(k)) && !doublesOnly.has(m.name));
      const noPower = all.filter((m) => m.category !== "status" && m.power === null && !powerKeys.some((k) => m[k] !== undefined));
      check(
        "자동 검사: 효과 없는 변화기(더블 전용 제외)·위력 계산 없는 데미지 기술 0건",
        noEffect.length === 0 && noPower.length === 0,
        `변화기=${noEffect.map((m) => m.name).join(",")} 데미지=${noPower.map((m) => m.name).join(",")}`,
      );
    }
  }
  // ── 트랙 L(ver.1.8): 성묘 — 쓰러진 같은 편 수만큼 위력(엔진·AI 같은 계산) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const dmg = (fainted) => {
      const st = battle([mon("팬텀", ["성묘"]), mon("잠만보", ["누르기"]), mon("메타그로스", ["칼춤"])], [mon("블래키", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))]);
      for (let i = 1; i <= fainted; i++) st.sideA.party[i].currentHp = 0;
      const out = rt.runTurn(st, act("성묘"), act("칼춤"), () => 0.5);
      const ai = opt(ev.evaluateOptions(st, "a"), "성묘");
      return { damage: out.result.actions.find((x) => x.actor === "a").damage, aiTurns: ai.hitsToKill.expected };
    };
    const d0 = dmg(0);
    const d2 = dmg(2);
    check(
      "트랙 L: 성묘 — 쓰러진 동료 2마리면 위력 150(엔진 데미지·AI 처치 턴 모두 반영)",
      d2.damage > d0.damage * 2 && d2.aiTurns < d0.aiTurns,
      `데미지 ${d0.damage}→${d2.damage} AI 처치 턴 ${d0.aiTurns.toFixed(2)}→${d2.aiTurns.toFixed(2)}`,
    );
  }
}
