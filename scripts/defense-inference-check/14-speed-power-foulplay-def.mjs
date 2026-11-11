// 8.2 I1 2단계: 자이로볼·일렉트릭볼(양방향, 상대 스피드 입력) · 속임수 방어 역산(상대 공격 입력). 맨 뒤 모듈이라 결합 결과 해시에는 참여하지 않는다.
export default async function ({ data, inf, ev, stat, form, fm, ai, pts, slot, fail }) {
  const reals = (s) => stat.computeRealStats(form.getEffectiveForm(data.getPokemon(s.pokemonId), s).baseStats, s.points, s.nature);
  let seed = 7777;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const gyro = data.getMove("자이로볼");
  const electro = data.getMove("일렉트릭볼");
  const foul = data.getMove("속임수");
  const mine = slot("한카리아스", { points: pts({ hp: 20, atk: 32, spa: 10, spe: 8 }), nature: "고집" });
  const mineOrig = mine;
  const myReal = reals(mine);
  const rollOf = () => (85 + Math.floor(rnd() * 16)) / 100;

  // 입력이 없으면 막는다(스피드·공격을 모르면 위력/결정력이 안 정해진다)
  for (const m of [gyro, electro]) {
    if (!inf.inferenceUnsupportedReason(m) || !ai.attackInferenceUnsupportedReason(m)) fail(`${m.name}: 상대 스피드 없이 통과`);
    if (inf.inferenceUnsupportedReason(m, { speed: true }) || ai.attackInferenceUnsupportedReason(m, { speed: true })) fail(`${m.name}: 상대 스피드가 있는데 막힘`);
  }
  if (!inf.inferenceUnsupportedReason(foul) || inf.inferenceUnsupportedReason(foul, { attack: true })) fail("속임수 방어 역산 입력 조건이 어긋남");

  // 공격 역산: 상대가 내게 쓴 자이로볼(물리)·일렉트릭볼(특수) — 진짜 공격/특공 포인트가 후보에 남는다 (일렉트릭볼은 땅 타입이 면역이라 받는 쪽을 바꾼다)
  const mine2 = slot("리자몽", { points: pts({ hp: 20, spd: 10, spe: 8 }), nature: "조심" });
  for (const [move, key, mine] of [[gyro, "atk", mineOrig], [electro, "spa", mine2]]) {
    const myReal = reals(mine);
    let ok = 0;
    let tried = 0;
    for (let t = 0; t < 300 && tried < 40; t++) {
      const trueP = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ [key]: trueP, spe: Math.floor(rnd() * 33) }), nature: "용감" });
      const parts = ev.evaluateSlotMatchup(opp, move, mine, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, myReal[parts.defenseKey], rollOf());
      if (damage < 1 || damage >= myReal.hp) continue;
      tried++;
      const r = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, opponentSpeed: reals(opp).spe, observations: [{ move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - damage }] });
      const range = r?.[key];
      if (r?.status === "ok" && range && range.min <= trueP && trueP <= range.max) ok++;
      else fail(`${move.name} 공격 역산: 진짜 ${key} ${trueP} 상태=${r?.status} 범위=${JSON.stringify(range)} 오류=${JSON.stringify(r?.observationErrors)}`);
    }
    console.log(`${move.name} 공격 역산 ${ok}/${tried} ok`);
    if (tried < 20) fail(`${move.name} 공격 역산 시행 부족`);
  }

  // 방어 역산: 내가 상대에게 쓴 자이로볼(물리→방어)·일렉트릭볼(특수→특방), 속임수(상대 공격 입력→방어)
  const cases = [
    [gyro, "def", (opp) => ({ opponentSpeed: reals(opp).spe })],
    [electro, "spd", (opp) => ({ opponentSpeed: reals(opp).spe })],
    [foul, "def", (opp) => ({ opponentAttack: reals(opp).atk })],
  ];
  for (const [move, key, given] of cases) {
    let ok = 0;
    let tried = 0;
    for (let t = 0; t < 300 && tried < 40; t++) {
      const trueP = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ hp: Math.floor(rnd() * 20), [key]: trueP, atk: Math.floor(rnd() * 33), spe: Math.floor(rnd() * 33) }), nature: "용감" });
      const oppReal = reals(opp);
      const parts = ev.evaluateSlotMatchup(mine, move, opp, { skipVerdict: true })?.damageParts;
      if (!parts || parts.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(parts, oppReal[parts.defenseKey], rollOf());
      if (damage < 1 || damage >= oppReal.hp) continue;
      tried++;
      const observation = { move, critical: false, before: 100, after: inf.displayPercent(oppReal.hp - damage, oppReal.hp) };
      const r = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [observation], ...given(opp) });
      const range = r?.[key];
      if (r?.status === "ok" && range && range.min <= trueP && trueP <= range.max) ok++;
      else fail(`${move.name} 방어 역산: 진짜 ${key} ${trueP} 상태=${r?.status} 범위=${JSON.stringify(range)} 오류=${JSON.stringify(r?.observationErrors)}`);
    }
    console.log(`${move.name} 방어 역산 ${ok}/${tried} ok`);
    if (tried < 20) fail(`${move.name} 방어 역산 시행 부족`);
  }

  // 입력값이 결과를 실제로 바꾸는지: 다른 상대 스피드를 넣으면 위력이 달라 같은 관측이 다른 후보를 낳는다
  const opp = slot("망나뇽", { points: pts({ atk: 20, spe: 10 }), nature: "용감" });
  const parts = ev.evaluateSlotMatchup(opp, gyro, mine, { skipVerdict: true }).damageParts;
  const damage = fm.integerTotalDamage(parts, myReal[parts.defenseKey], 1);
  const obs = [{ move: gyro, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - damage }];
  const slow = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, opponentSpeed: reals(opp).spe, observations: obs });
  const fast = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, opponentSpeed: 400, observations: obs });
  if (JSON.stringify(slow?.atk) === JSON.stringify(fast?.atk)) fail("자이로볼: 상대 스피드가 결과에 반영되지 않음");
}
