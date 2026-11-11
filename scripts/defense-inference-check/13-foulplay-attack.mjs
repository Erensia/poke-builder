// 8.2 I1 공격 역산: 속임수(내 공격 스탯으로 데미지가 정해진다). 맨 뒤 모듈이라 결합 결과 해시에는 참여하지 않는다.
export default async function ({ data, ev, stat, form, fm, ai, pts, slot, fail }) {
  const move = data.getMove("속임수");
  const reals = (s) => stat.computeRealStats(form.getEffectiveForm(data.getPokemon(s.pokemonId), s).baseStats, s.points, s.nature);
  let seed = 9001;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const mine = slot("한카리아스", { points: pts({ hp: 20, atk: 32, def: 10 }), nature: "고집" });
  const myReal = reals(mine);
  let ok = 0;
  let tried = 0;
  for (let t = 0; t < 120 && tried < 40; t++) {
    // 상대 공격 배분이 달라도 데미지는 내 공격·방어로만 정해진다 → 어느 배분에서 만든 관측이든 후보는 전부 남는다
    const opp = slot("망나뇽", { points: pts({ atk: Math.floor(rnd() * 33) }), nature: "용감" });
    const parts = ev.evaluateSlotMatchup(opp, move, mine, { skipVerdict: true })?.damageParts;
    if (!parts) continue;
    const damage = fm.integerTotalDamage(parts, myReal[parts.defenseKey], (85 + Math.floor(rnd() * 16)) / 100);
    if (damage < 1 || damage >= myReal.hp) continue;
    tried++;
    const r = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - damage }] });
    if (r?.status === "ok" && r.observationErrors.every((e) => !e) && r.feasible === r.total) ok++;
    else fail(`속임수 공격 역산: 상태=${r?.status} 가능=${r?.feasible}/${r?.total} 오류=${JSON.stringify(r?.observationErrors)}`);
  }
  console.log(`속임수 공격 역산 ${ok}/${tried} ok (후보 전부 유지)`);
  if (tried < 20) fail("속임수 공격 역산 시행 부족");
  // 난수 범위 밖의 데미지는 모순
  const bad = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - 1 }] });
  if (bad?.status !== "contradiction") fail(`속임수: 불가능한 데미지가 ${bad?.status}`);
}
