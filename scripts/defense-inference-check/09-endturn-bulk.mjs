// 3.7 A4 턴 종료 효과·A3 내구 조정
export default async function ({ server, trials, data, inf, ev, stat, form, fm, rnd, pick, pts, usable, species, natureIds, slot, makeObservation, fail }) {
  // (난수 순서가 달라지면 위 결합 결과 해시가 바뀌므로 맨 끝에 둔다)
  // 3.7 A4) 턴 종료 효과 — 첫 관측 뒤 먹다남은음식(+1/16)·독(−2/16)을 반영해 만든 2관측 기록이 진짜 배분을 남기는지,
  // 효과를 빼고 넣으면 (같은 기록이 모순돼) 진짜 배분이 빠지는 경우가 실제로 있는지(=효과가 가능도에 쓰이는지)
  {
    let ok = 0;
    let tried = 0;
    let dropped = 0;
    for (let t = 0; t < trials * 3 && tried < 60; t++) {
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const defId = pick(species).id;
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: 0, nature: pick(natureIds) };
      const defTrue = slot(defId, { points: pts(truth), nature: truth.nature });
      const dReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(defId), defTrue).baseStats, defTrue.points, defTrue.nature);
      const first = makeObservation(usable.filter((m) => m.category === "physical"), atk, defTrue, dReal, dReal.hp);
      if (!first) continue;
      const effects = pick([["leftovers"], ["leftovers", "poison"], ["toxic3"], ["leftovers", "toxic2"]]);
      const hpAfterEffect = dReal.hp - first.damage + effects.reduce((sum, id) => sum + Math.trunc((dReal.hp * { leftovers: 1, poison: -2, toxic3: -3, toxic2: -2 }[id]) / 16), 0);
      if (hpAfterEffect <= 0 || hpAfterEffect > dReal.hp) continue;
      const second = makeObservation(usable.filter((m) => m.category === "physical"), atk, defTrue, dReal, hpAfterEffect, true);
      if (!second) continue;
      tried++;
      const observations = [{ ...first.observation, endTurn: effects }, second.observation];
      const withEffect = inf.inferDefense({ attacker: atk, defender: slot(defId), observations });
      if (withEffect?.status === "ok" && withEffect.hp.min <= truth.hp && truth.hp <= withEffect.hp.max && withEffect.def.min <= truth.def && truth.def <= withEffect.def.max) ok++;
      else fail(`턴 종료 왕복: 진짜 배분이 빠짐 ${effects} truth=${JSON.stringify(truth)} 상태=${withEffect?.status}`);
      const without = inf.inferDefense({ attacker: atk, defender: slot(defId), observations: observations.map((o) => ({ ...o, endTurn: undefined })) });
      if (without?.status !== "ok" || without.hp.min > truth.hp || truth.hp > without.hp.max) dropped++;
    }
    console.log(`턴 종료 효과 왕복 ${ok}/${tried} 통과 · 효과를 빼면 어긋나는 경우 ${dropped}건`);
    if (tried === 0) fail("턴 종료 왕복 시행이 0건");
    if (dropped === 0) fail("효과를 빼도 항상 맞으면 효과가 쓰이는지 알 수 없음");
  }
  // 3.7 A3) 내구 조정 — 찾은 조합은 최대 난수에도 버티고(엔진 실수치·정수 공식 대조), 방어 포인트 −1이면 못 버티며,
  // 합계 최소는 1,089칸 전수 탐색과 같다
  {
    const bulk = await server.ssrLoadModule("/src/lib/bulkAdjust.ts");
    let checked = 0;
    for (let t = 0; t < 30; t++) {
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const defId = pick(species).id;
      const mine = slot(defId, { points: pts({ spe: 10 }), nature: pick(natureIds) });
      const res = ev.evaluateSlotMatchup(atk, pick(usable), mine);
      const p = res?.damageParts;
      if (!p || p.typeEffectiveness === 0) continue;
      const dForm = form.getEffectiveForm(data.getPokemon(defId), mine);
      const key = p.defenseKey;
      const survives = (hp, d) => {
        const real = stat.computeRealStats(dForm.baseStats, { ...mine.points, hp, [key]: d }, mine.nature);
        return Math.max(...Array.from({ length: 16 }, (_, k) => fm.integerTotalDamage(p, real[key], (85 + k) / 100))) < real.hp;
      };
      const sums = Array.from({ length: 33 * 33 }, (_, i) => [Math.floor(i / 33), i % 33]).filter(([hp, d]) => survives(hp, d)).map(([hp, d]) => hp + d);
      const best = sums.length ? Math.min(...sums) : Infinity;
      const opts = bulk.bulkOptions([p], dForm.baseStats, mine.nature, mine.points, 1);
      const kp = (o) => o[key === "def" ? "defPoints" : "spdPoints"];
      if ((opts[0]?.hpPoints ?? 0) + (opts[0] ? kp(opts[0]) : 0) !== (opts.length ? best : 0) || (opts.length === 0) !== (best === Infinity)) {
        fail(`내구 조정: 최소 합계 ${opts[0]?.hpPoints + kp(opts[0])} vs 전수 ${best} (${defId})`);
        continue;
      }
      for (const o of opts) {
        if (!survives(o.hpPoints, kp(o))) fail(`내구 조정: 못 버티는 조합 ${defId} ${o.hpPoints}/${kp(o)}`);
        if (kp(o) > 0 && survives(o.hpPoints, kp(o) - 1)) fail(`내구 조정: 방어 −1도 버팀 ${defId} ${o.hpPoints}/${kp(o)}`);
      }
      checked++;
    }
    console.log(`내구 조정 ${checked}건 (최대 난수 생존·방어 −1 경계·합계 최소 전수 대조) ${checked > 10 ? "통과" : "시행 부족"}`);
    if (checked <= 10) fail("내구 조정 시행 부족");
  }
}
