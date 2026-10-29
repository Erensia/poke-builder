// 방어 역산 왕복
export default async function ({ trials, data, inf, stat, form, rnd, pick, pts, usable, species, natureIds, slot, makeObservation, fail }) {
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
}
