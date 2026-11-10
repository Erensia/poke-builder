// 8.2 I1 공격 역산: 고정 데미지 · 쓰러진 다단히트. 맨 뒤 모듈이라 결합 결과 해시(digestResult)에는 참여하지 않는다.
export default async function ({ data, ev, stat, form, fm, ai, pts, slot, fail }) {
  const reals = (s) => stat.computeRealStats(form.getEffectiveForm(data.getPokemon(s.pokemonId), s).baseStats, s.points, s.nature);
  const mine = slot("한카리아스", { points: pts({ hp: 20 }), nature: "조심" });
  const myMax = reals(mine).hp;
  const base = { attacker: slot("망나뇽"), defender: mine };

  // 고정 데미지: 맞는 값(50)은 ok(공격 후보를 거르지 못함), 다른 값은 모순
  {
    const move = data.getMove("나이트헤드");
    const okR = ai.inferAttack({ ...base, observations: [{ move, critical: false, hpBefore: myMax, hpAfter: myMax - 50 }] });
    const badR = ai.inferAttack({ ...base, observations: [{ move, critical: false, hpBefore: myMax, hpAfter: myMax - 49 }] });
    const koR = ai.inferAttack({ ...base, observations: [{ move, critical: false, hpBefore: 30, hpAfter: 0 }] });
    const tooBigR = ai.inferAttack({ ...base, observations: [{ move, critical: false, hpBefore: myMax, hpAfter: 0 }] });
    if (okR?.status !== "ok") fail(`고정 데미지: 맞는 값이 ${okR?.status}`);
    if (badR?.status !== "contradiction") fail(`고정 데미지: 다른 값이 ${badR?.status}`);
    if (koR?.status !== "ok") fail(`고정 데미지: 50 이하 HP에서 쓰러짐이 ${koR?.status}`);
    if (tooBigR?.status !== "contradiction") fail(`고정 데미지: 풀피에서 한 방에 쓰러짐이 ${tooBigR?.status}`);
    if (okR?.feasible !== okR?.total) fail("고정 데미지는 공격 후보를 거르지 않아야 한다");
    console.log(`고정 데미지 공격 역산: 맞는 값 ${okR?.status} · 다른 값 ${badR?.status} · 쓰러짐 ${koR?.status}`);
  }

  // 쓰러진 다단히트: n타째에 쓰러진 관측 → 진짜 공격 배분이 후보에 남고, "n-1타에 이미 쓰러졌을" 배분은 가능도에서 빠진다
  {
    const move = data.getMove("스케일샷");
    let ok = 0;
    let tried = 0;
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let t = 0; t < 400 && tried < 40; t++) {
      const trueAtk = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ atk: trueAtk }), nature: "용감" });
      const hits = 2 + Math.floor(rnd() * 4);
      const hp0 = 1 + Math.floor(rnd() * myMax);
      const full = ev.evaluateSlotMatchup(opp, move, mine, { multiHitCount: hits, skipVerdict: true })?.damageParts;
      const prev = ev.evaluateSlotMatchup(opp, move, mine, { multiHitCount: hits - 1, skipVerdict: true })?.damageParts;
      if (!full || !prev) continue;
      const roll = (85 + Math.floor(rnd() * 16)) / 100;
      const D = reals(mine)[full.defenseKey];
      // 같은 난수를 모든 타에 쓴 단순 사례(근사): n타 합계 ≥ HP > n-1타 합계일 때만 쓰러진 관측으로 쓴다
      const dn = fm.integerTotalDamage(full, D, roll);
      const dp = fm.integerTotalDamage(prev, D, roll);
      if (!(dn >= hp0 && dp < hp0)) continue;
      tried++;
      const r = ai.inferAttack({ attacker: slot("망나뇽", { nature: "용감" }), defender: mine, observations: [{ move, hits, critical: false, hpBefore: hp0, hpAfter: 0 }] });
      if (r?.status === "ok" && r.observationErrors.every((e) => !e)) ok++;
      else fail(`쓰러진 다단히트 왕복: 진짜 배분이 빠짐/거부 atk=${trueAtk} hits=${hits} hp=${hp0} 상태=${r?.status}`);
    }
    console.log(`쓰러진 다단히트 공격 역산 ${ok}/${tried} ok`);
    if (tried < 10) fail("쓰러진 다단히트 시행 부족");
    // 1타째에 쓰러짐(타수 1)은 허용, 타수 범위 밖은 invalid
    const first = ai.inferAttack({ ...base, observations: [{ move, hits: 1, critical: false, hpBefore: 5, hpAfter: 0 }] });
    const over = ai.inferAttack({ ...base, observations: [{ move, hits: 9, critical: false, hpBefore: 5, hpAfter: 0 }] });
    if (first?.status !== "ok") fail(`쓰러진 다단히트 1타째: ${first?.status}`);
    if (over?.status !== "invalid") fail(`쓰러진 다단히트 타수 초과: ${over?.status}`);
    // 쓰러뜨리지 못한 다단히트는 여전히 최소 타수를 지켜야 한다
    const small = ai.inferAttack({ ...base, observations: [{ move, hits: 1, critical: false, hpBefore: myMax, hpAfter: myMax - 10 }] });
    if (small?.status !== "invalid") fail(`안 쓰러진 다단히트의 최소 타수 검사가 사라짐: ${small?.status}`);
  }
}
