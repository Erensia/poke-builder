// 3.1 C2-c 스피드 역산
export default async function ({ server, data, inf, ev, stat, form, fm, ai, rnd, pick, pts, usable, species, natureIds, within, slot, makeObservation, attackMoves, makeAttackObservation, fail, digestResult }) {
  // 3.1 C2-c) 스피드 역산 — 진짜 스피드 포인트·성격으로 선후공 관측을 만들어 넣으면 진짜 값이 후보에 남는지, 조건이 다른
  // 관측을 모을수록 좁아지는지, 트릭룸·순풍·스카프 가정·동속 처리.
  {
    const si = await server.ssrLoadModule("/src/lib/speedInference.ts");
    const neutral = si.NEUTRAL_SPEED_CONDITIONS;
    // 진짜 상대(oppTrue)와 나(mySlot)가 이 조건에서 실제로 어느 쪽이 먼저인지(동속이면 임의로 한쪽)
    const actualFirst = (oppTrue, mySlot, c, myStages) => {
      const res = ev.evaluateSpeedMatchup(
        { ...oppTrue, item: c.oppItemId, ability: c.oppAbilityId },
        mySlot,
        {
          attackerStatus: c.oppParalyzed ? "paralysis" : c.oppOtherStatus ? "burn" : null, defenderStatus: c.myParalyzed ? "paralysis" : c.myOtherStatus ? "burn" : null, attackerTailwind: c.oppTailwind, defenderTailwind: c.myTailwind,
          attackerUnburden: c.oppUnburden, trickRoom: c.trickRoom, attackerStages: { atk: 0, def: 0, spa: 0, spd: 0, spe: c.oppStage }, defenderStages: myStages,
        },
      );
      return res.firstMover === "tie" ? (rnd() < 0.5 ? "me" : "opponent") : res.firstMover === "attacker" ? "opponent" : "me";
    };
    const randomConditions = () => ({
      ...neutral,
      oppStage: Math.floor(rnd() * 7) - 3,
      myTailwind: rnd() < 0.3,
      oppTailwind: rnd() < 0.2,
      oppParalyzed: rnd() < 0.1,
      trickRoom: rnd() < 0.15,
    });
    const flatStages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    // 관측 k개로 역산해 진짜 값이 남는지 확인하고 실수치 범위 폭을 돌려준다(빠지면 실패 기록 후 null)
    const speedCase = (k, oppId, truth, oppTrue, mySlot) => {
      const observations = Array.from({ length: k }, () => {
        const conditions = randomConditions();
        return { first: actualFirst(oppTrue, mySlot, conditions, flatStages), conditions };
      });
      const r = si.inferSpeed({ attacker: slot(oppId), defender: mySlot, observations });
      const natName = data.NATURES.find((n) => n.id === truth.nature).name;
      const inRange = r?.status === "ok" && r.spe.min <= truth.spe && truth.spe <= r.spe.max;
      if (inRange && r.groups.some((g) => g.feasible > 0 && g.natureNames.includes(natName))) return r.realSpe.max - r.realSpe.min;
      fail(`스피드 역산 왕복: 진짜 값이 빠짐 opp=${oppId} truth=${JSON.stringify(truth)} 관측=${k} 상태=${r?.status}`);
      return null;
    };
    let speOk = 0;
    let speTried = 0;
    const widths = { 1: 0, 3: 0, 8: 0 };
    const counts = { 1: 0, 3: 0, 8: 0 };
    for (let t = 0; t < 150; t++) {
      const oppId = pick(species).id;
      const truth = { spe: Math.floor(rnd() * 33), nature: pick(natureIds) };
      const oppTrue = slot(oppId, { points: pts({ spe: truth.spe }), nature: truth.nature });
      const mySlot = slot(pick(species).id, { points: pts({ spe: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
      for (const k of [1, 3, 8]) {
        const r = speedCase(k, oppId, truth, oppTrue, mySlot);
        if (r === null) continue;
        widths[k] += r;
        counts[k]++;
        if (k === 1) speOk++;
      }
      speTried++;
    }
    console.log(
      `스피드 역산 왕복 ${speOk}/${speTried} 통과 · 관측 수별 실수치 범위 폭(평균): 1회 ${(widths[1] / counts[1]).toFixed(1)} · 3회 ${(widths[3] / counts[3]).toFixed(1)} · 8회 ${(widths[8] / counts[8]).toFixed(1)}`,
    );
    if (!(widths[3] / counts[3] < widths[1] / counts[1] && widths[8] / counts[8] < widths[3] / counts[3])) fail("스피드 역산: 관측이 늘어도 범위가 좁아지지 않음");

    // 손으로 확인하는 사례: 상대 한카리아스(기본 종족값 102), 나 망나뇽(종족값 80, 스피드 포인트 32 무보정) — 내 스피드 실수치 132
    const me = slot("망나뇽", { points: pts({ spe: 32 }), nature: null });
    const base = { attacker: slot("한카리아스"), defender: me };
    const faster = si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: neutral }] });
    const slower = si.inferSpeed({ ...base, observations: [{ first: "me", conditions: neutral }] });
    // 상대가 먼저 → 상대 스피드 ≥ 132: 한카리아스 실수치 = (102+20+p)×성격. 무보정이면 p ≥ 10이지만 스피드↑(×1.1)이면 p=0도 134라 가능 → 0~32
    if (faster?.status !== "ok" || faster.spe.min > 10 || faster.spe.max !== 32) fail(`스피드 역산 사례: 상대가 먼저 ${JSON.stringify(faster?.spe)}`);
    // 내가 먼저 → 상대 스피드 ≤ 132: 무보정 p ≤ 10, 스피드↓(×0.9)면 p ≤ 24까지(25는 (122+25)×0.9=132.3→132) → 0~25
    if (slower?.status !== "ok" || slower.spe.min !== 0) fail(`스피드 역산 사례: 내가 먼저 ${JSON.stringify(slower?.spe)}`);
    // 트릭룸이면 방향이 반대 — 트릭룸에서 상대가 먼저면 상대가 더 느리다
    const trickFirst = si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: { ...neutral, trickRoom: true } }] });
    if (trickFirst?.status !== "ok" || trickFirst.spe.min !== 0 || trickFirst.spe.max >= 32) fail(`스피드 역산 사례: 트릭룸 ${JSON.stringify(trickFirst?.spe)}`);
    // 서로 모순인 관측(같은 조건에서 둘 다 먼저)은 모순이어야 한다
    const both = si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: neutral }, { first: "me", conditions: neutral }] });
    if (both?.status !== "ok" && both?.status !== "contradiction") fail("스피드 역산: 동속 처리 이상");
    const bad = si.inferSpeed({ ...base, observations: [{ first: "me", conditions: { ...neutral, oppStage: 9 } }] });
    if (bad?.status !== "invalid" || !bad.observationErrors[0]?.includes("랭크")) fail("스피드 역산: 잘못된 랭크가 invalid로 안 잡힘");
    console.log(`스피드 역산 사례: 상대가 먼저 → 포인트 ${faster.spe.min}~${faster.spe.max} · 내가 먼저 → ${slower.spe.min}~${slower.spe.max} · 트릭룸 → ${trickFirst.spe.min}~${trickFirst.spe.max}`);

    // 3.2 V1) 속보: 상태이상이면 스피드 ×1.5(마비 반감 무시). 속보가 아니면 마비만 ×0.5, 화상은 영향 없음
    {
      const spd = (ability, status) =>
        ev.evaluateSpeedMatchup(slot("쥬피썬더", { points: pts({ spe: 32 }), ability }), slot("망나뇽"), { attackerStatus: status }).attackerSpeed;
      const plain = spd(null, null);
      if (spd(null, "burn") !== plain || spd(null, "paralysis") !== Math.floor(plain * 0.5)) fail("선후공: 속보 아닐 때 상태이상 스피드 배율 이상");
      if (spd("속보", null) !== plain || spd("속보", "burn") !== Math.floor(plain * 1.5) || spd("속보", "paralysis") !== spd("속보", "burn")) fail("선후공: 속보 ×1.5 이상");
      // 역산: 내 쥬피썬더(스피드 182)를 상대(쥬피썬더)가 앞질렀다 — 속보 + 상태이상이면 ×1.5라 더 적은 포인트로도 가능하다
      const jolt = { attacker: slot("쥬피썬더"), defender: slot("쥬피썬더", { points: pts({ spe: 32 }) }) };
      const cond = { ...neutral, oppAbilityId: "속보" };
      const calm = si.inferSpeed({ ...jolt, observations: [{ first: "opponent", conditions: cond }] });
      const statused = si.inferSpeed({ ...jolt, observations: [{ first: "opponent", conditions: { ...cond, oppOtherStatus: true } }] });
      if (calm?.status !== "ok" || statused?.status !== "ok" || statused.spe.min >= calm.spe.min) fail(`스피드 역산: 속보 상태이상이 하한을 낮추지 못함 ${JSON.stringify([calm?.spe, statused?.spe])}`);
      else console.log(`속보 선후공: 스피드 ${plain} → 상태이상 ${spd("속보", "burn")} · 역산 "상대가 먼저" 포인트 하한 ${calm.spe.min} → ${statused.spe.min}`);
    }

    // 3.1 L1-b) 메가 전→후 스피드: 같은 포인트·성격으로 메가 전·후 선후공을 만들면 진짜 값이 남고, 폼별 실수치 범위에 폼별 진짜 실수치가 들어간다.
    // 태그가 없어도 다른 쪽이 알려 준 메가폼(viewMegaForms)이 있으면 나란히 만든다.
    {
      const megaSpecies = species.filter((p) => p.megaEvolutions?.length);
      let tried = 0;
      for (let t = 0; t < 60; t++) {
        const poke = pick(megaSpecies);
        const mega = pick(poke.megaEvolutions);
        const truth = { spe: Math.floor(rnd() * 33), nature: pick(natureIds) };
        const pre = slot(poke.id, { points: pts({ spe: truth.spe }), nature: truth.nature });
        const post = slot(poke.id, { points: pts({ spe: truth.spe }), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
        const mySlot = slot(pick(species).id, { points: pts({ spe: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
        const observations = [];
        for (let k = 0; k < 6; k++) {
          const conditions = randomConditions();
          const isPost = k >= 3;
          observations.push({ first: actualFirst(isPost ? post : pre, mySlot, conditions, flatStages), conditions, ...(isPost ? { megaForm: mega.form } : {}) });
        }
        const r = si.inferSpeed({ attacker: slot(poke.id), defender: mySlot, observations });
        const preSpe = stat.computeRealStats(poke.baseStats, pre.points, pre.nature).spe;
        const postSpe = stat.computeRealStats(mega.baseStats, post.points, post.nature).spe;
        tried++;
        if (r?.status !== "ok" || !within(r.spe, truth.spe)) fail(`스피드 메가 전→후: 진짜 값이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${r?.status}`);
        else if (r.formViews.length !== 2 || !within(r.formViews[0].real.spe, preSpe) || !within(r.formViews[1].real.spe, postSpe)) fail(`메가 전·후 나란히(스피드): 폼별 진짜 실수치가 범위에 없음 ${mega.form} truth=${JSON.stringify(truth)}`);
        const untagged = si.inferSpeed({ attacker: slot(poke.id), defender: mySlot, observations: observations.slice(0, 3), viewMegaForms: [mega.form] });
        if (untagged?.formViews.length !== 2) fail("viewMegaForms가 있는데 폼별 표시가 안 만들어짐");
        const plain = si.inferSpeed({ attacker: slot(poke.id), defender: mySlot, observations: observations.slice(0, 3) });
        if (plain?.formViews.length !== 0) fail("메가 태그가 없는데 폼별 표시가 만들어짐");
      }
      console.log(`스피드 메가 전→후·폼별 표시 ${tried}건 통과`);
    }

    // 셸암즈는 물리/특수가 능력치로 정해져 방어·공격 역산 모두 지원하지 않는다(과거: 공격 역산에서 진짜 값이 빠졌음)
    const shell = data.getMove("셸암즈");
    if (!inf.inferenceUnsupportedReason(shell) || !ai.attackInferenceUnsupportedReason(shell)) fail("셸암즈가 역산 미지원으로 안 잡힘");

    // 3.1 PR5-b) 성격 후보가 줄수록 스피드 하한이 올라간다 — 상대가 먼저(내 132 추월): 스피드↑ 0 / 무보정 10 / 스피드↓ 25
    const idsByMult = (want) => data.NATURES.filter((n) => inf.natureMult("spe", n.increased, n.decreased) === want).map((n) => n.id);
    const minFor = (ids) => si.inferSpeed({ ...base, observations: [{ first: "opponent", conditions: neutral }], natureIds: ids })?.spe?.min;
    const mins = [minFor(idsByMult(1.1)), minFor(idsByMult(1)), minFor(idsByMult(0.9))];
    if (mins.join() !== "0,10,25") fail(`스피드 하한이 성격 후보별로 다름: ${mins.join()} (기대 0,10,25)`);

    // 다단히트 왕복(3.3 V4) — 타마다 독립 난수로 만든 총 데미지를 관측으로 넣어도 진짜 배분이 남는다(방어·공격 둘 다)
    {
      const multi = data.MOVES.filter((m) => inf.multiHitRange(m) && ai.attackInferenceUnsupportedReason(m) === null);
      // 엔진처럼 타마다 난수를 따로 굴린 총 데미지
      const rollTotal = (parts, defStat) =>
        parts.hitPowers.reduce((sum, power, i) => sum + fm.integerHitDamage(parts, power, defStat, (85 + Math.floor(rnd() * 16)) / 100, i === 0, parts.firstHitFinalMultiplier ?? 1), 0);
      const counts = { triedDef: 0, okDef: 0, okAtk: 0, noHits: 0, maxMs: 0 };
      // 방어 역산: 내가 입힌 다단히트의 %
      const checkDealt = (c) => {
        const res = ev.evaluateSlotMatchup(c.mySlot, c.move, c.oppTrue, { multiHitCount: c.hits, skipVerdict: true });
        if (!res?.damageParts || res.damageParts.typeEffectiveness === 0) return;
        const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(c.opp.id), c.oppTrue).baseStats, c.oppTrue.points, c.oppTrue.nature);
        const dmg = rollTotal(res.damageParts, res.defenseStat);
        if (dmg >= oppReal.hp) return;
        counts.triedDef++;
        const t0 = performance.now();
        const obs = { move: c.move, critical: false, before: 100, after: inf.displayPercent(oppReal.hp - dmg, oppReal.hp), hits: c.hits };
        const r = inf.inferDefense({ attacker: c.mySlot, defender: slot(c.opp.id), observations: [obs] }, false);
        counts.maxMs = Math.max(counts.maxMs, performance.now() - t0);
        const defKey = res.damageParts.defenseKey;
        if (r.status === "ok" && within(r.hp, c.truth.hp) && within(r[defKey], c.truth[defKey])) counts.okDef++;
        else fail(`다단히트 방어 역산 왕복에서 진짜 배분이 빠짐: ${c.move.id} ${c.hits}타 opp=${c.opp.id} truth=${JSON.stringify(c.truth)} status=${r.status}`);
        if (c.range.min === c.range.max) return;
        const none = inf.inferDefense({ attacker: c.mySlot, defender: slot(c.opp.id), observations: [{ ...obs, hits: undefined }] }, false);
        if (none.observationErrors[0] === null) fail(`타수 없는 다단히트가 오류가 아님: ${c.move.id}`);
        else counts.noHits++;
      };
      // 공격 역산: 상대가 쓴 다단히트로 내가 입은 정확한 데미지
      const checkReceived = (c) => {
        const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(c.mySlot.pokemonId), c.mySlot).baseStats, c.mySlot.points, c.mySlot.nature);
        const res = ev.evaluateSlotMatchup(c.oppTrue, c.move, c.mySlot, { multiHitCount: c.hits, defenderHpIsFull: true, skipVerdict: true });
        if (!res?.damageParts || res.damageParts.typeEffectiveness === 0) return;
        const dmg = rollTotal(res.damageParts, res.defenseStat);
        if (dmg >= myReal.hp) return;
        const obs = { move: c.move, critical: false, hpBefore: myReal.hp, hpAfter: myReal.hp - dmg, hits: c.hits };
        const r = ai.inferAttack({ attacker: slot(c.opp.id), defender: c.mySlot, observations: [obs] }, false);
        const key = c.move.category === "special" ? "spa" : "atk";
        if (r.status === "ok" && within(r[key], c.truth[key])) counts.okAtk++;
        else fail(`다단히트 공격 역산 왕복에서 진짜 값이 빠짐: ${c.move.id} ${c.hits}타 opp=${c.opp.id} truth=${JSON.stringify(c.truth)} status=${r.status}`);
      };
      for (let t = 0; t < 120; t++) {
        const move = pick(multi);
        const range = inf.multiHitRange(move);
        const opp = pick(species);
        const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33), nature: pick(natureIds) };
        const c = {
          move,
          range,
          hits: range.min + Math.floor(rnd() * (range.max - range.min + 1)),
          opp,
          truth,
          oppTrue: slot(opp.id, { points: pts(truth), nature: truth.nature }),
          mySlot: slot(pick(species).id, { points: pts({ hp: 32, atk: 32, spa: 32, spe: 10, def: 10, spd: 10 }), nature: pick(natureIds) }),
        };
        checkDealt(c);
        checkReceived(c);
      }
      console.log(`다단히트 왕복 방어 ${counts.okDef}/${counts.triedDef} · 공격 ${counts.okAtk}건 통과 · 타수 누락 오류 ${counts.noHits}건 · 방어 계산 최대 ${counts.maxMs.toFixed(0)}ms`);
      if (counts.triedDef === 0) fail("다단히트 왕복 시행이 0건");
    }

    // 방어·공격·스피드 세 쪽 결합 왕복 — 세 종류 관측을 진짜 배분으로 만들어 합쳐도 진짜 값이 남고, 각각보다 후보가 늘지 않는다
    const cb3 = await server.ssrLoadModule("/src/lib/combinedInference.ts");
    let tried3 = 0;
    let ok3 = 0;
    let speNarrowed = 0;
    let floorUsed = 0;
    let maxMs3 = 0;
    let maxRounds3 = 0;
    for (let t = 0; t < 300; t++) {
      const v = () => Math.floor(rnd() * (rnd() < 0.5 ? 33 : 11));
      const opp = pick(species);
      const truth = { hp: v(), def: v(), spd: v(), atk: v(), spa: v(), spe: v(), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd + truth.atk + truth.spa + truth.spe > 66) continue;
      // 합계 66은 항상 다 쓴다(사용자 결정, 3.3 V5 포인트 하한) — 모자란 만큼 32 미만인 스탯에 무작위로 채운다
      for (let left = 66 - (truth.hp + truth.def + truth.spd + truth.atk + truth.spa + truth.spe); left > 0; ) {
        const k = pick(["hp", "def", "spd", "atk", "spa", "spe"]);
        if (truth[k] < 32) {
          truth[k]++;
          left--;
        }
      }
      const oppTrue = slot(opp.id, { points: pts(truth), nature: truth.nature });
      const mySlot = slot(pick(species).id, { points: pts({ hp: 32, atk: 32, spa: 32, spe: Math.floor(rnd() * 33), def: Math.floor(rnd() * 20), spd: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot).baseStats, mySlot.points, mySlot.nature);
      const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(opp.id), oppTrue).baseStats, oppTrue.points, oppTrue.nature);
      const dealt = [];
      let oppHp = oppReal.hp;
      for (const cat of ["physical", "special"]) {
        const made = makeObservation(usable.filter((m) => m.category === cat), mySlot, oppTrue, oppReal, oppHp);
        if (!made) continue;
        dealt.push(made.observation);
        oppHp -= made.damage;
      }
      const received = [];
      let myHp = myReal.hp;
      for (const cat of ["physical", "special"]) {
        const obs = makeAttackObservation(attackMoves.filter((m) => m.category === cat), oppTrue, mySlot, myReal.hp, myHp);
        if (!obs) continue;
        received.push(obs);
        myHp = obs.hpAfter;
      }
      if (dealt.length === 0 || received.length === 0) continue;
      const speedObs = Array.from({ length: 4 }, () => {
        const conditions = randomConditions();
        return { first: actualFirst(oppTrue, mySlot, conditions, flatStages), conditions };
      });
      tried3++;
      const defenseInput = { attacker: mySlot, defender: slot(opp.id), observations: dealt };
      const attackInput = { attacker: slot(opp.id), defender: mySlot, observations: received };
      const speedInput = { attacker: slot(opp.id), defender: mySlot, observations: speedObs };
      const s0 = si.inferSpeed(speedInput);
      const t0 = performance.now();
      const c = cb3.inferCombined(defenseInput, attackInput, speedInput);
      maxMs3 = Math.max(maxMs3, performance.now() - t0);
      digestResult(c);
      maxRounds3 = Math.max(maxRounds3, c.rounds);
      if (!c.converged) fail(`3쪽 결합 되풀이가 수렴하지 않고 상한에서 끊김 opp=${opp.id}`);
      const inR = (r, v) => !r || (r.min <= v && v <= r.max);
      const natName = data.NATURES.find((x) => x.id === truth.nature).name;
      const good =
        c.conflict === null && c.parts.length === 3 &&
        inR(c.defense.hp, truth.hp) && inR(c.defense.def, truth.def) && inR(c.defense.spd, truth.spd) &&
        inR(c.attack.atk, truth.atk) && inR(c.attack.spa, truth.spa) && inR(c.speed.spe, truth.spe) &&
        c.natures?.some((n) => n.name === natName) && c.speed.feasible <= s0.feasible;
      if (c.budget && (c.budget.defenseMin > 0 || c.budget.attackMin > 0 || c.budget.speedMin > 0)) floorUsed++;
      if (good) {
        ok3++;
        if (c.speed.feasible < s0.feasible) speNarrowed++;
      } else fail(`3쪽 결합 왕복: 진짜 배분이 빠지거나 후보가 늘었음 opp=${opp.id} truth=${JSON.stringify(truth)} 충돌=${c.conflict}`);
      // 방어+스피드·공격+스피드 두 쪽 결합도 같은 규칙 — 한쪽만 있으면 결합 없이 그대로
      const cd = cb3.inferCombined(defenseInput, null, speedInput);
      const ca = cb3.inferCombined(null, attackInput, speedInput);
      const one = cb3.inferCombined(null, null, speedInput);
      if (cd.conflict !== null || ca.conflict !== null || !inR(cd.speed.spe, truth.spe) || !inR(ca.speed.spe, truth.spe)) fail(`2쪽 결합(스피드)에서 진짜 값이 빠짐 opp=${opp.id}`);
      if (one.natures !== null || one.budget !== null || one.parts.join() !== "speed") fail("스피드 한쪽만 있을 때 결합이 일어남");
    }
    console.log(`방어·공격·스피드 결합 왕복 ${ok3}/${tried3} 통과 · 스피드 후보가 줄어든 사례 ${speNarrowed}건 · 포인트 하한이 걸린 사례 ${floorUsed}건 · 최대 ${maxMs3.toFixed(0)}ms · 되풀이 최대 ${maxRounds3}번`);
    if (tried3 === 0) fail("3쪽 결합 왕복 시행이 0건");
    if (maxMs3 > 5000) fail(`3쪽 결합이 너무 느림(${maxMs3.toFixed(0)}ms)`);
  }
}
