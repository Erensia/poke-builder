// 7.3 B3 풀피 멀티스케일 × 다단히트 역산 — 첫 타만 반감이라는 규칙으로 만든 관측에서 진짜 값이 후보에 남는지.
// 맨 뒤 모듈이라 결합 결과 해시(digestResult)에는 참여하지 않는다.
export default async function ({ data, inf, ev, stat, form, fm, ai, rnd, pick, pts, natureIds, slot, fail }) {
  const move = data.getMove("스케일샷");
  const reals = (s) => stat.computeRealStats(form.getEffectiveForm(data.getPokemon(s.pokemonId), s).baseStats, s.points, s.nature);

  // 방어 역산: 멀티스케일 상대가 풀피에서 다단히트를 맞은 관측 → 진짜 HP·방어 포인트가 후보에 남는다
  {
    let ok = 0;
    let tried = 0;
    for (let t = 0; t < 120 && tried < 60; t++) {
      const atk = slot("한카리아스", { points: pts({ atk: 32 }), nature: pick(natureIds) });
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: 0, nature: pick(natureIds) };
      const defTrue = slot("망나뇽", { ability: "멀티스케일", points: pts(truth), nature: truth.nature });
      const dReal = reals(defTrue);
      const hits = 2 + Math.floor(rnd() * 4);
      const p = ev.evaluateSlotMatchup(atk, move, defTrue, { multiHitCount: hits, defenderHpIsFull: true })?.damageParts;
      if (!p) continue;
      const damage = fm.integerTotalDamage(p, dReal[p.defenseKey], (85 + Math.floor(rnd() * 16)) / 100);
      if (damage >= dReal.hp) continue;
      tried++;
      const observation = { move, hits, critical: false, before: 100, after: inf.displayPercent(dReal.hp - damage, dReal.hp) };
      const r = inf.inferDefense({ attacker: atk, defender: slot("망나뇽", { ability: "멀티스케일" }), observations: [observation] });
      if (r?.status === "ok" && r.observationErrors.every((e) => !e) && r.hp.min <= truth.hp && truth.hp <= r.hp.max && r.def.min <= truth.def && truth.def <= r.def.max) ok++;
      else fail(`멀티스케일 다단히트 방어 왕복: 진짜 배분이 빠짐/거부 truth=${JSON.stringify(truth)} hits=${hits} 상태=${r?.status} 오류=${JSON.stringify(r?.observationErrors)}`);
    }
    console.log(`멀티스케일 다단히트 방어 역산 왕복 ${ok}/${tried} 통과`);
    if (tried < 20) fail("멀티스케일 다단히트 방어 왕복 시행 부족");
  }

  // 공격 역산: 내 멀티스케일 포켓몬이 풀피에서 상대 다단히트를 맞은 관측 → 진짜 공격 실수치가 후보에 남는다
  {
    let ok = 0;
    let tried = 0;
    for (let t = 0; t < 120 && tried < 60; t++) {
      const trueAtk = Math.floor(rnd() * 33);
      const oppTrue = slot("한카리아스", { points: pts({ atk: trueAtk }), nature: pick(natureIds) });
      const mySlot = slot("망나뇽", { ability: "멀티스케일", points: pts({ hp: 32, def: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myMax = reals(mySlot).hp;
      const hits = 2 + Math.floor(rnd() * 4);
      const res = ev.evaluateSlotMatchup(oppTrue, move, mySlot, { multiHitCount: hits, defenderHpIsFull: true, skipVerdict: true });
      const p = res?.damageParts;
      if (!p) continue;
      const damage = fm.integerTotalDamage(p, res.defenseStat, (85 + Math.floor(rnd() * 16)) / 100);
      if (damage >= myMax) continue;
      tried++;
      const r = ai.inferAttack({
        attacker: slot("한카리아스"),
        defender: mySlot,
        observations: [{ move, hits, critical: false, hpBefore: myMax, hpAfter: myMax - damage }],
      });
      const realAtk = reals(oppTrue).atk;
      if (r && r.observationErrors?.every((e) => !e) && r.realAtk && r.realAtk.min <= realAtk && realAtk <= r.realAtk.max) ok++;
      else fail(`멀티스케일 다단히트 공격 왕복: 진짜 공격 실수치가 빠짐/거부 realAtk=${realAtk} hits=${hits} 오류=${JSON.stringify(r?.observationErrors)}`);
    }
    console.log(`멀티스케일 다단히트 공격 역산 왕복 ${ok}/${tried} 통과`);
    if (tried < 20) fail("멀티스케일 다단히트 공격 왕복 시행 부족");
  }
}
