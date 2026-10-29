// 모순·면역, 저장 복원, 스피드 표, 후보 카드
export default async function ({ server, data, inf, ev, stat, form, fm, ai, rnd, pts, usable, species, natureIds, slot, attackMoves, fail, failCount }) {
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
      if (r.rows.length !== 1 || r.rows[0].kind !== "dealt" || r.rows[0].before !== "100" || r.defStage !== 0) fail(`깨진 저장본이 기본값이 아님: ${JSON.stringify(bad)}`);
    }
    const good = {
      rows: [
        { id: 7, kind: "received", moveId: "지진", critical: true, before: "150", after: "90", megaForm: "", first: "me", cond: {} },
        { id: 9, kind: "speed", moveId: null, critical: false, before: "", after: "", megaForm: "", first: "opponent", cond: { trickRoom: true, oppStage: 2, oppItemId: "구애스카프", oppAbilityId: "없는특성" } },
      ],
      abilityId: "없는특성", itemId: "구애스카프", defStage: -2, spdStage: 99, tolerant: true,
      atkAbilityId: "", atkItemId: "", atkStage: 1, spaStage: 0, oppBurned: true,
    };
    const r = restoreInference(JSON.parse(JSON.stringify(good)));
    const ok =
      r.rows.length === 2 && r.rows[0].id === 1 && r.rows[1].id === 2 && r.rows[0].moveId === "지진" && r.rows[0].critical && r.rows[0].after === "90" &&
      r.rows[1].first === "opponent" && r.rows[1].cond.trickRoom === true && r.rows[1].cond.oppStage === 2 && r.rows[1].cond.oppItemId === "구애스카프" && r.rows[1].cond.oppAbilityId === null &&
      r.abilityId === "" && r.itemId === "구애스카프" && r.defStage === -2 && r.spdStage === 0 && r.tolerant && r.atkStage === 1 && r.oppBurned;
    if (!ok) fail(`저장 복원 결과가 기대와 다름: ${JSON.stringify(r)}`);
    console.log("저장 복원(깨진 입력 7종·정상 1종)", failCount() === 0 ? "통과" : "실패");
  }
  // 5) 3.4 T1 스피드 표 — 식이 computeRealStats와 같다
  {
    const st = await server.ssrLoadModule("/src/lib/speedTable.ts");
    const before = failCount();
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
    console.log(`스피드 표(폼 ${st.SPEED_FORMS.length}개, 식 ${formulaChecked}건)`, failCount() === before ? "통과" : "실패");
  }
  // 5-b) 3.6 T2 스피드 표 단계 — 단계 값이 computeRealStats와 같고, 추월 분류·최소 포인트·포인트 지점이 전수 대조와 같다
  {
    const st = await server.ssrLoadModule("/src/lib/speedTable.ts");
    const before = failCount();
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
    console.log(`스피드 단계(폼 ${st.SPEED_FORMS.length}개 × 4단계, 기준 ${speeds.length}개, 곡선 5개)`, failCount() === before ? "통과" : "실패");
  }
  // 5-c) 3.6 I2 후보 카드 — 정렬·남은 SP·최소 투자 후보·데미지 범위가 결과와 맞는다(공용 난수열을 건드리지 않게 별도 난수)
  {
    const before = failCount();
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
    console.log(`후보 카드(방어 ${defChecked}건·공격 ${atkChecked}건: 세 정렬·남은 SP·최소 투자·데미지 범위·범위 중앙)`, failCount() === before ? "통과" : "실패");
  }
}
