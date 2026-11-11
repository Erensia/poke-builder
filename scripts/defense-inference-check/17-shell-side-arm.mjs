// 8.2 I1 4단계: 셸암즈 — 물리/특수 분류가 상대 방어·특방(또는 공격·특공) 쌍으로 정해진다. 엔진 규칙(실능·랭크로 낸 물리/특수 데미지 비교, 동점 50%)을 따른다.
// 맨 뒤 모듈이라 결합 결과 해시에는 참여하지 않는다.
export default async function ({ data, inf, ev, bp, stat, form, fm, ai, pts, slot, fail }) {
  const shell = data.getMove("셸암즈");
  const asCategory = (category) => ({ ...shell, category, makesContact: category === "physical", dynamicCategoryByHigherDamage: undefined });
  const formOf = (s) => form.getEffectiveForm(data.getPokemon(s.pokemonId), s);
  const reals = (s) => stat.computeRealStats(formOf(s).baseStats, s.points, s.nature);
  const inRange = (r, v) => !!r && r.min <= v && v <= r.max;
  let seed = 90210;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const natures = ["용감", "조심", "무사태평", "대담", "겁쟁이", "고집"];
  // 엔진과 같은 규칙으로 분류를 정한다(동점이면 임의)
  const engineCategory = (attackerReal, defenderReal, types) => {
    const phys = bp.computeDamage(attackerReal, defenderReal, types, asCategory("physical"), {})?.damage ?? 0;
    const spec = bp.computeDamage(attackerReal, defenderReal, types, asCategory("special"), {})?.damage ?? 0;
    return phys > spec ? "physical" : spec > phys ? "special" : rnd() < 0.5 ? "physical" : "special";
  };

  // 방어 역산: 내가 셸암즈 — 진짜 (HP, 방어, 특방)이 후보에 남는다. 내 공격·특공을 비슷하게 맞춰 두 분류가 모두 나오게 한다
  {
    let ok = 0;
    let tried = 0;
    const seen = { physical: 0, special: 0 };
    let specialMissedAsPhysical = 0;
    for (let t = 0; t < 600 && tried < 40; t++) {
      const base = Math.floor(rnd() * 20);
      const mine = slot("가라르야도란", { points: pts({ atk: base, spa: Math.max(0, Math.min(32, base + Math.floor(rnd() * 13) - 6)) }), nature: "겁쟁이" });
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33) };
      const opp = slot("망나뇽", { points: pts(truth), nature: natures[Math.floor(rnd() * natures.length)] });
      const oppReal = reals(opp);
      const cat = engineCategory(reals(mine), oppReal, formOf(mine).types);
      const parts = ev.evaluateSlotMatchup(mine, asCategory(cat), opp, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, oppReal[parts.defenseKey], (85 + Math.floor(rnd() * 16)) / 100);
      if (damage < 1 || damage >= oppReal.hp) continue;
      tried++;
      seen[cat]++;
      const observation = { move: shell, critical: false, before: 100, after: inf.displayPercent(oppReal.hp - damage, oppReal.hp) };
      const r = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [observation] });
      if (r?.status === "ok" && inRange(r.hp, truth.hp) && inRange(r.def, truth.def) && inRange(r.spd, truth.spd)) ok++;
      else fail(`셸암즈 방어 역산: 진짜 ${JSON.stringify(truth)} 분류=${cat} 상태=${r?.status} hp=${JSON.stringify(r?.hp)} def=${JSON.stringify(r?.def)} spd=${JSON.stringify(r?.spd)}`);
      // 분류를 무시하고 물리로 가정하면(과거 평가기식) 특수로 나간 관측에서 진짜 값을 놓치는지
      if (cat === "special") {
        const wrong = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [{ ...observation, move: asCategory("physical") }] });
        if (!(wrong?.status === "ok" && inRange(wrong.def, truth.def))) specialMissedAsPhysical++;
      }
    }
    console.log(`셸암즈 방어 역산 ${ok}/${tried} ok · 분류 물리 ${seen.physical}·특수 ${seen.special} · 특수를 물리로 가정하면 놓치는 경우 ${specialMissedAsPhysical}건`);
    if (tried < 25) fail("셸암즈 방어 역산 시행 부족");
    if (seen.physical < 5 || seen.special < 5) fail(`셸암즈 방어 역산: 두 분류가 모두 나오지 않음 ${JSON.stringify(seen)}`);
  }

  // 공격 역산: 상대가 셸암즈 — 진짜 (공격, 특공)이 후보에 남는다
  {
    let ok = 0;
    let tried = 0;
    const seen = { physical: 0, special: 0 };
    for (let t = 0; t < 600 && tried < 40; t++) {
      const mine = slot("한카리아스", { points: pts({ hp: 20, def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33) }), nature: "조심" });
      const myReal = reals(mine);
      const base = Math.floor(rnd() * 33);
      const truth = { atk: base, spa: Math.max(0, Math.min(32, base + Math.floor(rnd() * 13) - 6)) };
      const opp = slot("가라르야도란", { points: pts(truth), nature: natures[Math.floor(rnd() * natures.length)] });
      const oppReal = reals(opp);
      const cat = engineCategory(oppReal, myReal, formOf(opp).types);
      const parts = ev.evaluateSlotMatchup(opp, asCategory(cat), mine, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, myReal[parts.defenseKey], (85 + Math.floor(rnd() * 16)) / 100);
      if (damage < 1 || damage >= myReal.hp) continue;
      tried++;
      seen[cat]++;
      const r = ai.inferAttack({ attacker: slot("가라르야도란"), defender: mine, observations: [{ move: shell, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - damage }] });
      if (r?.status === "ok" && inRange(r.atk, truth.atk) && inRange(r.spa, truth.spa)) ok++;
      else fail(`셸암즈 공격 역산: 진짜 ${JSON.stringify(truth)} 분류=${cat} 상태=${r?.status} atk=${JSON.stringify(r?.atk)} spa=${JSON.stringify(r?.spa)}`);
    }
    console.log(`셸암즈 공격 역산 ${ok}/${tried} ok · 분류 물리 ${seen.physical}·특수 ${seen.special}`);
    if (tried < 25) fail("셸암즈 공격 역산 시행 부족");
    if (seen.physical < 5 || seen.special < 5) fail(`셸암즈 공격 역산: 두 분류가 모두 나오지 않음 ${JSON.stringify(seen)}`);
  }
}
