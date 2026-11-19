// 8.3 D3-fix-12 자이로볼·일렉트릭볼의 스피드 입력 정정(E3-15): 위력 계산의 스피드가 Showdown `getStat('spe')`(랭크 floor·4096 체인·마비 floor,
// 날씨 특성·서핑테일·곡예·순풍·속보·스카프·철구)와 같아야 한다. 기대 위력은 "참조 스피드(Showdown 식)를 위력 함수에 넣은 값"이라 위력식(Q1/fix-13)과 무관하다.
// 설계 `8.3-D3-fix12-자이로일렉트릭볼설계.md`(검수 `…스피드입력정정설계-검수.md`).
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
  const ph = await server.ssrLoadModule("/src/lib/battle/preHitEffects.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
  const ss = await server.ssrLoadModule("/src/lib/speedStat.ts").catch(() => null);
  const json = JSON.stringify;
  const tr = Math.trunc;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });
  const IDLE = "도우미";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const fast = pts({ spe: 32 }), bulky = pts({ hp: 32, def: 32, spd: 32 });

  // ── 참조 스피드(Showdown getStat('spe')) ──
  const BT = [1, 1.5, 2, 2.5, 3, 3.5, 4];
  const sdModify = (v, m) => tr((tr(v * m) + 2047) / 4096);
  const sdChain = (mods) => mods.reduce((a, x) => (a * tr(x * 4096) + 2048) >> 12, 4096);
  const sd = (stat, stage, mods, par) => {
    let s = stage >= 0 ? Math.floor(stat * BT[stage]) : Math.floor(stat / BT[-stage]);
    if (mods.length) s = sdModify(s, sdChain(mods));
    if (par) s = Math.floor((s * 50) / 100);
    return s;
  };

  // ── 상태 구성 ──
  const para = { condition: "paralysis", turnsElapsed: 1 };
  const mk = ({ aMon = "번치코", aAbility = null, aItem = null, aSpe, aStage = 0, aStatus, aTailwind, aUnburden,
                bMon = "번치코", bAbility = null, bItem = null, bSpe, bStage = 0, bStatus, bTailwind, bUnburden,
                weather, field, magicRoom } = {}) => {
    const st = battle([mon(aMon, ["자이로볼", "일렉트릭볼", IDLE], aAbility, aItem, fast)], [mon(bMon, ["자이로볼", "일렉트릭볼", IDLE], bAbility, bItem, bulky)]);
    if (aSpe !== undefined) st.a.realStats = { ...st.a.realStats, spe: aSpe };
    if (bSpe !== undefined) st.b.realStats = { ...st.b.realStats, spe: bSpe };
    st.a.stages = { ...st.a.stages, spe: aStage }; st.b.stages = { ...st.b.stages, spe: bStage };
    if (aStatus) st.a.status = aStatus; if (bStatus) st.b.status = bStatus;
    if (aTailwind) st.sideA.tailwindTurnsRemaining = 4; if (bTailwind) st.sideB.tailwindTurnsRemaining = 4;
    if (aUnburden) st.a.unburdenActive = true; if (bUnburden) st.b.unburdenActive = true;
    if (weather) st.weather = weather; if (field) st.field = field;
    if (magicRoom) st.magicRoomTurnsRemaining = 5;
    return st;
  };
  const powerOf = (st, moveId) => ph.resolvePreHitEffects(st, "a", M(moveId), () => 0.5, false, M(IDLE)).effectiveMove?.power;
  const gyro = (u, t) => bp.gyroBallPowerFromSpeeds(u, t);
  const electro = (u, t) => bp.electroBallPowerFromSpeeds(u, t);

  // ── 1. 공용 함수 일치(엔진 ↔ 공용 ↔ 매치업) ──
  const combos = [
    { n: "엽록소+쾌청", aAbility: "엽록소", weather: "쾌청", mods: [2] },
    { n: "쓱쓱+비", aAbility: "쓱쓱", weather: "비", mods: [2] },
    { n: "모래헤치기+모래바람", aAbility: "모래헤치기", weather: "모래바람", mods: [2] },
    { n: "눈치우기+눈", aAbility: "눈치우기", weather: "눈", mods: [2] },
    { n: "엽록소+쾌청이지만 상대 날씨부정", aAbility: "엽록소", weather: "쾌청", bAbility: "날씨부정", mods: [] },
    { n: "서핑테일+일렉트릭필드", aAbility: "서핑테일", field: "일렉트릭필드", mods: [2] },
    { n: "곡예(도구 없음)", aAbility: "곡예", aUnburden: true, mods: [2] },
    { n: "속보+마비", aAbility: "속보", aStatus: para, mods: [1.5] },
    { n: "구애스카프", aItem: "구애스카프", mods: [1.5] },
    { n: "검은철구", aItem: "검은철구", mods: [0.5] },
    { n: "순풍", aTailwind: true, mods: [2] },
    { n: "스카프+순풍+마비+랭크+1", aItem: "구애스카프", aTailwind: true, aStatus: para, aStage: 1, mods: [1.5, 2], par: true, stage: 1 },
  ];
  guard("D3-fix12 1 공용 함수 computeSpeedWithEffects ↔ computeTurnOrderSpeed ↔ evaluateSpeedMatchup이 참조 스피드와 같은 정수 (12조합: 날씨 특성 4종·날씨부정·서핑테일·곡예·속보·스카프·철구·순풍·마비·랭크)", () => {
    if (!ss || typeof ss.computeSpeedWithEffects !== "function") return "speedStat.computeSpeedWithEffects 없음";
    for (const cb of combos) {
      const st = mk(cb); const real = st.a.realStats.spe;
      const want = sd(real, cb.stage ?? 0, cb.mods, !!cb.par || (cb.aStatus === para && cb.aAbility !== "속보"));
      const engine = toi.computeTurnOrderSpeed(st, st.a);
      const slotA = mon(cb.aMon ?? "번치코", ["자이로볼"], cb.aAbility ?? null, cb.aItem ?? null, fast).slot;
      const slotB = mon(cb.bMon ?? "번치코", ["자이로볼"], cb.bAbility ?? null, cb.bItem ?? null, bulky).slot;
      const matchup = me.evaluateSpeedMatchup(slotA, slotB, { weather: cb.weather, field: cb.field, attackerStatus: cb.aStatus?.condition, attackerStages: { ...st.a.stages }, attackerUnburden: !!cb.aUnburden, attackerTailwind: !!cb.aTailwind })?.attackerSpeed;
      const shared = ss.computeSpeedWithEffects({
        realSpe: real, stage: cb.aStage ?? 0, ability: cb.aAbility ? data.getAbility(cb.aAbility) : undefined, item: cb.aItem ? data.getItem(cb.aItem) : undefined,
        status: cb.aStatus?.condition ?? null, weather: cb.bAbility === "날씨부정" ? undefined : cb.weather, field: cb.field, unburdenActive: !!cb.aUnburden, tailwind: !!cb.aTailwind,
      });
      if (!(want === engine && want === matchup && want === shared)) return json({ combo: cb.n, want, engine, matchup, shared });
    }
    return true;
  });

  // ── 2~3. 엔진 위력 입력: 순풍 방향 ──
  guard("D3-fix12 2 일렉트릭볼: 상대(방어측)가 순풍이면 상대 스피드 ×2라 위력↓ — 참조 스피드로 계산한 위력과 일치", () => {
    const st = mk({ aSpe: 100, bSpe: 100, bTailwind: true });
    const want = electro(sd(100, 0, [], false), sd(100, 0, [2], false)), got = powerOf(st, "일렉트릭볼");
    return got === want && want < electro(100, 100) ? true : json({ want, got });
  });
  guard("D3-fix12 3 자이로볼: 내가 순풍이면 위력↓(상대가 상대적으로 느려짐) / 상대가 순풍이면 위력↑", () => {
    const mine = mk({ aSpe: 100, bSpe: 100, aTailwind: true }), theirs = mk({ aSpe: 100, bSpe: 100, bTailwind: true });
    const wantMine = gyro(sd(100, 0, [2], false), sd(100, 0, [], false)), wantTheirs = gyro(sd(100, 0, [], false), sd(100, 0, [2], false));
    const gotMine = powerOf(mine, "자이로볼"), gotTheirs = powerOf(theirs, "자이로볼");
    return gotMine === wantMine && gotTheirs === wantTheirs && wantMine < wantTheirs ? true : json({ wantMine, gotMine, wantTheirs, gotTheirs });
  });
  guard("D3-fix12 4 날씨 특성(엽록소+쾌청)·서핑테일(일렉트릭필드)·곡예(도구 없음)가 위력 입력에 반영", () => {
    const cases = [
      [mk({ aAbility: "엽록소", weather: "쾌청", aSpe: 100, bSpe: 100 }), sd(100, 0, [2], false)],
      [mk({ aAbility: "서핑테일", field: "일렉트릭필드", aSpe: 100, bSpe: 100 }), sd(100, 0, [2], false)],
      [mk({ aAbility: "곡예", aUnburden: true, aSpe: 100, bSpe: 100 }), sd(100, 0, [2], false)],
    ];
    for (const [st, userSpe] of cases) { const want = electro(userSpe, 100), got = powerOf(st, "일렉트릭볼"); if (got !== want) return json({ want, got, ab: st.a.effectiveAbilityId }); }
    return true;
  });
  guard("D3-fix12 5 마비 정수 절삭이 위력 입력에 반영: 사용자 스피드 61 마비 → 30(체인 뒤 floor)", () => {
    const st = mk({ aSpe: 61, bSpe: 60, aStatus: para });
    const want = gyro(sd(61, 0, [], true), 60), got = powerOf(st, "자이로볼");
    return got === want ? true : json({ want, got });
  });
  guard("D3-fix12 6 서투름(골루그)·매직룸: 구애스카프 무시(실전 조합 — 골루그는 자이로볼을 배운다)", () => {
    const k = mk({ aMon: "골루그", aAbility: "서투름", aItem: "구애스카프", aSpe: 100, bSpe: 100 });
    const m = mk({ aItem: "구애스카프", aSpe: 100, bSpe: 100, magicRoom: true });
    const want = electro(100, 100);
    const gk = powerOf(k, "일렉트릭볼"), gm = powerOf(m, "일렉트릭볼");
    return gk === want && gm === want ? true : json({ want, 서투름: gk, 매직룸: gm });
  });

  // ── 7~9. 매치업·AI ──
  const slots = (o) => ({
    a: mon(o.aMon ?? "번치코", ["자이로볼", "일렉트릭볼"], o.aAbility ?? null, o.aItem ?? null, fast).slot,
    b: mon(o.bMon ?? "번치코", ["자이로볼", "일렉트릭볼"], o.bAbility ?? null, o.bItem ?? null, bulky).slot,
  });
  const matchupPower = (moveId, o, opts) => { const s = slots(o); return me.evaluateSlotMatchup(s.a, M(moveId), s.b, opts)?.damageParts?.hitPowers?.[0]; };
  guard("D3-fix12 7 매치업 evaluateSlotMatchup의 일렉트릭볼·자이로볼 위력이 엔진과 같은 입력에서 같다(상대 순풍·날씨 특성·마비·랭크)", () => {
    const combos7 = [
      { o: { bAbility: null }, opts: { defenderTailwind: true }, eng: { bTailwind: true } },
      { o: { aAbility: "엽록소" }, opts: { weather: "쾌청" }, eng: { aAbility: "엽록소", weather: "쾌청" } },
      { o: {}, opts: { attackerStatus: "paralysis" }, eng: { aStatus: para } },
      { o: {}, opts: { attackerStages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } }, eng: { aStage: 1 } },
    ];
    for (const { o, opts, eng } of combos7) for (const mvId of ["일렉트릭볼", "자이로볼"]) {
      const st = mk(eng); const want = powerOf(st, mvId);
      // 엔진은 슬롯과 같은 자연 스피드를 쓰므로 override 없이 비교
      const got = matchupPower(mvId, o, opts);
      if (want !== got) return json({ mvId, eng: want, matchup: got, opts });
    }
    return true;
  });
  guard("D3-fix12 8 매치업 옵션: 기본값(꺼짐)은 현행과 같고, 곡예 토글(attackerUnburden)·순풍 토글을 켜면 반영", () => {
    const base = matchupPower("일렉트릭볼", { aAbility: "곡예" }, {});
    const on = matchupPower("일렉트릭볼", { aAbility: "곡예" }, { attackerUnburden: true });
    const defTw = matchupPower("일렉트릭볼", {}, { defenderTailwind: true });
    return base !== undefined && on > base && defTw < base ? true : json({ base, 곡예: on, 상대순풍: defTw });
  });
  guard("D3-fix12 9 AI 경로(moveDamage)가 실제 순풍·상태이상을 넘긴다: 상대 순풍이면 일렉트릭볼 기대 데미지↓, 내가 마비면 ↓", () => {
    const frac = (st) => md.estimateMoveHits({ state: st, attacker: st.a, defender: st.b, defenderSide: st.sideB, attackerMovesSecond: false }, M("일렉트릭볼"))?.damageFraction ?? 0;
    const plain = frac(mk({})), tw = frac(mk({ bTailwind: true })), paraD = frac(mk({ aStatus: para }));
    return tw < plain && paraD <= plain && plain > 0 ? true : json({ plain, 상대순풍: tw, 내마비: paraD });
  });
  guard("D3-fix12 10 보정·랭크 없음이면 현행과 같다(회귀): 같은 스피드 일렉트릭볼 60", () => {
    const st = mk({ aSpe: 100, bSpe: 100 });
    return powerOf(st, "일렉트릭볼") === 60 ? true : json(powerOf(st, "일렉트릭볼"));
  });
  guard("D3-fix12 11 일렉트릭볼 식 일치 회귀: 50/100 → 40, 100/100 → 60, 299/100 → 80, 300/100 → 120, 400/100 → 150", () => {
    const v = [[50, 100], [100, 100], [299, 100], [300, 100], [400, 100]].map(([u, t]) => electro(u, t));
    return json(v) === json([40, 60, 80, 120, 150]) ? true : json(v);
  });

  // ── 13~15. 효과 전수 보강(검수 §3-3) ──
  guard("D3-fix12 13 날씨 특성 4종 각각 ×2, 날씨부정이면 ×1(엔진·매치업 모두)", () => {
    const four = [["엽록소", "쾌청"], ["쓱쓱", "비"], ["모래헤치기", "모래바람"], ["눈치우기", "눈"]];
    for (const [ab, w] of four) {
      const st = mk({ aAbility: ab, weather: w, aSpe: 100, bSpe: 100 });
      if (powerOf(st, "일렉트릭볼") !== electro(200, 100)) return `${ab} ×2 실패`;
      const neg = mk({ aAbility: ab, weather: w, bAbility: "날씨부정", aSpe: 100, bSpe: 100 });
      if (powerOf(neg, "일렉트릭볼") !== electro(100, 100)) return `${ab} 날씨부정 ×1 실패`;
    }
    return true;
  });
  guard("D3-fix12 14 서핑테일 + 일렉트릭필드: 비접지(비행) 상대와 무관하게 ×2(접지 조건 없음)", () => {
    const st = mk({ aAbility: "서핑테일", field: "일렉트릭필드", aSpe: 100, bMon: "루차불", bSpe: 100 });
    return powerOf(st, "일렉트릭볼") === electro(200, 100) ? true : json(powerOf(st, "일렉트릭볼"));
  });
  guard("D3-fix12 15 곡예 상태가 켜져 있어도 도구를 들고 있으면(매직룸 중에도) ×1 — 실제 보유 기준", () => {
    const st = mk({ aAbility: "곡예", aItem: "구애스카프", aUnburden: true, aSpe: 100, bSpe: 100, magicRoom: true });
    return powerOf(st, "일렉트릭볼") === electro(100, 100) ? true : json(powerOf(st, "일렉트릭볼"));
  });

  // ── 16. 시점 재계산(검수 §2-5): 같은 턴 앞선 행동의 변화가 위력에 들어간다(턴 시작 저장값을 재사용하면 실패) ──
  const bDamage = (st) => { const o = rt.runTurn(st, mv(st.__a), mv("자이로볼"), () => 0.5); return (o.result ?? o.partialResult).actions.find((x) => x.actor === "b")?.damage; };
  guard("D3-fix12 16 시점 재계산: 빠른 쪽이 얼어붙은바람·순풍을 쓴 뒤 느린 쪽의 자이로볼 위력이 \"그 시점\" 스피드로 계산", () => {
    // a(빠름 150)가 먼저 행동, b(느림 100)가 자이로볼. 얼어붙은바람 → b 스피드 −1 → 자이로볼 위력↑. 같은 상황을 턴 시작에 이미 −1로 둔 것과 b의 데미지가 같아야 한다.
    const live = mk({ aSpe: 150, bSpe: 100 }); live.__a = "얼어붙은바람";
    const pre = mk({ aSpe: 150, bSpe: 100, bStage: -1 }); pre.__a = IDLE;
    const dLive = bDamage(live), dPre = bDamage(pre);
    // 순풍: a가 순풍을 쓴 뒤 b의 자이로볼 — 턴 시작에 이미 순풍인 것과 같아야 한다
    const live2 = mk({ aSpe: 150, bSpe: 100 }); live2.__a = "순풍";
    const pre2 = mk({ aSpe: 150, bSpe: 100, aTailwind: true }); pre2.__a = IDLE;
    const dLive2 = bDamage(live2), dPre2 = bDamage(pre2);
    const none = mk({ aSpe: 150, bSpe: 100 }); none.__a = IDLE; const dNone = bDamage(none);
    return dLive === dPre && dLive2 === dPre2 && dLive > dNone && dLive2 > dNone ? true : json({ 얼바: [dLive, dPre], 순풍: [dLive2, dPre2], 보정없음: dNone });
  });
}
