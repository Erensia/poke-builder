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
import { createHash } from "node:crypto";

const trials = Number(process.argv[2] ?? 150);
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
// 결합 결과 해시 — 속도 최적화 전후로 결과가 한 비트도 달라지지 않았는지 대조한다(3.6 I1-a)
const combinedDigest = createHash("sha1");
const digestResult = (c) => combinedDigest.update(JSON.stringify(c, (k, v) => (k === "rounds" || k === "converged" || k === "candidates" ? undefined : ArrayBuffer.isView(v) ? Array.from(v) : v)));
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

  const usable = data.MOVES.filter((m) => inf.inferenceUnsupportedReason(m) === null && !inf.multiHitRange(m) && m.power !== null && m.power > 0);
  const species = data.POKEMON.filter((p) => !p.formVariants && !p.sizeForms);
  const natureIds = data.NATURES.map((n) => n.id);

  const within = (r, v) => !!r && r.min <= v && v <= r.max;
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
      // 3.1 L1-b) 메가 전·후 나란히: 폼마다 그 폼의 종족값으로 환산한 진짜 실수치·내구 지수가 범위에 들어야 한다
      const fv = mixed?.formViews ?? [];
      const bulkPre = preReal.hp * preReal.def;
      const bulkPost = postReal.hp * postReal.def;
      if (
        fv.length !== 2 || fv[0].form !== "" || fv[1].form !== mega.form ||
        !within(fv[0].real.def, preReal.def) || !within(fv[1].real.def, postReal.def) ||
        !within(fv[1].real.hp, postReal.hp) || fv[0].real.spd !== undefined ||
        !within(fv[0].bulkPhysical?.support, bulkPre) || !within(fv[1].bulkPhysical?.support, bulkPost)
      ) fail(`메가 전·후 나란히(방어): 폼별 진짜 실수치가 범위에 없음 ${mega.form} truth=${JSON.stringify(truth)} 폼=${fv.map((v) => v.form).join("|")}`);
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
  const ai = await server.ssrLoadModule("/src/lib/attackInference.ts");
  const attackMoves = data.MOVES.filter((m) => ai.attackInferenceUnsupportedReason(m) === null && !inf.multiHitRange(m) && m.power !== null && m.power > 0);
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
  {
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
      // 3.1 L1-b) 메가 전·후 나란히: 폼별 종족값으로 환산한 진짜 공격 실수치가 범위에 있어야 한다
      const fv = mixed?.formViews ?? [];
      if (
        fv.length !== 2 || fv[1].form !== mega.form ||
        !within(fv[0].real.atk, stat.computeRealStats(poke.baseStats, pre.points, pre.nature).atk) ||
        !within(fv[1].real.atk, stat.computeRealStats(mega.baseStats, post.points, post.nature).atk)
      ) fail(`메가 전·후 나란히(공격): 폼별 진짜 실수치가 범위에 없음 ${mega.form} truth=${JSON.stringify(truth)}`);
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
    let maxRounds = 0;
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
      digestResult(c);
      maxRounds = Math.max(maxRounds, c.rounds);
      if (!c.converged) fail(`결합 되풀이가 수렴하지 않고 상한에서 끊김 opp=${opp.id}`);
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
    console.log(`방어·공격 결합 계산 시간: 평균 ${(sumMs / Math.max(1, cbTried)).toFixed(0)}ms · 최대 ${maxMs.toFixed(0)}ms · 되풀이 최대 ${maxRounds}번`);
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
    // 쓰러진 공격(3.6 I1-e): 데미지가 맞기 전 HP 이상이라는 부등식 — 가능한 쓰러짐은 ok, 풀피에서 한 방에 쓰러질 수 없는 조합은 모순, 다단히트는 invalid
    const faintFull = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: myMax, hpAfter: 0 }] });
    const faintMulti = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("더블어택"), critical: false, hpBefore: 30, hpAfter: 0, hits: 2 }] });
    if (faint?.status !== "ok") fail(`공격 역산: 쓰러진 관측이 ok가 아님(${faint?.status})`);
    if (faintFull?.status !== "contradiction") fail(`공격 역산: 풀피에서 한 방에 쓰러지는 관측이 ${faintFull?.status}`);
    if (faintMulti?.status !== "invalid" || !faintMulti.observationErrors[0]?.includes("쓰러진 다단히트")) fail("공격 역산: 쓰러진 다단히트가 invalid로 안 잡힘");
    if (badHp?.status !== "invalid" || !badHp.observationErrors[0]?.includes("최대 HP")) fail("공격 역산: 최대 HP 초과가 invalid로 안 잡힘");
    if (noMove?.status !== "invalid" || !noMove.observationErrors[0]?.includes("스피드")) fail("공격 역산: 스피드 위력 기술이 invalid로 안 잡힘");
    console.log(`공격 역산 예외: 모순 ${contradiction?.status} · 쓰러짐 ${faint?.status} · HP 초과 ${badHp?.status} · 자이로볼 ${noMove?.status}`);
    // 쓰러진 공격 왕복: 진짜 배분이 실제로 쓰러뜨릴 만한 데미지를 낼 때 "맞기 전 HP → 0"으로 넣어도 진짜 값이 후보에 남아야 한다
    {
      // 공용 난수열(rnd)을 쓰면 뒤 시나리오가 바뀌어 결합 결과 해시 대조가 깨지므로 이 블록은 따로 굴린다
      let koSeed = 777;
      const koRnd = () => {
        koSeed = (koSeed * 1664525 + 1013904223) >>> 0;
        return koSeed / 2 ** 32;
      };
      const koPick = (arr) => arr[Math.floor(koRnd() * arr.length)];
      let koTried = 0;
      let koOk = 0;
      for (let t = 0; t < 120; t++) {
        const opp = koPick(species);
        const truthKo = { atk: Math.floor(koRnd() * 33), spa: Math.floor(koRnd() * 33), nature: koPick(natureIds) };
        const oppTrue = slot(opp.id, { points: pts(truthKo), nature: truthKo.nature });
        const my = slot(koPick(species).id, { points: pts({ hp: Math.floor(koRnd() * 33), def: Math.floor(koRnd() * 33), spd: Math.floor(koRnd() * 33) }), nature: koPick(natureIds) });
        const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(my.pokemonId), my).baseStats, my.points, my.nature);
        const cat = koRnd() < 0.5 ? "physical" : "special";
        const move = koPick(attackMoves.filter((m) => m.category === cat));
        const res = ev.evaluateSlotMatchup(oppTrue, move, my, { defenderHpIsFull: true, skipVerdict: true });
        const parts = res?.damageParts;
        if (!parts || parts.typeEffectiveness === 0) continue;
        const damage = fm.integerTotalDamage(parts, res.defenseStat, (85 + Math.floor(koRnd() * 16)) / 100);
        const hpBefore = 1 + Math.floor(koRnd() * Math.min(damage, myReal.hp));
        const input = (hpAfter) => ({ attacker: slot(opp.id), defender: my, observations: [{ move, critical: false, hpBefore, hpAfter }] });
        const ko = ai.inferAttack(input(0));
        koTried++;
        const r = ko?.[cat === "physical" ? "atk" : "spa"];
        if (ko?.status === "ok" && within(r, truthKo[cat === "physical" ? "atk" : "spa"])) koOk++;
        else fail(`쓰러진 공격 왕복: 진짜 값이 빠짐 opp=${opp.id} ${move.id} hp ${hpBefore}→0 상태=${ko?.status}`);
      }
      if (koTried === 0) fail("쓰러진 공격 왕복 시행이 0건");
      console.log(`쓰러진 공격 왕복 ${koOk}/${koTried} 통과`);
    }
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

  // 3.1 C2-c) 스피드 역산 — 진짜 스피드 포인트·성격으로 선후공 관측을 만들어 넣으면 진짜 값이 후보에 남는지, 조건이 다른
  // 관측을 모을수록 좁아지는지, 트릭룸·순풍·스카프 가정·동속 처리.
  {
    const si = await server.ssrLoadModule("/src/lib/speedInference.ts");
    const neutral = si.NEUTRAL_SPEED_CONDITIONS;
    // 진짜 상대(oppTrue)와 나(mySlot)가 이 조건에서 실제로 어느 쪽이 먼저인지(동속이면 임의로 한쪽)
    const actualFirst = (oppTrue, mySlot, c, myStages) => {
      const res = ev.evaluateSpeedMatchup(
        { ...oppTrue, item: c.oppItemId, ability: c.oppAbilityId },
        mySlot,
        {
          attackerStatus: c.oppParalyzed ? "paralysis" : c.oppOtherStatus ? "burn" : null, defenderStatus: c.myParalyzed ? "paralysis" : c.myOtherStatus ? "burn" : null, attackerTailwind: c.oppTailwind, defenderTailwind: c.myTailwind,
          attackerUnburden: c.oppUnburden, trickRoom: c.trickRoom, attackerStages: { atk: 0, def: 0, spa: 0, spd: 0, spe: c.oppStage }, defenderStages: myStages,
        },
      );
      return res.firstMover === "tie" ? (rnd() < 0.5 ? "me" : "opponent") : res.firstMover === "attacker" ? "opponent" : "me";
    };
    const randomConditions = () => ({
      ...neutral,
      oppStage: Math.floor(rnd() * 7) - 3,
      myTailwind: rnd() < 0.3,
      oppTailwind: rnd() < 0.2,
      oppParalyzed: rnd() < 0.1,
      trickRoom: rnd() < 0.15,
    });
    const flatStages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    // 관측 k개로 역산해 진짜 값이 남는지 확인하고 실수치 범위 폭을 돌려준다(빠지면 실패 기록 후 null)
    const speedCase = (k, oppId, truth, oppTrue, mySlot) => {
      const observations = Array.from({ length: k }, () => {
        const conditions = randomConditions();
        return { first: actualFirst(oppTrue, mySlot, conditions, flatStages), conditions };
      });
      const r = si.inferSpeed({ attacker: slot(oppId), defender: mySlot, observations });
      const natName = data.NATURES.find((n) => n.id === truth.nature).name;
      const inRange = r?.status === "ok" && r.spe.min <= truth.spe && truth.spe <= r.spe.max;
      if (inRange && r.groups.some((g) => g.feasible > 0 && g.natureNames.includes(natName))) return r.realSpe.max - r.realSpe.min;
      fail(`스피드 역산 왕복: 진짜 값이 빠짐 opp=${oppId} truth=${JSON.stringify(truth)} 관측=${k} 상태=${r?.status}`);
      return null;
    };
    let speOk = 0;
    let speTried = 0;
    const widths = { 1: 0, 3: 0, 8: 0 };
    const counts = { 1: 0, 3: 0, 8: 0 };
    for (let t = 0; t < 150; t++) {
      const oppId = pick(species).id;
      const truth = { spe: Math.floor(rnd() * 33), nature: pick(natureIds) };
      const oppTrue = slot(oppId, { points: pts({ spe: truth.spe }), nature: truth.nature });
      const mySlot = slot(pick(species).id, { points: pts({ spe: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
      for (const k of [1, 3, 8]) {
        const r = speedCase(k, oppId, truth, oppTrue, mySlot);
        if (r === null) continue;
        widths[k] += r;
        counts[k]++;
        if (k === 1) speOk++;
      }
      speTried++;
    }
    console.log(
      `스피드 역산 왕복 ${speOk}/${speTried} 통과 · 관측 수별 실수치 범위 폭(평균): 1회 ${(widths[1] / counts[1]).toFixed(1)} · 3회 ${(widths[3] / counts[3]).toFixed(1)} · 8회 ${(widths[8] / counts[8]).toFixed(1)}`,
    );
    if (!(widths[3] / counts[3] < widths[1] / counts[1] && widths[8] / counts[8] < widths[3] / counts[3])) fail("스피드 역산: 관측이 늘어도 범위가 좁아지지 않음");

    // 손으로 확인하는 사례: 상대 한카리아스(기본 종족값 102), 나 망나뇽(종족값 80, 스피드 포인트 32 무보정) — 내 스피드 실수치 132
    const me = slot("망나뇽", { points: pts({ spe: 32 }), nature: null });
    const base = { attacker: slot("한카리아스"), defender: me };
    const faster = si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: neutral }] });
    const slower = si.inferSpeed({ ...base, observations: [{ first: "me", conditions: neutral }] });
    // 상대가 먼저 → 상대 스피드 ≥ 132: 한카리아스 실수치 = (102+20+p)×성격. 무보정이면 p ≥ 10이지만 스피드↑(×1.1)이면 p=0도 134라 가능 → 0~32
    if (faster?.status !== "ok" || faster.spe.min > 10 || faster.spe.max !== 32) fail(`스피드 역산 사례: 상대가 먼저 ${JSON.stringify(faster?.spe)}`);
    // 내가 먼저 → 상대 스피드 ≤ 132: 무보정 p ≤ 10, 스피드↓(×0.9)면 p ≤ 24까지(25는 (122+25)×0.9=132.3→132) → 0~25
    if (slower?.status !== "ok" || slower.spe.min !== 0) fail(`스피드 역산 사례: 내가 먼저 ${JSON.stringify(slower?.spe)}`);
    // 트릭룸이면 방향이 반대 — 트릭룸에서 상대가 먼저면 상대가 더 느리다
    const trickFirst = si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: { ...neutral, trickRoom: true } }] });
    if (trickFirst?.status !== "ok" || trickFirst.spe.min !== 0 || trickFirst.spe.max >= 32) fail(`스피드 역산 사례: 트릭룸 ${JSON.stringify(trickFirst?.spe)}`);
    // 서로 모순인 관측(같은 조건에서 둘 다 먼저)은 모순이어야 한다
    const both = si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: neutral }, { first: "me", conditions: neutral }] });
    if (both?.status !== "ok" && both?.status !== "contradiction") fail("스피드 역산: 동속 처리 이상");
    const bad = si.inferSpeed({ ...base, observations: [{ first: "me", conditions: { ...neutral, oppStage: 9 } }] });
    if (bad?.status !== "invalid" || !bad.observationErrors[0]?.includes("랭크")) fail("스피드 역산: 잘못된 랭크가 invalid로 안 잡힘");
    console.log(`스피드 역산 사례: 상대가 먼저 → 포인트 ${faster.spe.min}~${faster.spe.max} · 내가 먼저 → ${slower.spe.min}~${slower.spe.max} · 트릭룸 → ${trickFirst.spe.min}~${trickFirst.spe.max}`);

    // 3.2 V1) 속보: 상태이상이면 스피드 ×1.5(마비 반감 무시). 속보가 아니면 마비만 ×0.5, 화상은 영향 없음
    {
      const spd = (ability, status) =>
        ev.evaluateSpeedMatchup(slot("쥬피썬더", { points: pts({ spe: 32 }), ability }), slot("망나뇽"), { attackerStatus: status }).attackerSpeed;
      const plain = spd(null, null);
      if (spd(null, "burn") !== plain || spd(null, "paralysis") !== Math.floor(plain * 0.5)) fail("선후공: 속보 아닐 때 상태이상 스피드 배율 이상");
      if (spd("속보", null) !== plain || spd("속보", "burn") !== Math.floor(plain * 1.5) || spd("속보", "paralysis") !== spd("속보", "burn")) fail("선후공: 속보 ×1.5 이상");
      // 역산: 내 쥬피썬더(스피드 182)를 상대(쥬피썬더)가 앞질렀다 — 속보 + 상태이상이면 ×1.5라 더 적은 포인트로도 가능하다
      const jolt = { attacker: slot("쥬피썬더"), defender: slot("쥬피썬더", { points: pts({ spe: 32 }) }) };
      const cond = { ...neutral, oppAbilityId: "속보" };
      const calm = si.inferSpeed({ ...jolt, observations: [{ first: "opponent", conditions: cond }] });
      const statused = si.inferSpeed({ ...jolt, observations: [{ first: "opponent", conditions: { ...cond, oppOtherStatus: true } }] });
      if (calm?.status !== "ok" || statused?.status !== "ok" || statused.spe.min >= calm.spe.min) fail(`스피드 역산: 속보 상태이상이 하한을 낮추지 못함 ${JSON.stringify([calm?.spe, statused?.spe])}`);
      else console.log(`속보 선후공: 스피드 ${plain} → 상태이상 ${spd("속보", "burn")} · 역산 "상대가 먼저" 포인트 하한 ${calm.spe.min} → ${statused.spe.min}`);
    }

    // 3.1 L1-b) 메가 전→후 스피드: 같은 포인트·성격으로 메가 전·후 선후공을 만들면 진짜 값이 남고, 폼별 실수치 범위에 폼별 진짜 실수치가 들어간다.
    // 태그가 없어도 다른 쪽이 알려 준 메가폼(viewMegaForms)이 있으면 나란히 만든다.
    {
      const megaSpecies = species.filter((p) => p.megaEvolutions?.length);
      let tried = 0;
      for (let t = 0; t < 60; t++) {
        const poke = pick(megaSpecies);
        const mega = pick(poke.megaEvolutions);
        const truth = { spe: Math.floor(rnd() * 33), nature: pick(natureIds) };
        const pre = slot(poke.id, { points: pts({ spe: truth.spe }), nature: truth.nature });
        const post = slot(poke.id, { points: pts({ spe: truth.spe }), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
        const mySlot = slot(pick(species).id, { points: pts({ spe: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
        const observations = [];
        for (let k = 0; k < 6; k++) {
          const conditions = randomConditions();
          const isPost = k >= 3;
          observations.push({ first: actualFirst(isPost ? post : pre, mySlot, conditions, flatStages), conditions, ...(isPost ? { megaForm: mega.form } : {}) });
        }
        const r = si.inferSpeed({ attacker: slot(poke.id), defender: mySlot, observations });
        const preSpe = stat.computeRealStats(poke.baseStats, pre.points, pre.nature).spe;
        const postSpe = stat.computeRealStats(mega.baseStats, post.points, post.nature).spe;
        tried++;
        if (r?.status !== "ok" || !within(r.spe, truth.spe)) fail(`스피드 메가 전→후: 진짜 값이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${r?.status}`);
        else if (r.formViews.length !== 2 || !within(r.formViews[0].real.spe, preSpe) || !within(r.formViews[1].real.spe, postSpe)) fail(`메가 전·후 나란히(스피드): 폼별 진짜 실수치가 범위에 없음 ${mega.form} truth=${JSON.stringify(truth)}`);
        const untagged = si.inferSpeed({ attacker: slot(poke.id), defender: mySlot, observations: observations.slice(0, 3), viewMegaForms: [mega.form] });
        if (untagged?.formViews.length !== 2) fail("viewMegaForms가 있는데 폼별 표시가 안 만들어짐");
        const plain = si.inferSpeed({ attacker: slot(poke.id), defender: mySlot, observations: observations.slice(0, 3) });
        if (plain?.formViews.length !== 0) fail("메가 태그가 없는데 폼별 표시가 만들어짐");
      }
      console.log(`스피드 메가 전→후·폼별 표시 ${tried}건 통과`);
    }

    // 셸암즈는 물리/특수가 능력치로 정해져 방어·공격 역산 모두 지원하지 않는다(과거: 공격 역산에서 진짜 값이 빠졌음)
    const shell = data.getMove("셸암즈");
    if (!inf.inferenceUnsupportedReason(shell) || !ai.attackInferenceUnsupportedReason(shell)) fail("셸암즈가 역산 미지원으로 안 잡힘");

    // 3.1 PR5-b) 성격 후보가 줄수록 스피드 하한이 올라간다 — 상대가 먼저(내 132 추월): 스피드↑ 0 / 무보정 10 / 스피드↓ 25
    const idsByMult = (want) => data.NATURES.filter((n) => inf.natureMult("spe", n.increased, n.decreased) === want).map((n) => n.id);
    const minFor = (ids) => si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: neutral }], natureIds: ids })?.spe?.min;
    const mins = [minFor(idsByMult(1.1)), minFor(idsByMult(1)), minFor(idsByMult(0.9))];
    if (mins.join() !== "0,10,25") fail(`스피드 하한이 성격 후보별로 다름: ${mins.join()} (기대 0,10,25)`);

    // 다단히트 왕복(3.3 V4) — 타마다 독립 난수로 만든 총 데미지를 관측으로 넣어도 진짜 배분이 남는다(방어·공격 둘 다)
    {
      const multi = data.MOVES.filter((m) => inf.multiHitRange(m) && ai.attackInferenceUnsupportedReason(m) === null);
      // 엔진처럼 타마다 난수를 따로 굴린 총 데미지
      const rollTotal = (parts, defStat) =>
        parts.hitPowers.reduce((sum, power, i) => sum + fm.integerHitDamage(parts, power, defStat, (85 + Math.floor(rnd() * 16)) / 100, i === 0, parts.firstHitFinalMultiplier ?? 1), 0);
      const counts = { triedDef: 0, okDef: 0, okAtk: 0, noHits: 0, maxMs: 0 };
      // 방어 역산: 내가 입힌 다단히트의 %
      const checkDealt = (c) => {
        const res = ev.evaluateSlotMatchup(c.mySlot, c.move, c.oppTrue, { multiHitCount: c.hits, skipVerdict: true });
        if (!res?.damageParts || res.damageParts.typeEffectiveness === 0) return;
        const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(c.opp.id), c.oppTrue).baseStats, c.oppTrue.points, c.oppTrue.nature);
        const dmg = rollTotal(res.damageParts, res.defenseStat);
        if (dmg >= oppReal.hp) return;
        counts.triedDef++;
        const t0 = performance.now();
        const obs = { move: c.move, critical: false, before: 100, after: inf.displayPercent(oppReal.hp - dmg, oppReal.hp), hits: c.hits };
        const r = inf.inferDefense({ attacker: c.mySlot, defender: slot(c.opp.id), observations: [obs] }, false);
        counts.maxMs = Math.max(counts.maxMs, performance.now() - t0);
        const defKey = res.damageParts.defenseKey;
        if (r.status === "ok" && within(r.hp, c.truth.hp) && within(r[defKey], c.truth[defKey])) counts.okDef++;
        else fail(`다단히트 방어 역산 왕복에서 진짜 배분이 빠짐: ${c.move.id} ${c.hits}타 opp=${c.opp.id} truth=${JSON.stringify(c.truth)} status=${r.status}`);
        if (c.range.min === c.range.max) return;
        const none = inf.inferDefense({ attacker: c.mySlot, defender: slot(c.opp.id), observations: [{ ...obs, hits: undefined }] }, false);
        if (none.observationErrors[0] === null) fail(`타수 없는 다단히트가 오류가 아님: ${c.move.id}`);
        else counts.noHits++;
      };
      // 공격 역산: 상대가 쓴 다단히트로 내가 입은 정확한 데미지
      const checkReceived = (c) => {
        const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(c.mySlot.pokemonId), c.mySlot).baseStats, c.mySlot.points, c.mySlot.nature);
        const res = ev.evaluateSlotMatchup(c.oppTrue, c.move, c.mySlot, { multiHitCount: c.hits, defenderHpIsFull: true, skipVerdict: true });
        if (!res?.damageParts || res.damageParts.typeEffectiveness === 0) return;
        const dmg = rollTotal(res.damageParts, res.defenseStat);
        if (dmg >= myReal.hp) return;
        const obs = { move: c.move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - dmg, hits: c.hits };
        const r = ai.inferAttack({ attacker: slot(c.opp.id), defender: c.mySlot, observations: [obs] }, false);
        const key = c.move.category === "special" ? "spa" : "atk";
        if (r.status === "ok" && within(r[key], c.truth[key])) counts.okAtk++;
        else fail(`다단히트 공격 역산 왕복에서 진짜 값이 빠짐: ${c.move.id} ${c.hits}타 opp=${c.opp.id} truth=${JSON.stringify(c.truth)} status=${r.status}`);
      };
      for (let t = 0; t < 120; t++) {
        const move = pick(multi);
        const range = inf.multiHitRange(move);
        const opp = pick(species);
        const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33), nature: pick(natureIds) };
        const c = {
          move,
          range,
          hits: range.min + Math.floor(rnd() * (range.max - range.min + 1)),
          opp,
          truth,
          oppTrue: slot(opp.id, { points: pts(truth), nature: truth.nature }),
          mySlot: slot(pick(species).id, { points: pts({ hp: 32, atk: 32, spa: 32, spe: 10, def: 10, spd: 10 }), nature: pick(natureIds) }),
        };
        checkDealt(c);
        checkReceived(c);
      }
      console.log(`다단히트 왕복 방어 ${counts.okDef}/${counts.triedDef} · 공격 ${counts.okAtk}건 통과 · 타수 누락 오류 ${counts.noHits}건 · 방어 계산 최대 ${counts.maxMs.toFixed(0)}ms`);
      if (counts.triedDef === 0) fail("다단히트 왕복 시행이 0건");
    }

    // 방어·공격·스피드 세 쪽 결합 왕복 — 세 종류 관측을 진짜 배분으로 만들어 합쳐도 진짜 값이 남고, 각각보다 후보가 늘지 않는다
    const cb3 = await server.ssrLoadModule("/src/lib/combinedInference.ts");
    let tried3 = 0;
    let ok3 = 0;
    let speNarrowed = 0;
    let floorUsed = 0;
    let maxMs3 = 0;
    let maxRounds3 = 0;
    for (let t = 0; t < 300; t++) {
      const v = () => Math.floor(rnd() * (rnd() < 0.5 ? 33 : 11));
      const opp = pick(species);
      const truth = { hp: v(), def: v(), spd: v(), atk: v(), spa: v(), spe: v(), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd + truth.atk + truth.spa + truth.spe > 66) continue;
      // 합계 66은 항상 다 쓴다(사용자 결정, 3.3 V5 포인트 하한) — 모자란 만큼 32 미만인 스탯에 무작위로 채운다
      for (let left = 66 - (truth.hp + truth.def + truth.spd + truth.atk + truth.spa + truth.spe); left > 0; ) {
        const k = pick(["hp", "def", "spd", "atk", "spa", "spe"]);
        if (truth[k] < 32) {
          truth[k]++;
          left--;
        }
      }
      const oppTrue = slot(opp.id, { points: pts(truth), nature: truth.nature });
      const mySlot = slot(pick(species).id, { points: pts({ hp: 32, atk: 32, spa: 32, spe: Math.floor(rnd() * 33), def: Math.floor(rnd() * 20), spd: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot).baseStats, mySlot.points, mySlot.nature);
      const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(opp.id), oppTrue).baseStats, oppTrue.points, oppTrue.nature);
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
      const speedObs = Array.from({ length: 4 }, () => {
        const conditions = randomConditions();
        return { first: actualFirst(oppTrue, mySlot, conditions, flatStages), conditions };
      });
      tried3++;
      const defenseInput = { attacker: mySlot, defender: slot(opp.id), observations: dealt };
      const attackInput = { attacker: slot(opp.id), defender: mySlot, observations: received };
      const speedInput = { attacker: slot(opp.id), defender: mySlot, observations: speedObs };
      const s0 = si.inferSpeed(speedInput);
      const t0 = performance.now();
      const c = cb3.inferCombined(defenseInput, attackInput, speedInput);
      maxMs3 = Math.max(maxMs3, performance.now() - t0);
      digestResult(c);
      maxRounds3 = Math.max(maxRounds3, c.rounds);
      if (!c.converged) fail(`3쪽 결합 되풀이가 수렴하지 않고 상한에서 끊김 opp=${opp.id}`);
      const inR = (r, v) => !r || (r.min <= v && v <= r.max);
      const natName = data.NATURES.find((x) => x.id === truth.nature).name;
      const good =
        c.conflict === null && c.parts.length === 3 &&
        inR(c.defense.hp, truth.hp) && inR(c.defense.def, truth.def) && inR(c.defense.spd, truth.spd) &&
        inR(c.attack.atk, truth.atk) && inR(c.attack.spa, truth.spa) && inR(c.speed.spe, truth.spe) &&
        c.natures?.some((n) => n.name === natName) && c.speed.feasible <= s0.feasible;
      if (c.budget && (c.budget.defenseMin > 0 || c.budget.attackMin > 0 || c.budget.speedMin > 0)) floorUsed++;
      if (good) {
        ok3++;
        if (c.speed.feasible < s0.feasible) speNarrowed++;
      } else fail(`3쪽 결합 왕복: 진짜 배분이 빠지거나 후보가 늘었음 opp=${opp.id} truth=${JSON.stringify(truth)} 충돌=${c.conflict}`);
      // 방어+스피드·공격+스피드 두 쪽 결합도 같은 규칙 — 한쪽만 있으면 결합 없이 그대로
      const cd = cb3.inferCombined(defenseInput, null, speedInput);
      const ca = cb3.inferCombined(null, attackInput, speedInput);
      const one = cb3.inferCombined(null, null, speedInput);
      if (cd.conflict !== null || ca.conflict !== null || !inR(cd.speed.spe, truth.spe) || !inR(ca.speed.spe, truth.spe)) fail(`2쪽 결합(스피드)에서 진짜 값이 빠짐 opp=${opp.id}`);
      if (one.natures !== null || one.budget !== null || one.parts.join() !== "speed") fail("스피드 한쪽만 있을 때 결합이 일어남");
    }
    console.log(`방어·공격·스피드 결합 왕복 ${ok3}/${tried3} 통과 · 스피드 후보가 줄어든 사례 ${speNarrowed}건 · 포인트 하한이 걸린 사례 ${floorUsed}건 · 최대 ${maxMs3.toFixed(0)}ms · 되풀이 최대 ${maxRounds3}번`);
    if (tried3 === 0) fail("3쪽 결합 왕복 시행이 0건");
    if (maxMs3 > 5000) fail(`3쪽 결합이 너무 느림(${maxMs3.toFixed(0)}ms)`);
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

  // 4) 3.2 V2 저장 복원 — 깨진 저장본은 기본값, 사라진 id는 비우고, 정상 저장본은 그대로 돌아온다
  {
    const { restoreInference } = await server.ssrLoadModule("/src/lib/inferenceDraft.ts");
    for (const bad of [undefined, null, 5, "x", [], { rows: "x" }, { rows: [null, 3, { kind: "zzz" }] }]) {
      const r = restoreInference(bad);
      if (r.rows.length !== 1 || r.rows[0].kind !== "dealt" || r.rows[0].before !== "100" || r.defStage !== 0 || r.screen !== "") fail(`깨진 저장본이 기본값이 아님: ${JSON.stringify(bad)}`);
    }
    const good = {
      rows: [
        { id: 7, kind: "received", moveId: "지진", critical: true, before: "150", after: "90", megaForm: "", first: "me", cond: {} },
        { id: 9, kind: "speed", moveId: null, critical: false, before: "", after: "", megaForm: "", first: "opponent", cond: { trickRoom: true, oppStage: 2, oppItemId: "구애스카프", oppAbilityId: "없는특성" } },
      ],
      abilityId: "없는특성", itemId: "구애스카프", screen: "reflect", defStage: -2, spdStage: 99, tolerant: true,
      atkAbilityId: "", atkItemId: "", atkStage: 1, spaStage: 0, oppBurned: true, myScreen: "bogus",
    };
    const r = restoreInference(JSON.parse(JSON.stringify(good)));
    const ok =
      r.rows.length === 2 && r.rows[0].id === 1 && r.rows[1].id === 2 && r.rows[0].moveId === "지진" && r.rows[0].critical && r.rows[0].after === "90" &&
      r.rows[1].first === "opponent" && r.rows[1].cond.trickRoom === true && r.rows[1].cond.oppStage === 2 && r.rows[1].cond.oppItemId === "구애스카프" && r.rows[1].cond.oppAbilityId === null &&
      r.abilityId === "" && r.itemId === "구애스카프" && r.screen === "reflect" && r.defStage === -2 && r.spdStage === 0 && r.tolerant && r.atkStage === 1 && r.oppBurned && r.myScreen === "";
    if (!ok) fail(`저장 복원 결과가 기대와 다름: ${JSON.stringify(r)}`);
    console.log("저장 복원(깨진 입력 7종·정상 1종)", failed === 0 ? "통과" : "실패");
  }
  // 5) 3.4 T1 스피드 표 — 식이 computeRealStats와 같다
  {
    const st = await server.ssrLoadModule("/src/lib/speedTable.ts");
    const before = failed;
    const names = st.SPEED_FORMS.map((f) => f.name);
    if (new Set(names).size !== names.length) fail("스피드 표 폼 이름이 중복됨");
    if (!names.includes("리자몽-메가X")) fail("메가폼이 스피드 표에 없음");
    // 식 대조: 보정 없음/↑/↓ 성격 + 포인트 전 구간
    const natureOf = (mult) => data.NATURES.find((n) => (mult === 1 ? !n.increased : mult > 1 ? n.increased === "spe" : n.decreased === "spe"))?.id ?? null;
    const combos = st.SPEED_FORMS.flatMap((f) => [1, 1.1, 0.9].flatMap((mult) => Array.from({ length: 33 }, (_, p) => ({ f, mult, p }))));
    for (const { f, mult, p } of combos) {
      const real = stat.computeRealStats({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: f.baseSpe }, pts({ spe: p }), natureOf(mult)).spe;
      if (st.speedValue(f.baseSpe, mult, p) !== real) fail(`스피드 식 불일치 ${f.name} ×${mult} ${p}pt: ${st.speedValue(f.baseSpe, mult, p)} vs ${real}`);
    }
    const formulaChecked = combos.length;
    console.log(`스피드 표(폼 ${st.SPEED_FORMS.length}개, 식 ${formulaChecked}건)`, failed === before ? "통과" : "실패");
  }
  // 5-b) 3.6 T2 스피드 표 단계 — 단계 값이 computeRealStats와 같고, 추월 분류·최소 포인트·포인트 지점이 전수 대조와 같다
  {
    const st = await server.ssrLoadModule("/src/lib/speedTable.ts");
    const before = failed;
    const natureOf = (label) => data.NATURES.find((n) => (label === "보정 없음" ? !n.increased && !n.decreased : label === "스피드↑" ? n.increased === "spe" : n.decreased === "spe"))?.id ?? null;
    const key = (r) => `${r.name}|${r.nature}|${r.points}`;
    const rowsOf = (t) => st.SPEED_FORMS.map((f) => st.tierRow(f, t));
    if (st.SPEED_TIERS.map((t) => t.label).join() !== "최속,준속,무투자,최저속") fail("스피드 단계 구성이 다름");
    for (const t of st.SPEED_TIERS) {
      for (const r of rowsOf(t)) {
        const real = stat.computeRealStats({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: r.form.baseSpe }, pts({ spe: t.points }), natureOf(r.nature)).spe;
        if (r.value !== real || r.points !== t.points) fail(`단계 값 불일치 ${t.label} ${r.name}: ${r.value} vs ${real}`);
      }
    }
    // 추월·동속·못 추월 분류와 정렬(가까운 순)
    const speeds = [1, 60, 100, 135, 150, 172, 200, 400, ...Array.from({ length: 12 }, () => 40 + Math.floor(rnd() * 220))];
    for (const speed of speeds) {
      st.speedOutlook(speed).forEach((o, i) => {
        const all = rowsOf(st.SPEED_TIERS[i]);
        const names = (rows) => rows.map(key).sort().join();
        if (names(o.fail) !== names(all.filter((r) => r.value > speed)) || names(o.tie) !== names(all.filter((r) => r.value === speed)) || names(o.pass) !== names(all.filter((r) => r.value < speed))) fail(`추월 분류 불일치 ${o.tier.label} @${speed}`);
        if (o.fail.some((r, k) => k && r.value < o.fail[k - 1].value) || o.pass.some((r, k) => k && r.value > o.pass[k - 1].value)) fail(`추월 목록이 가까운 순이 아님 ${o.tier.label} @${speed}`);
      });
    }
    // 최소 포인트·포인트 지점: 임의 종족값·성격 배율의 스피드 곡선(포인트 0~32)으로 대조
    for (const [base, mult] of [[100, 1], [60, 1.1], [135, 0.9], [38, 1.1], [150, 1]]) {
      const speedAt = Array.from({ length: 33 }, (_, p) => st.speedValue(base, mult, p));
      for (const r of st.SPEED_TIERS.flatMap(rowsOf)) {
        const need = st.minPointsToPass(speedAt, r.value);
        const brute = speedAt.findIndex((v) => v > r.value);
        if (need !== (brute < 0 ? null : brute) || (need !== null && (speedAt[need] <= r.value || (need > 0 && speedAt[need - 1] > r.value)))) fail(`최소 포인트 불일치 base${base}×${mult} ${r.nature}${r.points}pt ${r.name}: ${need}`);
      }
      const keep = 17;
      const bps = st.speedBreakpoints(speedAt, keep);
      const byP = new Map(bps.map((b) => [b.points, b]));
      if (!byP.has(0) || !byP.has(keep)) fail(`지점에 0pt·현재 포인트가 없음 base${base}×${mult}`);
      for (let p = 1; p <= 32; p++) {
        const brute = st.SPEED_TIERS.map((t) => rowsOf(t).filter((r) => r.value >= speedAt[p - 1] && r.value < speedAt[p]).map(key).sort().join());
        const got = byP.get(p)?.gains.map((g) => g.map(key).sort().join()) ?? brute.map(() => "");
        if (brute.some((b, i) => b !== got[i]) || (!byP.has(p) && brute.some(Boolean))) fail(`포인트 지점 불일치 base${base}×${mult} ${p}pt`);
      }
    }
    console.log(`스피드 단계(폼 ${st.SPEED_FORMS.length}개 × 4단계, 기준 ${speeds.length}개, 곡선 5개)`, failed === before ? "통과" : "실패");
  }
  // 5-c) 3.6 I2 후보 카드 — 정렬·남은 SP·최소 투자 후보·데미지 범위가 결과와 맞는다(공용 난수열을 건드리지 않게 별도 난수)
  {
    const before = failed;
    let cs = 4242;
    const cr = () => {
      cs = (cs * 1664525 + 1013904223) >>> 0;
      return cs / 2 ** 32;
    };
    const cp = (arr) => arr[Math.floor(cr() * arr.length)];
    const eps = 1e-9;
    const checkLists = (lists, sums, label, observed) => {
      if (!lists) {
        fail(`${label}: 후보 카드가 없음`);
        return false;
      }
      for (const [name, cards] of [["남은 SP 순", lists.bySpare], ["가능도 순", lists.byLikelihood], ["범위 중앙 순", lists.byCenter]]) {
        if (cards.length === 0 || cards.length > 60) fail(`${label} ${name}: 카드 수 ${cards.length}`);
        for (const card of cards) {
          const sum = card.points.reduce((a, pt) => a + pt.value, 0);
          if (card.spare !== 66 - sum || card.spare < 0) fail(`${label} ${name}: 남은 SP가 66 − 합계와 다름`);
          if (!(card.likelihood > 0 && card.likelihood <= 1 + eps)) fail(`${label} ${name}: 가능도 ${card.likelihood}`);
          if (card.damagePercent.some((r) => !(r.min <= r.max))) fail(`${label} ${name}: 데미지 범위가 뒤집힘`);
          if (card.rollMatch === null || card.rollMatch < 1 - eps || card.rollMatch > 16 + eps) fail(`${label} ${name}: 일치 난수 ${card.rollMatch}`);
        }
      }
      if (lists.bySpare.some((card, i) => i > 0 && card.spare > lists.bySpare[i - 1].spare)) fail(`${label}: 남은 SP 순 정렬이 아님`);
      if (lists.byLikelihood.some((card, i) => i > 0 && card.likelihood > lists.byLikelihood[i - 1].likelihood + eps)) fail(`${label}: 가능도 순 정렬이 아님`);
      if (lists.byCenter.some((card, i) => i > 0 && card.centerGap < lists.byCenter[i - 1].centerGap - eps)) fail(`${label}: 범위 중앙 순 정렬이 아님`);
      // 관측이 하나라 카드의 차이 값은 그 카드 자신의 데미지 범위 중앙과 관측값의 차이와 같아야 하고, 중앙 순 맨 앞은 어느 목록에서도 이보다 작은 카드가 없어야 한다
      for (const card of [...lists.bySpare, ...lists.byLikelihood, ...lists.byCenter]) {
        const own = Math.abs((card.damagePercent[0].min + card.damagePercent[0].max) / 2 - observed);
        if (Math.abs(card.centerGap - own) > 1e-6) fail(`${label}: 범위 중앙 차이 값이 카드 범위와 다름 ${card.centerGap} vs ${own}`);
      }
      const minOther = Math.min(...[...lists.bySpare, ...lists.byLikelihood].map((card) => card.centerGap));
      if (lists.byCenter[0].centerGap > minOther + eps) fail(`${label}: 범위 중앙 순 맨 앞보다 더 중앙에 가까운 카드가 있음`);
      if (lists.bySpare[0].spare !== 66 - sums.min) fail(`${label}: 남은 SP가 가장 많은 카드가 최소 투자 합과 다름`);
      return true;
    };
    // 방어 쪽: 풀피 상대에게 한 방. 시나리오가 성립해 검사했으면 true
    const checkDefense = (mine, opp, oppTrue, oppReal) => {
      const move = cp(usable);
      const res = ev.evaluateSlotMatchup(mine, move, oppTrue);
      const parts = res?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) return false;
      const damage = fm.integerTotalDamage(parts, oppReal[parts.defenseKey], (85 + Math.floor(cr() * 16)) / 100);
      if (damage >= oppReal.hp) return false;
      const after = inf.displayPercent(oppReal.hp - damage, oppReal.hp);
      const r = inf.inferDefense({ attacker: mine, defender: slot(opp.id), observations: [{ move, critical: false, before: 100, after }] });
      if (r?.status !== "ok") {
        fail(`방어 후보 카드 시나리오가 ok가 아님(${r?.status})`);
        return false;
      }
      // 표시 손실 %는 (lost−1, lost] 안의 난수가 만든다 — 모든 카드의 범위가 이 구간과 겹쳐야 한다
      const lost = 100 - after;
      if (!checkLists(r.candidates, r.sums, "방어 후보 카드", lost)) return false;
      const bad = [...r.candidates.bySpare, ...r.candidates.byLikelihood].filter((card) => card.damagePercent[0].min > lost + eps || card.damagePercent[0].max <= lost - 1 - eps);
      if (bad.length > 0) fail(`방어 후보 카드의 데미지 범위가 관측과 안 맞음 ${bad.length}장 (손실 ${lost}%)`);
      return true;
    };
    // 공격 쪽: 상대가 풀피인 나를 한 방에 쓰러뜨리지 않는 공격
    const checkAttack = (mine, opp, oppTrue, myReal) => {
      const move = cp(attackMoves);
      const res = ev.evaluateSlotMatchup(oppTrue, move, mine, { defenderHpIsFull: true, skipVerdict: true });
      const parts = res?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) return false;
      const damage = fm.integerTotalDamage(parts, res.defenseStat, (85 + Math.floor(cr() * 16)) / 100);
      if (damage >= myReal.hp) return false;
      const r = ai.inferAttack({ attacker: slot(opp.id), defender: mine, observations: [{ move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - damage }] });
      if (r?.status !== "ok") {
        fail(`공격 후보 카드 시나리오가 ok가 아님(${r?.status})`);
        return false;
      }
      const percent = (damage * 100) / myReal.hp;
      if (!checkLists(r.candidates, r.sums, "공격 후보 카드", percent)) return false;
      const bad = [...r.candidates.bySpare, ...r.candidates.byLikelihood].filter((card) => card.damagePercent[0].min > percent + eps || card.damagePercent[0].max < percent - eps);
      if (bad.length > 0) fail(`공격 후보 카드의 데미지 범위에 관측이 없음 ${bad.length}장 (${percent.toFixed(1)}%)`);
      return true;
    };
    let defChecked = 0;
    let atkChecked = 0;
    for (let t = 0; t < 40; t++) {
      const opp = cp(species);
      const truth = { hp: Math.floor(cr() * 33), def: Math.floor(cr() * 33), spd: Math.floor(cr() * 33), nature: cp(natureIds) };
      const oppTrue = slot(opp.id, { points: pts(truth), nature: truth.nature });
      const mine = slot(cp(species).id, { points: pts({ atk: 32, spa: 32, hp: Math.floor(cr() * 33) }), nature: cp(natureIds) });
      const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(opp.id), oppTrue).baseStats, oppTrue.points, oppTrue.nature);
      const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mine.pokemonId), mine).baseStats, mine.points, mine.nature);
      if (checkDefense(mine, opp, oppTrue, oppReal)) defChecked++;
      if (checkAttack(mine, opp, oppTrue, myReal)) atkChecked++;
    }
    if (defChecked === 0 || atkChecked === 0) fail(`후보 카드 검증 시행이 부족함(방어 ${defChecked}·공격 ${atkChecked})`);
    console.log(`후보 카드(방어 ${defChecked}건·공격 ${atkChecked}건: 세 정렬·남은 SP·최소 투자·데미지 범위·범위 중앙)`, failed === before ? "통과" : "실패");
  }
  // 6) 3.4 H1 HP 최적 수치 눈금 — 사용자 표의 예시와 전 종족값 전수 대조
  {
    const hm = await server.ssrLoadModule("/src/lib/hpMagic.ts");
    const before = failed;
    const bases = [...new Set(data.POKEMON.map((p) => p.baseStats.hp))];
    const checkBase = (base) => {
      const marks = hm.hpMarks(base, 32);
      const byP = new Map(marks.map((m) => [m.points, m]));
      for (let p = 0; p <= 32; p++) {
        const hp = stat.computeRealStats({ hp: base, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, pts({ hp: p }), null).hp;
        const chain = [16, 8, 4, 2].filter((d) => hp % d === d - 1).length;
        const orb = hp % 10 === 9;
        const m = byP.get(p);
        const got = m ? [m.hp, m.chain.length, m.orb] : [hp, 0, false];
        if (JSON.stringify(got) !== JSON.stringify([hp, chain, orb])) fail(`HP 눈금 불일치 base ${base} ${p}pt: ${got} vs ${[hp, chain, orb]}`);
        if ((chain > 0 || orb) !== !!m) fail(`HP 눈금 유무 불일치 base ${base} ${p}pt`);
      }
    };
    bases.forEach(checkBase);
    // 사용자 표: 종족값 100 → 16n+15는 0·16·32포인트(175·191·207), 10n+9는 4·14·24포인트(179·189·199)
    const m100 = hm.hpMarks(100, 32);
    const at = (p) => m100.find((m) => m.points === p);
    for (const p of [0, 16, 32]) if (at(p)?.chain.length !== 4) fail(`종족값 100 ${p}포인트가 16n+15가 아님`);
    for (const p of [4, 14, 24]) if (!at(p)?.orb) fail(`종족값 100 ${p}포인트가 10n+9가 아님`);
    if (m100.some((m) => m.orb && m.chain.length === 4)) fail("종족값 100은 16n+15와 10n+9가 겹치면 안 됨");
    // 80의 배수−1(159·239)은 둘이 겹침: 종족값 84·0포인트, 종족값 132·32포인트
    for (const [base, p] of [[84, 0], [132, 32]]) {
      const m = hm.hpMarks(base, 32).find((x) => x.points === p);
      if (!m || m.chain.length !== 4 || !m.orb) fail(`종족값 ${base} ${p}포인트가 16n+15 + 10n+9가 아님`);
    }
    const info = hm.hpMarkInfo(at(16), new Set(["16n+15"]));
    if (info.header !== "HP 191 (16포인트)" || info.rows.length !== 4 || !info.rows[0].relevant || info.rows.slice(1).some((r) => r.relevant)) fail("HP 눈금 설명 형식이 다름");
    const rel = (item, moves) => [...hm.relevantHpRules(item, moves)].sort().join();
    if (rel("먹다남은음식") !== "16n+15" || rel("자뭉열매") !== "4n+3" || rel(null, [null, "대타출동"]) !== "4n+3" || rel("생명의구슬") !== "10n+9" || rel("구애스카프", ["지진"]) !== "") fail("슬롯 도구·기술 강조 대상이 다름");
    console.log(`HP 최적 수치 눈금(종족값 ${bases.length}종·33포인트 전수 + 표 예시)`, failed === before ? "통과" : "실패");
  }
} finally {
  await server.close();
}
console.log(`결합 결과 해시 ${combinedDigest.digest("hex").slice(0, 16)}`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
