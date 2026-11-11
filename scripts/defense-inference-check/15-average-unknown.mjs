// 8.2 I1 평균 방식: 상대 스피드·공격을 몰라도(입력 없이) 후보 전체를 평균내 역산한다. 맨 뒤 모듈이라 결합 결과 해시에는 참여하지 않는다.
export default async function ({ server, data, inf, ev, stat, form, fm, ai, pts, slot, fail }) {
  const si = await server.ssrLoadModule("/src/lib/speedInference.ts");
  const ci = await server.ssrLoadModule("/src/lib/combinedInference.ts");
  const reals = (s) => stat.computeRealStats(form.getEffectiveForm(data.getPokemon(s.pokemonId), s).baseStats, s.points, s.nature);
  let seed = 31337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const rollOf = () => (85 + Math.floor(rnd() * 16)) / 100;
  const gyro = data.getMove("자이로볼");
  const electro = data.getMove("일렉트릭볼");
  const foul = data.getMove("속임수");
  const mine = slot("한카리아스", { points: pts({ hp: 20, atk: 32, spa: 10, spe: 8 }), nature: "고집" });
  const mine2 = slot("리자몽", { points: pts({ hp: 20, spd: 10, spe: 8 }), nature: "조심" });
  const inRange = (r, v) => !!r && r.min <= v && v <= r.max;

  // 공격 역산(상대가 내게): 방향별 진짜 공격/특공 포인트가 입력 없이도 남고, 값을 알려 주면(고정) 후보가 같거나 줄어든다
  const attackCases = [[gyro, "atk", mine], [electro, "spa", mine2]];
  for (const [move, key, me] of attackCases) {
    const myReal = reals(me);
    let ok = 0;
    let tried = 0;
    let sumNone = 0;
    let sumFixed = 0;
    for (let t = 0; t < 300 && tried < 25; t++) {
      const trueP = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ [key]: trueP, spe: Math.floor(rnd() * 33) }), nature: "용감" });
      const parts = ev.evaluateSlotMatchup(opp, move, me, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, myReal[parts.defenseKey], rollOf());
      if (damage < 1 || damage >= myReal.hp) continue;
      tried++;
      const base = { attacker: slot("망나뇽"), defender: me, observations: [{ move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - damage }] };
      const spe = reals(opp).spe;
      const none = ai.inferAttack(base);
      const fixed = ai.inferAttack({ ...base, opponentSpeed: spe });
      const single = ai.inferAttack({ ...base, opponentSpeedRange: { min: spe, max: spe } });
      if (none?.status === "ok" && inRange(none[key], trueP)) ok++;
      else fail(`${move.name} 공격 역산(입력 없음): 진짜 ${key} ${trueP} 상태=${none?.status} 범위=${JSON.stringify(none?.[key])}`);
      if (fixed && none && fixed.feasible > none.feasible) fail(`${move.name} 공격 역산: 고정이 평균보다 후보가 많음 ${fixed.feasible}>${none.feasible}`);
      if (JSON.stringify([fixed?.status, fixed?.feasible, fixed?.[key]]) !== JSON.stringify([single?.status, single?.feasible, single?.[key]])) fail(`${move.name} 공격 역산: 범위 하나가 고정 입력과 다름`);
      sumNone += none?.feasible ?? 0;
      sumFixed += fixed?.feasible ?? 0;
    }
    console.log(`${move.name} 공격 역산(입력 없음) ${ok}/${tried} · 가능 후보 평균 ${(sumNone / tried).toFixed(0)} (스피드 고정 시 ${(sumFixed / tried).toFixed(0)})`);
    if (tried < 15) fail(`${move.name} 공격 역산 시행 부족`);
  }

  // 방어 역산(내가 상대에게): 자이로볼·일렉트릭볼(상대 스피드), 속임수(상대 공격)
  const defenseCases = [
    [gyro, "def", (o) => ({ opponentSpeed: reals(o).spe }), (o) => ({ opponentSpeedRange: { min: reals(o).spe, max: reals(o).spe } })],
    [electro, "spd", (o) => ({ opponentSpeed: reals(o).spe }), (o) => ({ opponentSpeedRange: { min: reals(o).spe, max: reals(o).spe } })],
    [foul, "def", (o) => ({ opponentAttack: reals(o).atk }), (o) => ({ opponentAttackRange: { min: reals(o).atk, max: reals(o).atk } })],
  ];
  for (const [move, key, fixedOf, rangeOf] of defenseCases) {
    let ok = 0;
    let tried = 0;
    let sumNone = 0;
    let sumFixed = 0;
    let msNone = 0;
    for (let t = 0; t < 300 && tried < 25; t++) {
      const trueP = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ hp: Math.floor(rnd() * 20), [key]: trueP, atk: Math.floor(rnd() * 33), spe: Math.floor(rnd() * 33) }), nature: "용감" });
      const oppReal = reals(opp);
      const parts = ev.evaluateSlotMatchup(mine, move, opp, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, oppReal[parts.defenseKey], rollOf());
      if (damage < 1 || damage >= oppReal.hp) continue;
      tried++;
      const base = { attacker: mine, defender: slot("망나뇽"), observations: [{ move, critical: false, before: 100, after: inf.displayPercent(oppReal.hp - damage, oppReal.hp) }] };
      const t0 = performance.now();
      const none = inf.inferDefense(base);
      msNone += performance.now() - t0;
      const fixed = inf.inferDefense({ ...base, ...fixedOf(opp) });
      const single = inf.inferDefense({ ...base, ...rangeOf(opp) });
      if (none?.status === "ok" && inRange(none[key], trueP)) ok++;
      else fail(`${move.name} 방어 역산(입력 없음): 진짜 ${key} ${trueP} 상태=${none?.status} 범위=${JSON.stringify(none?.[key])}`);
      if (fixed && none && fixed.feasible > none.feasible) fail(`${move.name} 방어 역산: 고정이 평균보다 후보가 많음 ${fixed.feasible}>${none.feasible}`);
      if (JSON.stringify([fixed?.status, fixed?.feasible, fixed?.[key]]) !== JSON.stringify([single?.status, single?.feasible, single?.[key]])) fail(`${move.name} 방어 역산: 범위 하나가 고정 입력과 다름`);
      sumNone += none?.feasible ?? 0;
      sumFixed += fixed?.feasible ?? 0;
    }
    console.log(`${move.name} 방어 역산(입력 없음) ${ok}/${tried} · 가능 후보 평균 ${(sumNone / tried).toFixed(0)} (고정 시 ${(sumFixed / tried).toFixed(0)}) · 한 번 ${(msNone / tried).toFixed(0)}ms`);
    if (tried < 15) fail(`${move.name} 방어 역산 시행 부족`);
  }

  // 사전 범위: 선후공 줄(스피드 역산)이 있으면 자이로볼 방어 역산이 입력 없이도 같거나 좁아지고, 진짜 값은 남는다
  {
    const neutral = si.NEUTRAL_SPEED_CONDITIONS;
    let narrower = 0;
    let tried = 0;
    for (let t = 0; t < 300 && tried < 20; t++) {
      const trueP = Math.floor(rnd() * 33);
      const spe = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ hp: Math.floor(rnd() * 20), def: trueP, spe }), nature: "용감" });
      const oppReal = reals(opp);
      const parts = ev.evaluateSlotMatchup(mine, gyro, opp, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, oppReal[parts.defenseKey], rollOf());
      if (damage < 1 || damage >= oppReal.hp) continue;
      const mySpeed = reals(mine).spe;
      if (mySpeed === oppReal.spe) continue;
      tried++;
      const defenseInput = { attacker: mine, defender: slot("망나뇽"), observations: [{ move: gyro, critical: false, before: 100, after: inf.displayPercent(oppReal.hp - damage, oppReal.hp) }] };
      const speedInput = { attacker: slot("망나뇽"), defender: mine, observations: [{ first: mySpeed > oppReal.spe ? "me" : "opponent", conditions: neutral }] };
      const without = ci.inferCombined(defenseInput, null, null);
      const withSpeed = ci.inferCombined(defenseInput, null, speedInput);
      if (!(withSpeed.defense?.status === "ok" && inRange(withSpeed.defense.def, trueP))) fail(`사전 범위: 진짜 def ${trueP} 상태=${withSpeed.defense?.status} 범위=${JSON.stringify(withSpeed.defense?.def)}`);
      if (withSpeed.defense.feasible > without.defense.feasible) fail(`사전 범위: 선후공을 넣었는데 후보가 늘었다 ${withSpeed.defense.feasible}>${without.defense.feasible}`);
      if (withSpeed.defense.feasible < without.defense.feasible) narrower++;
    }
    console.log(`사전 범위(선후공 → 자이로볼 방어): ${tried}건 중 ${narrower}건에서 후보가 좁아짐`);
    if (tried < 10) fail("사전 범위 시행 부족");
  }
}
