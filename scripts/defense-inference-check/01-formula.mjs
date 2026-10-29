// 정수 데미지 공식 대조
export default async function ({ data, ev, bp, stat, form, fm, rnd, pick, pts, usable, species, natureIds, slot, fail }) {
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
}
