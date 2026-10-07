/**
 * 상대 실능치 역산(ver.2.1 C) 검증.
 *  1) 정수 데미지 공식: 역산이 쓰는 damageRolls 계열 식이 엔진 computeDamage와 같은 값을 내는지
 *  2) 왕복: 정해진 "진짜 배분"으로 관측을 만들어 역산에 넣으면 진짜 배분이 후보에 남는지(놓치면 안 됨), 후보가 얼마나 좁아지는지
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   node scripts/defense-inference-check.mjs [왕복 시행 수, 기본 150]
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const trials = Number(process.argv[2] ?? 150);
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
const fail = (msg) => {
  failed++;
  console.log("FAIL", msg);
};
try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const inf = await server.ssrLoadModule("/src/lib/defenseInference.ts");
  const ev = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const stat = await server.ssrLoadModule("/src/lib/statCalculator.ts");
  const form = await server.ssrLoadModule("/src/lib/pokemonForm.ts");
  const fm = await server.ssrLoadModule("/src/lib/damageFormula.ts");

  // 결정적 난수
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pts = (o = {}) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });

  const usable = data.MOVES.filter((m) => inf.inferenceUnsupportedReason(m) === null && m.power !== null && m.power > 0);
  const species = data.POKEMON.filter((p) => !p.formVariants && !p.sizeForms);
  const natureIds = data.NATURES.map((n) => n.id);

  const slot = (pokemonId, extra = {}) => ({ pokemonId, ability: null, item: null, nature: null, points: pts(), ...extra });

  // 1) 공식 대조 ------------------------------------------------------------------------------
  let formulaChecked = 0;
  for (let t = 0; t < 400; t++) {
    const atk = slot(pick(species).id, { points: pts({ atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
    const def = slot(pick(species).id, {
      points: pts({ hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33) }),
      nature: pick(natureIds),
    });
    const move = pick(usable);
    const res = ev.evaluateSlotMatchup(atk, move, def);
    if (!res?.damageParts) continue;
    const parts = res.damageParts;
    if (parts.hitPowers.length > 1) continue; // 다단히트는 역산 대상 아님(엔진도 타별 호출)
    const aPoke = data.getPokemon(atk.pokemonId);
    const dPoke = data.getPokemon(def.pokemonId);
    const aForm = form.getEffectiveForm(aPoke, atk);
    const dForm = form.getEffectiveForm(dPoke, def);
    const aReal = stat.computeRealStats(aForm.baseStats, atk.points, atk.nature);
    const dReal = stat.computeRealStats(dForm.baseStats, def.points, def.nature);
    for (const roll of [0.85, 0.93, 1.0]) {
      // 역산이 쓰는 식(damageFormula)
      const mine = fm.integerTotalDamage(parts, dReal[parts.defenseKey], roll);
      // 엔진: 단계별 배율을 그대로 넘긴다
      // 위력·분류는 evaluateSlotMatchup이 확정한 값(애크러뱃 ×2, 솔라빔 절반, 셸암즈 분류 등)으로 맞춰 넘긴다
      const engineMove = {
        ...move,
        power: parts.hitPowers[0],
        category: move.dynamicCategoryByHigherDamage ? (parts.defenseKey === "def" ? "physical" : "special") : move.category,
      };
      const engine = bp.computeDamage(aReal, dReal, aForm.types, engineMove, {
        typeEffectiveness: parts.typeEffectiveness,
        abilityMultiplier: parts.baseMultiplier,
        weatherMultiplier: parts.weatherMultiplier,
        stabMultiplier: parts.stabMultiplier,
        bulkMultiplier: parts.bulkMultiplier,
        finalMultiplier: parts.finalMultiplier,
        randomRoll: roll,
      });
      if (!engine) continue;
      formulaChecked++;
      if (engine.damage !== mine) fail(`공식 불일치 ${atk.pokemonId}→${def.pokemonId} ${move.id} roll=${roll}: 엔진 ${engine.damage} vs 역산 ${mine}`);
    }
  }
  console.log(`공식 대조 ${formulaChecked}건`);

  // 진짜 배분(defTrue)에 실제로 입힐 데미지로 관측 하나를 만든다. 쓰러뜨리는 관측(0%)은 제외.
  const makeObservation = (cands, atk, defTrue, dReal, hp, notFull = false) => {
    for (let tries = 0; tries < 20; tries++) {
      const move = pick(cands);
      const res = ev.evaluateSlotMatchup(atk, move, defTrue, notFull ? { defenderHpIsFull: false } : undefined);
      const p = res?.damageParts;
      if (!p || p.typeEffectiveness === 0) continue;
      const roll = (85 + Math.floor(rnd() * 16)) / 100;
      const damage = fm.integerTotalDamage(p, dReal[p.defenseKey], roll);
      if (damage >= hp) continue;
      const observation = { move, critical: false, before: inf.displayPercent(hp, dReal.hp), after: inf.displayPercent(hp - damage, dReal.hp) };
      return { observation, damage };
    }
    return null;
  };

  // 2) 왕복 -----------------------------------------------------------------------------------
  let ok = 0;
  let bulkChecked = 0;
  let narrowed = 0;
  let sumRatio = 0;
  let skipped = 0;
  for (let t = 0; t < trials; t++) {
    const atkId = pick(species).id;
    const atk = slot(atkId, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
    const defId = pick(species).id;
    const truth = {
      hp: Math.floor(rnd() * 33),
      def: Math.floor(rnd() * 33),
      spd: Math.floor(rnd() * 33),
      nature: pick(natureIds),
    };
    if (truth.hp + truth.def + truth.spd > 66) {
      skipped++;
      continue;
    }
    const defTrue = slot(defId, { points: pts(truth), nature: truth.nature });
    const dForm = form.getEffectiveForm(data.getPokemon(defId), defTrue);
    const dReal = stat.computeRealStats(dForm.baseStats, defTrue.points, defTrue.nature);
    // 물리 1개 + 특수 1개 관측 (HP가 남는 동안)
    const observations = [];
    let hp = dReal.hp;
    const wantCats = rnd() < 0.5 ? ["physical"] : ["physical", "special"];
    for (const cat of wantCats) {
      const made = makeObservation(usable.filter((m) => m.category === cat), atk, defTrue, dReal, hp);
      if (!made) continue;
      observations.push(made.observation);
      hp -= made.damage;
    }
    if (observations.length === 0) {
      skipped++;
      continue;
    }
    const result = inf.inferDefense({ attacker: atk, defender: slot(defId), observations });
    if (!result || result.status !== "ok") {
      fail(`왕복 실패(후보 없음) atk=${atkId} def=${defId} truth=${JSON.stringify(truth)} obs=${observations.map((o) => `${o.move.id}:${o.before}→${o.after}`)}`);
      continue;
    }
    const inHp = result.hp.min <= truth.hp && truth.hp <= result.hp.max;
    const inDef = !result.def || (result.def.min <= truth.def && truth.def <= result.def.max);
    const inSpd = !result.spd || (result.spd.min <= truth.spd && truth.spd <= result.spd.max);
    const gridOk =
      (!result.hpDefGrid || result.hpDefGrid[truth.def * 33 + truth.hp] === 1) &&
      (!result.hpSpdGrid || result.hpSpdGrid[truth.spd * 33 + truth.hp] === 1);
    const nat = data.NATURES.find((n) => n.id === truth.nature);
    const groupOk = result.groups.some((g) => g.feasible > 0 && g.natureNames.includes(nat.name));
    // 내구 지수(HP×방어)·가능도 가중: 진짜 값이 가능한 전체 범위 안에 있고, 중심 구간(80%)이 전체 범위 안쪽이어야 한다
    const bulkOf = (est, truthBulk) => !est || (est.support.min <= truthBulk && truthBulk <= est.support.max && est.support.min <= est.central.lo && est.central.hi <= est.support.max);
    const bulkOk = bulkOf(result.bulkPhysical, dReal.hp * dReal.def) && bulkOf(result.bulkSpecial, dReal.hp * dReal.spd);
    if (bulkOk) bulkChecked++;
    else fail(`왕복: 내구 지수 범위가 어긋남 atk=${atkId} def=${defId} truth=${JSON.stringify(truth)}`);
    if (inHp && inDef && inSpd && gridOk && groupOk) ok++;
    else fail(`왕복: 진짜 배분이 후보에서 빠짐 atk=${atkId} def=${defId} truth=${JSON.stringify(truth)} 결과 hp=${JSON.stringify(result.hp)} def=${JSON.stringify(result.def)} spd=${JSON.stringify(result.spd)} grid=${gridOk} group=${groupOk}`);
    sumRatio += result.feasible / result.total;
    if (result.feasible < result.total) narrowed++;
  }
  const done = trials - skipped;
  console.log(`내구 지수 검사 ${bulkChecked}건`);
  console.log(`왕복 ${ok}/${done} 통과 (건너뜀 ${skipped}) · 후보가 줄어든 경우 ${narrowed}건 · 평균 남은 비율 ${(done ? (sumRatio / done) * 100 : 0).toFixed(1)}%`);

  // 2.4 X1) 실측 사례 — 신중 메가갑주무사(HP31·특방32·스피드3, 흡혈) → 한카리아스(HP32·방어12·특방22, 215칸): 215→124(57%)→30(13%).
  // 화면 %가 올림(58%·14%)이 아니라 내림이라는 근거 — 올림 가정이면 이 관측과 맞는 진짜 배분이 빠진다.
  {
    const mega = data.getPokemon("갑주무사").megaEvolutions[0];
    const realAtk = { pokemonId: "갑주무사", ability: mega.ability, item: null, nature: "신중", points: pts({ hp: 31, spd: 32, spe: 3 }), activeMegaForm: mega.form };
    const realDef = slot("한카리아스");
    const move = data.getMove("흡혈");
    const res = inf.inferDefense({
      attacker: realAtk,
      defender: realDef,
      observations: [
        { move, critical: false, before: 100, after: 57 },
        { move, critical: false, before: 57, after: 13 },
      ],
    });
    if (inf.displayPercent(124, 215) !== 57 || inf.displayPercent(30, 215) !== 13 || inf.displayPercent(1, 215) !== 1) fail("화면 % 규칙(내림·최소 1%)이 실측과 다름");
    if (res?.status !== "ok" || res.hpDefGrid[12 * 33 + 32] !== 1) fail("실측 사례: 진짜 배분(HP32·방어12)이 후보에서 빠짐");
    else console.log("실측 사례 통과 (215→124→30, 57%·13%)");
  }

  // 2.2 C3) 메가폼 상대 — 메가 종족값·고정 특성으로 만든 관측이 메가 지정 역산에서 진짜 배분을 남기는지
  {
    const megaSpecies = data.POKEMON.filter((p) => p.megaEvolutions?.length);
    let megaOk = 0;
    let megaTried = 0;
    for (let t = 0; t < 60; t++) {
      const poke = pick(megaSpecies);
      const mega = pick(poke.megaEvolutions);
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd > 66) continue;
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const defTrue = slot(poke.id, { points: pts(truth), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
      const dReal = stat.computeRealStats(mega.baseStats, defTrue.points, defTrue.nature);
      const made = makeObservation(usable.filter((m) => m.category === "physical"), atk, defTrue, dReal, dReal.hp);
      if (!made) continue;
      megaTried++;
      const asMega = inf.inferDefense({ attacker: atk, defender: slot(poke.id, { activeMegaForm: mega.form, ability: mega.ability }), observations: [made.observation] });
      if (asMega?.status === "ok" && asMega.hp.min <= truth.hp && truth.hp <= asMega.hp.max && asMega.def.min <= truth.def && truth.def <= asMega.def.max) megaOk++;
      else fail(`메가 왕복: 진짜 배분이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${asMega?.status}`);
    }
    console.log(`메가 왕복 ${megaOk}/${megaTried} 통과`);
    if (megaTried === 0) fail("메가 왕복 시행이 0건");
  }

  // 2.5 L1) 메가 전→후 혼합 — 같은 포인트 배분으로 메가 전(첫 관측)·메가 후(둘째 관측)를 맞은 기록이 진짜 배분을 남기는지,
  // 그리고 메가 후 관측을 메가 전 폼으로 잘못 계산하면 진짜 배분이 빠지는지(=관측별 폼 태그가 실제로 쓰이는지)
  {
    const megaSpecies = data.POKEMON.filter((p) => p.megaEvolutions?.length && p.megaEvolutions.some((m) => m.baseStats.hp === p.baseStats.hp));
    let mixOk = 0;
    let mixTried = 0;
    let untaggedMissed = 0;
    for (let t = 0; t < 80; t++) {
      const poke = pick(megaSpecies);
      const mega = pick(poke.megaEvolutions.filter((m) => m.baseStats.hp === poke.baseStats.hp));
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd > 66) continue;
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const pre = slot(poke.id, { points: pts(truth), nature: truth.nature });
      const post = slot(poke.id, { points: pts(truth), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
      const preReal = stat.computeRealStats(poke.baseStats, pre.points, pre.nature);
      const postReal = stat.computeRealStats(mega.baseStats, post.points, post.nature);
      const physical = usable.filter((m) => m.category === "physical");
      const first = makeObservation(physical, atk, pre, preReal, preReal.hp);
      if (!first) continue;
      const second = makeObservation(physical, atk, post, postReal, preReal.hp - first.damage, true);
      if (!second) continue;
      mixTried++;
      const observations = [first.observation, { ...second.observation, megaForm: mega.form }];
      const mixed = inf.inferDefense({ attacker: atk, defender: slot(poke.id), observations });
      if (mixed?.status === "ok" && mixed.hpDefGrid[truth.def * 33 + truth.hp] === 1) mixOk++;
      else fail(`메가 전→후 혼합: 진짜 배분이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${mixed?.status}`);
      // 태그를 떼면(둘 다 메가 전으로 계산) 방어 종족값이 다른 경우 진짜 배분이 빠지거나 모순이 나야 한다 — 빠지는 사례가 하나라도 있어야 태그가 의미 있다
      const untagged = inf.inferDefense({ attacker: atk, defender: slot(poke.id), observations: observations.map((o) => ({ ...o, megaForm: undefined })) });
      if (untagged?.status !== "ok" || untagged.hpDefGrid[truth.def * 33 + truth.hp] !== 1) untaggedMissed++;
    }
    console.log(`메가 전→후 혼합 ${mixOk}/${mixTried} 통과 · 태그 없이는 진짜 배분이 빠진 경우 ${untaggedMissed}건`);
    if (mixTried === 0) fail("메가 전→후 혼합 시행이 0건");
    if (untaggedMissed === 0) fail("메가 전→후 혼합: 태그 유무 차이가 전혀 없음(태그가 반영되지 않는 듯)");
    const bad = inf.inferDefense({ attacker: slot("한카리아스"), defender: slot("갑주무사"), observations: [{ move: data.getMove("지진"), critical: false, before: 100, after: 50, megaForm: "없는폼" }] });
    if (bad?.status !== "invalid" || !bad.observationErrors[0]?.includes("메가폼")) fail("없는 메가폼 태그가 invalid로 안 잡힘");
  }

  // 3.1 C2-b) 공격 역산 왕복 — 진짜 공격 배분(포인트·성격)으로 "받은 데미지" 관측을 만들어 넣으면 진짜 값이 후보에 남는지.
  // 내 포켓몬(방어자)은 능력을 전부 아는 쪽, 상대 공격(특공) 포인트·성격을 역산한다.
  {
    const ai = await server.ssrLoadModule("/src/lib/attackInference.ts");
    const attackMoves = data.MOVES.filter((m) => ai.attackInferenceUnsupportedReason(m) === null && m.power !== null && m.power > 0);
    // 진짜 상대(oppTrue)가 내 포켓몬(mySlot)에게 실제로 입힐 데미지로 관측 하나를 만든다. 내 HP가 남지 않는 공격은 제외
    const makeAttackObservation = (cands, oppTrue, mySlot, maxHp, hp) => {
      for (let tries = 0; tries < 20; tries++) {
        const move = pick(cands);
        const res = ev.evaluateSlotMatchup(oppTrue, move, mySlot, { defenderHpIsFull: hp >= maxHp, skipVerdict: true });
        const p = res?.damageParts;
        if (!p || p.typeEffectiveness === 0) continue;
        const damage = fm.integerTotalDamage(p, res.defenseStat, (85 + Math.floor(rnd() * 16)) / 100);
        if (damage < hp) return { move, critical: false, hpBefore: hp, hpAfter: hp - damage };
      }
      return null;
    };
    let ok = 0;
    let tried = 0;
    let sumWidth = 0;
    let sumRealWidth = 0;
    let sumCombos = 0;
    let rangeCount = 0;
    const addWidths = (result) => {
      for (const [r, real] of [[result.atk, result.realAtk], [result.spa, result.realSpa]]) {
        if (!r) continue;
        sumWidth += r.max - r.min;
        sumRealWidth += real.max - real.min;
        rangeCount++;
      }
    };
    // 같은 종류(물리) 관측을 k개 모았을 때 실수치 범위가 얼마나 좁아지는지(관측이 늘수록 좁아져야 한다)
    const narrowing = (k) => {
      let width = 0;
      let count = 0;
      for (let t = 0; t < 40; t++) {
        const opp = pick(species);
        const oppTrue = slot(opp.id, { points: pts({ atk: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
        const mySlot = slot(pick(species).id, { points: pts({ hp: 32, def: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
        const myMax = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot).baseStats, mySlot.points, mySlot.nature).hp;
        const obs = [];
        for (let i = 0; i < k; i++) {
          // 매 관측 전에 HP를 가득 채운 상태로(회복했다고 보고) 독립 관측을 만든다
          const o = makeAttackObservation(attackMoves.filter((m) => m.category === "physical"), oppTrue, mySlot, myMax, myMax);
          if (o) obs.push(o);
        }
        if (obs.length < k) continue;
        const r = ai.inferAttack({ attacker: slot(opp.id), defender: mySlot, observations: obs });
        if (r?.realAtk) {
          width += r.realAtk.max - r.realAtk.min;
          count++;
        }
      }
      return count ? width / count : NaN;
    };
    for (let t = 0; t < 120; t++) {
      const opp = pick(species);
      const mine = pick(species);
      const truth = { atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33), nature: pick(natureIds) };
      const oppTrue = slot(opp.id, { points: pts({ atk: truth.atk, spa: truth.spa }), nature: truth.nature });
      const mySlot = slot(mine.id, {
        points: pts({ hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 20), spd: Math.floor(rnd() * 20) }),
        nature: pick(natureIds),
      });
      const myForm = form.getEffectiveForm(data.getPokemon(mine.id), mySlot);
      const myReal = stat.computeRealStats(myForm.baseStats, mySlot.points, mySlot.nature);
      // 물리 1개 + 특수 1개 관측(내 HP가 남는 동안)
      const observations = [];
      let hp = myReal.hp;
      for (const cat of rnd() < 0.5 ? ["physical"] : ["physical", "special"]) {
        const obs = makeAttackObservation(attackMoves.filter((m) => m.category === cat), oppTrue, mySlot, myReal.hp, hp);
        if (!obs) continue;
        observations.push(obs);
        hp = obs.hpAfter;
      }
      if (observations.length === 0) continue;
      tried++;
      const result = ai.inferAttack({ attacker: slot(opp.id), defender: mySlot, observations });
      const nat = data.NATURES.find((n) => n.id === truth.nature);
      const inAtk = !result?.atk || (result.atk.min <= truth.atk && truth.atk <= result.atk.max);
      const inSpa = !result?.spa || (result.spa.min <= truth.spa && truth.spa <= result.spa.max);
      const groupOk = result?.groups.some((g) => g.feasible > 0 && g.natureNames.includes(nat.name));
      if (result?.status === "ok" && inAtk && inSpa && groupOk) {
        ok++;
        addWidths(result);
        sumCombos += result.groups.filter((g) => g.feasible > 0).length;
      } else fail(`공격 역산 왕복: 진짜 배분이 빠짐 opp=${opp.id} truth=${JSON.stringify(truth)} 상태=${result?.status} atk=${JSON.stringify(result?.atk)} spa=${JSON.stringify(result?.spa)}`);
    }
    console.log(
      `공격 역산 왕복 ${ok}/${tried} 통과 · 스탯 하나당 평균 포인트 범위 폭 ${(sumWidth / Math.max(1, rangeCount)).toFixed(1)} · 실수치 범위 폭 ${(sumRealWidth / Math.max(1, rangeCount)).toFixed(1)} · 남은 성격 묶음 ${(sumCombos / Math.max(1, ok)).toFixed(1)}개`,
    );
    if (tried === 0) fail("공격 역산 왕복 시행이 0건");
    const w1 = narrowing(1);
    const w3 = narrowing(3);
    const w6 = narrowing(6);
    console.log(`공격 역산 관측 수별 실수치 범위 폭(물리, 평균): 1회 ${w1.toFixed(1)} · 3회 ${w3.toFixed(1)} · 6회 ${w6.toFixed(1)}`);
    if (!(w3 < w1 && w6 < w3)) fail("공격 역산: 관측이 늘어도 범위가 좁아지지 않음");
    // 메가 전→후 혼합: 같은 공격 배분으로 메가 전(첫 관측)·메가 후(둘째 관측, 메가폼 공격 종족값·특성)에 맞은 기록이 진짜 값을 남기는지,
    // 태그를 떼면(둘 다 메가 전으로 계산) 진짜 값이 빠지는 사례가 있는지(=관측별 폼이 실제로 쓰이는지)
    const megaSpecies = species.filter((p) => p.megaEvolutions?.length);
    let megaOk = 0;
    let megaTried = 0;
    let untaggedMissed = 0;
    for (let t = 0; t < 80; t++) {
      const poke = pick(megaSpecies);
      const mega = pick(poke.megaEvolutions);
      const truth = { atk: Math.floor(rnd() * 33), nature: pick(natureIds) };
      const pre = slot(poke.id, { points: pts({ atk: truth.atk }), nature: truth.nature });
      const post = slot(poke.id, { points: pts({ atk: truth.atk }), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
      const mySlot = slot(pick(species).id, { points: pts({ hp: 32, def: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myMax = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot).baseStats, mySlot.points, mySlot.nature).hp;
      const physical = attackMoves.filter((m) => m.category === "physical");
      const first = makeAttackObservation(physical, pre, mySlot, myMax, myMax);
      const second = first && makeAttackObservation(physical, post, mySlot, myMax, first.hpAfter);
      if (!second) continue;
      megaTried++;
      const observations = [first, { ...second, megaForm: mega.form }];
      const mixed = ai.inferAttack({ attacker: slot(poke.id), defender: mySlot, observations });
      if (mixed?.status === "ok" && mixed.atk.min <= truth.atk && truth.atk <= mixed.atk.max) megaOk++;
      else fail(`공격 역산 메가 혼합: 진짜 값이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${mixed?.status}`);
      const untagged = ai.inferAttack({ attacker: slot(poke.id), defender: mySlot, observations: observations.map((o) => ({ ...o, megaForm: undefined })) });
      if (untagged?.status !== "ok" || untagged.atk.min > truth.atk || truth.atk > untagged.atk.max) untaggedMissed++;
    }
    console.log(`공격 역산 메가 전→후 혼합 ${megaOk}/${megaTried} 통과 · 태그 없이는 진짜 값이 빠진 경우 ${untaggedMissed}건`);
    if (megaTried === 0) fail("공격 역산 메가 혼합 시행이 0건");
    if (untaggedMissed === 0) fail("공격 역산 메가 혼합: 태그 유무 차이가 전혀 없음(태그가 반영되지 않는 듯)");
    const badForm = ai.inferAttack({
      attacker: slot("한카리아스"),
      defender: slot("망나뇽", { points: pts({ hp: 20 }) }),
      observations: [{ move: data.getMove("지진"), critical: false, hpBefore: 100, hpAfter: 50, megaForm: "없는폼" }],
    });
    if (badForm?.status !== "invalid" || !badForm.observationErrors[0]?.includes("메가폼")) fail("공격 역산: 없는 메가폼 태그가 invalid로 안 잡힘");
    // 공격 보정 후보 목록(화면의 "상대 공격 보정 특성·도구 가정") — 대표 항목이 들어 있고 방어 후보(반감 열매 등)는 섞이지 않는다
    const atkItems = new Set(ai.ATTACK_ITEM_CANDIDATES.map((i) => i.id));
    const atkAbilities = new Set(ai.ATTACK_ABILITY_CANDIDATES.map((x) => x.id));
    if (!["생명의구슬", "달인의띠", "힘의머리띠", "박식안경", "실크스카프"].every((id) => atkItems.has(id)) || ai.ATTACK_ITEM_CANDIDATES.some((i) => i.resistsSuperEffectiveType !== undefined)) {
      fail("공격 보정 도구 후보가 이상함");
    }
    if (!["테크니션", "근성", "천하장사", "맹화"].every((id) => atkAbilities.has(id))) fail("공격 보정 특성 후보가 이상함");
    console.log(`공격 보정 후보: 도구 ${atkItems.size}종 · 특성 ${atkAbilities.size}종`);
    // 방어·공격 결합(성격 공유 + 포인트 예산): 같은 상대의 진짜 배분으로 두 종류 관측을 만들어 결합해도 진짜 값이 남고,
    // 결합 전(각각)보다 후보가 늘지 않으며, 실제로 좁아지는 사례가 있는지
    const cb = await server.ssrLoadModule("/src/lib/combinedInference.ts");
    let cbTried = 0;
    let cbOk = 0;
    let defNarrowed = 0;
    let atkNarrowed = 0;
    let sumNaturesBefore = 0;
    let sumMs = 0;
    let maxMs = 0;
    let sumNaturesAfter = 0;
    for (let t = 0; t < 200; t++) {
      const opp = pick(species);
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd + truth.atk + truth.spa > 66) continue;
      const oppTrue = slot(opp.id, { points: pts(truth), nature: truth.nature });
      const mySlot = slot(pick(species).id, { points: pts({ hp: 32, atk: 32, spa: 32, def: Math.floor(rnd() * 20), spd: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myForm = form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot);
      const myReal = stat.computeRealStats(myForm.baseStats, mySlot.points, mySlot.nature);
      const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(opp.id), oppTrue).baseStats, oppTrue.points, oppTrue.nature);
      // 방어 쪽: 내가 입힌 데미지(물리+특수), 공격 쪽: 내가 받은 데미지(물리+특수)
      const dealt = [];
      let oppHp = oppReal.hp;
      for (const cat of ["physical", "special"]) {
        const made = makeObservation(usable.filter((m) => m.category === cat), mySlot, oppTrue, oppReal, oppHp);
        if (!made) continue;
        dealt.push(made.observation);
        oppHp -= made.damage;
      }
      const received = [];
      let myHp = myReal.hp;
      for (const cat of ["physical", "special"]) {
        const obs = makeAttackObservation(attackMoves.filter((m) => m.category === cat), oppTrue, mySlot, myReal.hp, myHp);
        if (!obs) continue;
        received.push(obs);
        myHp = obs.hpAfter;
      }
      if (dealt.length === 0 || received.length === 0) continue;
      cbTried++;
      const defenseInput = { attacker: mySlot, defender: slot(opp.id), observations: dealt };
      const attackInput = { attacker: slot(opp.id), defender: mySlot, observations: received };
      const d0 = inf.inferDefense(defenseInput);
      const a0 = ai.inferAttack(attackInput);
      const t0 = performance.now();
      const c = cb.inferCombined(defenseInput, attackInput);
      const ms = performance.now() - t0;
      sumMs += ms;
      maxMs = Math.max(maxMs, ms);
      const inR = (r, v) => !r || (r.min <= v && v <= r.max);
      const okAll =
        c.conflict === null && c.defense?.status === "ok" && c.attack?.status === "ok" &&
        inR(c.defense.hp, truth.hp) && inR(c.defense.def, truth.def) && inR(c.defense.spd, truth.spd) &&
        inR(c.attack.atk, truth.atk) && inR(c.attack.spa, truth.spa) &&
        c.natures?.some((n) => n.name === data.NATURES.find((x) => x.id === truth.nature).name) &&
        c.defense.feasible <= d0.feasible && c.attack.feasible <= a0.feasible;
      if (okAll) {
        cbOk++;
        if (c.defense.feasible < d0.feasible) defNarrowed++;
        if (c.attack.feasible < a0.feasible) atkNarrowed++;
        sumNaturesBefore += data.NATURES.filter((n) => d0.groups.some((g) => g.feasible > 0 && g.natureNames.includes(n.name))).length;
        sumNaturesAfter += c.natures.length;
      } else fail(`결합 왕복: 진짜 배분이 빠지거나 후보가 늘었음 opp=${opp.id} truth=${JSON.stringify(truth)} 충돌=${c.conflict} 방어=${c.defense?.status} 공격=${c.attack?.status}`);
    }
    console.log(
      `방어·공격 결합 왕복 ${cbOk}/${cbTried} 통과 · 후보가 줄어든 사례 방어 ${defNarrowed}건·공격 ${atkNarrowed}건 · 성격 후보 평균 ${(sumNaturesBefore / Math.max(1, cbOk)).toFixed(1)}개(방어 쪽만) → ${(sumNaturesAfter / Math.max(1, cbOk)).toFixed(1)}개(결합)`,
    );
    if (cbTried === 0) fail("방어·공격 결합 왕복 시행이 0건");
    console.log(`방어·공격 결합 계산 시간: 평균 ${(sumMs / Math.max(1, cbTried)).toFixed(0)}ms · 최대 ${maxMs.toFixed(0)}ms`);
    if (maxMs > 5000) fail(`방어·공격 결합이 너무 느림(${maxMs.toFixed(0)}ms)`);
    if (defNarrowed + atkNarrowed === 0) fail("방어·공격 결합: 후보가 줄어든 사례가 전혀 없음(결합이 반영되지 않는 듯)");
    // 일부러 틀린 관측(불가능한 데미지)은 모순이어야 한다
    const mine = slot("한카리아스", { points: pts({ hp: 20 }), nature: "조심" });
    const myMax = stat.computeRealStats(form.getEffectiveForm(data.getPokemon("한카리아스"), mine).baseStats, mine.points, mine.nature).hp;
    const contradiction = ai.inferAttack({
      attacker: slot("망나뇽"),
      defender: mine,
      observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: myMax, hpAfter: myMax - 3 }],
    });
    const faint = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: 30, hpAfter: 0 }] });
    const badHp = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: myMax + 5, hpAfter: 10 }] });
    const noMove = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("자이로볼"), critical: false, hpBefore: myMax, hpAfter: myMax - 40 }] });
    if (contradiction?.status !== "contradiction") fail(`공격 역산: 불가능한 데미지가 ${contradiction?.status}`);
    if (faint?.status !== "invalid" || !faint.observationErrors[0]?.includes("쓰러진")) fail("공격 역산: 쓰러진 관측이 invalid로 안 잡힘");
    if (badHp?.status !== "invalid" || !badHp.observationErrors[0]?.includes("최대 HP")) fail("공격 역산: 최대 HP 초과가 invalid로 안 잡힘");
    if (noMove?.status !== "invalid" || !noMove.observationErrors[0]?.includes("스피드")) fail("공격 역산: 스피드 위력 기술이 invalid로 안 잡힘");
    console.log(`공격 역산 예외: 모순 ${contradiction?.status} · 쓰러짐 ${faint?.status} · HP 초과 ${badHp?.status} · 자이로볼 ${noMove?.status}`);
  }

  // 3.1 C2-a) 극보정 형태 표시 — 32가 두 개 이하이고 나머지 합이 2 이하. 표시용이라 계산엔 영향이 없다.
  {
    const ext = inf.isExtremePoints;
    const cases = [
      [[32, 32], true], [[32, 2], true], [[2, 32], true], [[1, 1], true], [[0, 0], true], [[2, 0], true],
      [[2, 2], false], [[31, 1], false], [[16, 16], false], [[32, 3], false], [[32, 32, 32], false], [[32, 32, 2], true], [[32, 32, 3], false],
    ];
    const bad = cases.filter(([v, want]) => ext(v) !== want);
    if (bad.length) fail(`극보정 형태 판정이 다름: ${JSON.stringify(bad)}`);
    // HP×방어 격자 전체(33×33)에서 극보정 칸은 13개(32·32 1 + 32와 0~2 6 + 합 2 이하 6)
    const full = new Uint8Array(33 * 33).fill(1);
    const counted = inf.countExtremeCells(full);
    if (counted.feasible !== 1089 || counted.extreme !== 13) fail(`극보정 칸 수가 13이 아님: ${JSON.stringify(counted)}`);
    // 기본 샘플의 실제 배분 중 극보정 형태 비율(정의가 실사용과 맞는지 점검 — 나머지는 내구를 나눠 투자한 배분)
    let total = 0;
    let extremeSlots = 0;
    for (const party of data.SAMPLE_PARTIES) {
      for (const sl of party.slots) {
        total++;
        if (ext(Object.values(sl.points))) extremeSlots++;
      }
    }
    console.log(`극보정 형태 판정 ${cases.length}건 통과 · 격자 극보정 칸 ${counted.extreme}개 · 기본 샘플 슬롯 중 극보정 형태 ${extremeSlots}/${total} (${((extremeSlots / total) * 100).toFixed(0)}%)`);
    if (extremeSlots / total < 0.5) fail("극보정 형태 정의가 기본 샘플 배분과 너무 안 맞음");
  }

  // 3) 모순 / 면역 ----------------------------------------------------------------------------
  {
    const atk = slot("한카리아스", { points: pts({ atk: 32 }), nature: "고집" });
    const move = data.getMove("지진");
    const contradiction = inf.inferDefense({
      attacker: atk,
      defender: slot("마기라스"),
      observations: [
        { move, critical: false, before: 100, after: 99 },
        { move, critical: false, before: 99, after: 0 },
      ],
    });
    if (contradiction?.status !== "contradiction") fail(`모순 시나리오 상태가 ${contradiction?.status}`);
    const immune = inf.inferDefense({
      attacker: atk,
      defender: slot("망나뇽"),
      observations: [{ move, critical: false, before: 100, after: 80 }],
    });
    if (immune?.status !== "invalid" || !immune.observationErrors[0]?.includes("효과가 없는")) fail("타입 면역 관측이 invalid로 안 잡힘");
    console.log(`모순 시나리오: ${contradiction?.status} · 면역 관측: ${immune?.status}`);
  }
} finally {
  await server.close();
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
