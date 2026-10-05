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
    const res = ev.evaluateSlotMatchup(atk, move, def, { applyMoveOwnStatChanges: false });
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
  const makeObservation = (cands, atk, defTrue, dReal, hp) => {
    for (let tries = 0; tries < 20; tries++) {
      const move = pick(cands);
      const res = ev.evaluateSlotMatchup(atk, move, defTrue, { applyMoveOwnStatChanges: false });
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
    if (inHp && inDef && inSpd && gridOk && groupOk) ok++;
    else fail(`왕복: 진짜 배분이 후보에서 빠짐 atk=${atkId} def=${defId} truth=${JSON.stringify(truth)} 결과 hp=${JSON.stringify(result.hp)} def=${JSON.stringify(result.def)} spd=${JSON.stringify(result.spd)} grid=${gridOk} group=${groupOk}`);
    sumRatio += result.feasible / result.total;
    if (result.feasible < result.total) narrowed++;
  }
  const done = trials - skipped;
  console.log(`왕복 ${ok}/${done} 통과 (건너뜀 ${skipped}) · 후보가 줄어든 경우 ${narrowed}건 · 평균 남은 비율 ${(done ? (sumRatio / done) * 100 : 0).toFixed(1)}%`);

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
