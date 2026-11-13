// 8.3 B4·B5 셸암즈 분류: 평가기(매치업 화면·AI)가 엔진과 같은 규칙(물리·특수 정수 데미지 비교, 동점은 엔진 반반·평가기 물리 고정)으로 분류한다.
// B5 — 본가(Showdown) 식과 엔진 분류가 같음을 회귀 감시한다(S-d). 설계 `8.3-B4B5-셸암즈평가기설계.md` §4(S-a~S-j).
// 평가기의 분류는 결과 필드가 없어 `damageParts.defenseKey`("def" = 물리, "spd" = 특수)로 읽는다.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const NEUTRAL = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  const ARM = data.getMove("셸암즈"), ATK = "가라르야도란";
  const DEFS = ["메타그로스", "망나뇽", "잠만보", "한카리아스", "킬가르도", "마기라스", "토게키스", "라우드본"].filter((n) => data.getPokemon(n));
  const mv = (m) => ({ kind: "move", move: data.getMove(m) });
  const slotOf = (id, p) => mon(id, ["셸암즈"], null, null, p).slot;
  // 시드 난수(재현 가능)
  let seed = 8300;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const NATURES = [null, "고집", "조심", "겁쟁이", "신중", "대담", "온순", "차분", "냉정", "무사태평"];
  const rndPoints = () => { const o = pts(); let left = 66; for (const k of ["hp", "atk", "def", "spa", "spd", "spe"]) { const v = Math.min(32, Math.floor(rnd() * (left + 1))); o[k] = v; left -= v; } return o; };
  const rndStages = () => ({ ...NEUTRAL, atk: Math.floor(rnd() * 13) - 6, def: Math.floor(rnd() * 13) - 6, spa: Math.floor(rnd() * 13) - 6, spd: Math.floor(rnd() * 13) - 6 });
  const mkSlot = (id, points, nature, ability = null) => ({ ...slotOf(id, points), nature, ability });

  // 규칙 기준 구현(시험 안): 정수 데미지(최대 난수) 물리·특수 비교 — 엔진이 쓰는 computeDamage 그대로
  const refCat = (aReal, dReal, types, aSt, dSt) => {
    const o = { attackerStages: aSt, defenderStages: dSt };
    const p = bp.computeDamage(aReal, dReal, types, { ...ARM, category: "physical" }, o)?.damage ?? 0;
    const s = bp.computeDamage(aReal, dReal, types, { ...ARM, category: "special" }, o)?.damage ?? 0;
    return p > s ? "physical" : s > p ? "special" : "tie";
  };
  // Showdown 식(4단 floor, 랭크만 반영, 레벨 50, 위력 90) — B5 대조
  const sdStat = (v, b) => b >= 0 ? Math.floor(v * (2 + b) / 2) : Math.floor(v * 2 / (2 - b));
  const sdCat = (aReal, dReal, aSt, dSt) => {
    const f = (a, d) => Math.floor(Math.floor(Math.floor(Math.floor(2 * 50 / 5 + 2) * 90 * a) / d) / 50);
    const p = f(sdStat(aReal.atk, aSt.atk), sdStat(dReal.def, dSt.def)), s = f(sdStat(aReal.spa, aSt.spa), sdStat(dReal.spd, dSt.spd));
    return p > s ? "physical" : s > p ? "special" : "tie";
  };
  const evalCat = (aSlot, dSlot, aSt, dSt, extra = {}) => {
    const r = me.evaluateSlotMatchup(aSlot, ARM, dSlot, { attackerStages: aSt, defenderStages: dSt, ...extra });
    return r?.damageParts?.defenseKey === "spd" ? "special" : r?.damageParts?.defenseKey === "def" ? "physical" : "none";
  };
  const realOf = async () => (await server.ssrLoadModule("/src/lib/statCalculator.ts")).computeRealStats;
  const crs = await realOf();
  const info = (slot) => { const f = data.getPokemon(slot.pokemonId); return { real: crs(f.baseStats, slot.points, slot.nature), types: f.types }; };

  // 엔진 분류: 한 턴 돌려 셸암즈를 쓴 행동의 shellSideArmCategory를 읽는다(상대는 하품 — 선공으로 쓰러뜨리지 않는 무해한 기술)
  const engineCat = (aSlot, dSlot, { aSt, dSt, rand = () => 0.5, tweak, dAbility = null } = {}) => {
    const a = { slot: aSlot, moves: [ARM] };
    const d = mon(dSlot.pokemonId, ["하품"], dAbility ?? dSlot.ability, null, dSlot.points);
    d.slot.nature = dSlot.nature;
    const st = battle([a], [d]);
    if (aSt) st.a.stages = { ...aSt };
    if (dSt) st.b.stages = { ...dSt };
    tweak?.(st);
    const o = rt.runTurn(st, mv("셸암즈"), mv("하품"), rand);
    const act = (o.result ?? o.partialResult).actions.find((x) => x.actor === "a");
    return act?.shellSideArmCategory ?? "none";
  };

  // ── S-a: 핵심 사례 — 메타그로스 상대 야도란(가라르)(포인트 0·무보정): 특수(특공 140 vs 특방 110)가 이긴다
  { const aS = mkSlot(ATK, pts(), null), dS = mkSlot("메타그로스", pts(), null), n = NEUTRAL;
    const ai = info(aS), di = info(dS), want = refCat(ai.real, di.real, ai.types, n, n), got = evalCat(aS, dS, n, n), eng = engineCat(aS, dS);
    check("8.3 B4 S-a: 메타그로스 상대 — 평가기 분류 = 엔진 분류 = 특수", want === "special" && got === "special" && eng === "special", `기준 ${want} / 평가기 ${got} / 엔진 ${eng}`); }

  // ── S-b: 무작위 1,000판 — 평가기 분류 = 기준 분류(동점 제외), 엔진 분류도 같다(200판) ──
  { let bad = 0, ties = 0, engBad = 0, firstBad = "";
    for (let i = 0; i < 1000; i++) {
      const aS = mkSlot(ATK, rndPoints(), pick(NATURES)), dS = mkSlot(pick(DEFS), rndPoints(), pick(NATURES)), aSt = rndStages(), dSt = rndStages();
      const ai = info(aS), di = info(dS), want = refCat(ai.real, di.real, ai.types, aSt, dSt);
      if (want === "tie") { ties++; continue; }
      const got = evalCat(aS, dS, aSt, dSt);
      if (got !== want) { bad++; firstBad ||= `${dS.pokemonId} 기준 ${want} 평가기 ${got}`; }
      if (i < 200 && engineCat(aS, dS, { aSt, dSt }) !== want) engBad++;
    }
    check("8.3 B4 S-b: 무작위 1,000판 평가기 분류 = 기준 분류(동점 제외)", bad === 0, `불일치 ${bad}/${1000 - ties} (동점 ${ties}) ${firstBad}`);
    check("8.3 B5 S-b: 엔진 분류 = 기준 분류(앞 200판)", engBad === 0, `불일치 ${engBad}`); }

  // ── S-c: 동점 — 평가기는 물리 고정, 엔진은 난수 한 번(c.random() < 0.5 → 물리) ──
  { let found = null;
    for (let i = 0; i < 20000 && !found; i++) {
      const aS = mkSlot(ATK, rndPoints(), pick(NATURES)), dS = mkSlot(pick(DEFS), rndPoints(), pick(NATURES)), ai = info(aS), di = info(dS);
      if (refCat(ai.real, di.real, ai.types, NEUTRAL, NEUTRAL) === "tie") found = { aS, dS };
    }
    if (!found) check("8.3 B4 S-c: 동점 구성 탐색", false, "20000판에서 못 찾음");
    else {
      const ev = evalCat(found.aS, found.dS, NEUTRAL, NEUTRAL), lo = engineCat(found.aS, found.dS, { rand: () => 0.3 }), hi = engineCat(found.aS, found.dS, { rand: () => 0.9 });
      check("8.3 B4 S-c: 동점이면 평가기는 물리, 엔진은 난수 < 0.5 물리·그 외 특수", ev === "physical" && lo === "physical" && hi === "special", `평가기 ${ev} / 엔진 0.3→${lo}, 0.9→${hi}`);
    } }

  // ── S-d: Showdown 식 대조(B5) — 무작위 5,000판(랭크 ±6 포함): 기준 분류 = Showdown 4단 floor 식(동점 포함) ──
  { let bad = 0, first = "";
    for (let i = 0; i < 5000; i++) {
      const aS = mkSlot(ATK, rndPoints(), pick(NATURES)), dS = mkSlot(pick(DEFS), rndPoints(), pick(NATURES)), aSt = rndStages(), dSt = rndStages(), ai = info(aS), di = info(dS);
      const w = refCat(ai.real, di.real, ai.types, aSt, dSt), s = sdCat(ai.real, di.real, aSt, dSt);
      if (w !== s) { bad++; first ||= `${w} vs ${s}`; }
    }
    check("8.3 B5 S-d: 엔진 규칙 분류 = Showdown 식 분류(5,000판, 랭크 ±6)", bad === 0, `불일치 ${bad} ${first}`);
    check("8.3 B4 S-d: 공용 함수 shellSideArmCategory(battlePower)가 기준 분류와 같다(동점은 \"tie\")", typeof bp.shellSideArmCategory === "function" && (() => { const aS = mkSlot(ATK, pts(), null), dS = mkSlot("메타그로스", pts(), null), ai = info(aS), di = info(dS); return bp.shellSideArmCategory(ai.real, di.real, ai.types, ARM, { attackerStages: NEUTRAL, defenderStages: NEUTRAL }) === "special"; })(), typeof bp.shellSideArmCategory); }

  // ── S-e: 실전 AI 경로(attackerRuntime — 현재 실능·랭크) 분류 = 엔진 분류 ──
  { let bad = 0, first = "";
    for (let i = 0; i < 300; i++) {
      const aS = mkSlot(ATK, rndPoints(), pick(NATURES)), dS = mkSlot(pick(DEFS), rndPoints(), pick(NATURES)), aSt = rndStages(), dSt = rndStages(), ai = info(aS), di = info(dS);
      const want = refCat(ai.real, di.real, ai.types, aSt, dSt); if (want === "tie") continue;
      const got = evalCat(aS, dS, aSt, dSt, { attackerRuntime: { types: ai.types, realStats: ai.real, abilityId: null, itemId: null, weightKg: undefined, grounded: true }, defenderRuntime: { types: di.types, realStats: di.real, abilityId: null, itemId: null, weightKg: undefined, grounded: true } });
      if (got !== want) { bad++; first ||= `${dS.pokemonId} 기준 ${want} 평가기 ${got}`; }
    }
    check("8.3 B4 S-e: 런타임 입력(attackerRuntime·defenderRuntime) 경로의 분류 = 엔진 규칙", bad === 0, `불일치 ${bad} ${first}`); }

  // ── S-f·S-h: 분류 비교에 날씨·방어측 특성·공격측 화상이 안 들어간다 — 같은 구성에서 분류가 안 변한다 ──
  { const aS = mkSlot(ATK, pts(), null), dS = mkSlot("메타그로스", pts(), null), base = engineCat(aS, dS);
    const sand = engineCat(aS, dS, { tweak: (st) => { st.weather = "모래바람"; st.weatherTurnsRemaining = 5; } });
    const fat = engineCat(aS, dS, { dAbility: "두꺼운지방" });
    const burn = engineCat(aS, dS, { tweak: (st) => { st.a.status = { condition: "burn", turnsElapsed: 0 }; } });
    check("8.3 B5 S-f·S-h: 날씨·방어측 특성·공격측 화상을 바꿔도 분류는 그대로(엔진)", [sand, fat, burn].every((x) => x === base) && base === "special", `기준 ${base} / 모래바람 ${sand} / 두꺼운지방 ${fat} / 화상 ${burn}`); }

  // ── S-g: 상대 미선택 결정력(computeSoloOffensePower) 불변 — 변경 전 값을 고정 ──
  { const aS = mkSlot(ATK, pts({ atk: 32, spa: 20 }), null), v = me.computeSoloOffensePower(aS, ARM);
    check("8.3 B4 S-g: 상대 미선택 결정력은 공격 vs 특공 결정력 비교 그대로(값 고정)", typeof v === "number" && v === SOLO_SNAPSHOT, `값 ${v}`); }

  // ── S-i: 천진 — 분류는 천진 반영 전 랭크로 한다(엔진·평가기 입력 모두) ──
  { let found = null;
    for (let i = 0; i < 20000 && !found; i++) {
      const aS = mkSlot(ATK, rndPoints(), pick(NATURES)), dS = mkSlot(pick(DEFS), rndPoints(), pick(NATURES)), ai = info(aS), di = info(dS), aSt = { ...NEUTRAL, spa: 2 };
      const raw = refCat(ai.real, di.real, ai.types, aSt, NEUTRAL), flat = refCat(ai.real, di.real, ai.types, NEUTRAL, NEUTRAL);
      if (raw !== "tie" && flat !== "tie" && raw !== flat) found = { aS, dS, aSt, raw };
    }
    if (!found) check("8.3 B4 S-i: 천진 구성 탐색", false, "못 찾음");
    else {
      const eng = engineCat(found.aS, found.dS, { aSt: found.aSt, dAbility: "천진" }), ev = evalCat(found.aS, found.dS, found.aSt, NEUTRAL);
      check("8.3 B4 S-i: 상대가 천진이어도 분류는 원래 랭크 기준(엔진·평가기·기준 일치)", eng === found.raw && ev === found.raw, `기준 ${found.raw} / 엔진 ${eng} / 평가기 ${ev}`);
    } }

  // ── S-j: 원더룸 중 엔진 분류는 맞바꾸기 전 실능으로 한다(출력 불변 확인) ──
  { const aS = mkSlot(ATK, pts(), null), dS = mkSlot("메타그로스", pts(), null), ai = info(aS), di = info(dS), want = refCat(ai.real, di.real, ai.types, NEUTRAL, NEUTRAL);
    const got = engineCat(aS, dS, { tweak: (st) => { st.wonderRoomTurnsRemaining = 5; } });
    check("8.3 B4 S-j: 원더룸 중 엔진 분류 = 맞바꾸기 전 실능 기준", want === "special" && got === want, `기준 ${want} / 엔진 ${got}`); }
}

// S-g 기준값 — 변경 전 현행 코드에서 잰 값(공격 140+?·특공 포함 결정력). B4 구현 전 현행 코드에서 잰 값.
const SOLO_SNAPSHOT = 20520;
