// 3.1 C2-b 공격 역산 왕복
export default async function ({ server, data, inf, ev, stat, form, fm, ai, rnd, pick, pts, usable, species, natureIds, within, slot, makeObservation, attackMoves, makeAttackObservation, fail, digestResult }) {
  // 3.1 C2-b) 공격 역산 왕복 — 진짜 공격 배분(포인트·성격)으로 "받은 데미지" 관측을 만들어 넣으면 진짜 값이 후보에 남는지.
  // 내 포켓몬(방어자)은 능력을 전부 아는 쪽, 상대 공격(특공) 포인트·성격을 역산한다.
  {
    let ok = 0;
    let tried = 0;
    let sumWidth = 0;
    let sumRealWidth = 0;
    let sumCombos = 0;
    let rangeCount = 0;
    const addWidths = (result) => {
      for (const [r, real] of [[result.atk, result.realAtk], [result.spa, result.realSpa]]) {
        if (!r) continue;
        sumWidth += r.max - r.min;
        sumRealWidth += real.max - real.min;
        rangeCount++;
      }
    };
    // 같은 종류(물리) 관측을 k개 모았을 때 실수치 범위가 얼마나 좁아지는지(관측이 늘수록 좁아져야 한다)
    const narrowing = (k) => {
      let width = 0;
      let count = 0;
      for (let t = 0; t < 40; t++) {
        const opp = pick(species);
        const oppTrue = slot(opp.id, { points: pts({ atk: Math.floor(rnd() * 33) }), nature: pick(natureIds) });
        const mySlot = slot(pick(species).id, { points: pts({ hp: 32, def: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
        const myMax = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot).baseStats, mySlot.points, mySlot.nature).hp;
        const obs = [];
        for (let i = 0; i < k; i++) {
          // 매 관측 전에 HP를 가득 채운 상태로(회복했다고 보고) 독립 관측을 만든다
          const o = makeAttackObservation(attackMoves.filter((m) => m.category === "physical"), oppTrue, mySlot, myMax, myMax);
          if (o) obs.push(o);
        }
        if (obs.length < k) continue;
        const r = ai.inferAttack({ attacker: slot(opp.id), defender: mySlot, observations: obs });
        if (r?.realAtk) {
          width += r.realAtk.max - r.realAtk.min;
          count++;
        }
      }
      return count ? width / count : NaN;
    };
    for (let t = 0; t < 120; t++) {
      const opp = pick(species);
      const mine = pick(species);
      const truth = { atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33), nature: pick(natureIds) };
      const oppTrue = slot(opp.id, { points: pts({ atk: truth.atk, spa: truth.spa }), nature: truth.nature });
      const mySlot = slot(mine.id, {
        points: pts({ hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 20), spd: Math.floor(rnd() * 20) }),
        nature: pick(natureIds),
      });
      const myForm = form.getEffectiveForm(data.getPokemon(mine.id), mySlot);
      const myReal = stat.computeRealStats(myForm.baseStats, mySlot.points, mySlot.nature);
      // 물리 1개 + 특수 1개 관측(내 HP가 남는 동안)
      const observations = [];
      let hp = myReal.hp;
      for (const cat of rnd() < 0.5 ? ["physical"] : ["physical", "special"]) {
        const obs = makeAttackObservation(attackMoves.filter((m) => m.category === cat), oppTrue, mySlot, myReal.hp, hp);
        if (!obs) continue;
        observations.push(obs);
        hp = obs.hpAfter;
      }
      if (observations.length === 0) continue;
      tried++;
      const result = ai.inferAttack({ attacker: slot(opp.id), defender: mySlot, observations });
      const nat = data.NATURES.find((n) => n.id === truth.nature);
      const inAtk = !result?.atk || (result.atk.min <= truth.atk && truth.atk <= result.atk.max);
      const inSpa = !result?.spa || (result.spa.min <= truth.spa && truth.spa <= result.spa.max);
      const groupOk = result?.groups.some((g) => g.feasible > 0 && g.natureNames.includes(nat.name));
      if (result?.status === "ok" && inAtk && inSpa && groupOk) {
        ok++;
        addWidths(result);
        sumCombos += result.groups.filter((g) => g.feasible > 0).length;
      } else fail(`공격 역산 왕복: 진짜 배분이 빠짐 opp=${opp.id} truth=${JSON.stringify(truth)} 상태=${result?.status} atk=${JSON.stringify(result?.atk)} spa=${JSON.stringify(result?.spa)}`);
    }
    console.log(
      `공격 역산 왕복 ${ok}/${tried} 통과 · 스탯 하나당 평균 포인트 범위 폭 ${(sumWidth / Math.max(1, rangeCount)).toFixed(1)} · 실수치 범위 폭 ${(sumRealWidth / Math.max(1, rangeCount)).toFixed(1)} · 남은 성격 묶음 ${(sumCombos / Math.max(1, ok)).toFixed(1)}개`,
    );
    if (tried === 0) fail("공격 역산 왕복 시행이 0건");
    const w1 = narrowing(1);
    const w3 = narrowing(3);
    const w6 = narrowing(6);
    console.log(`공격 역산 관측 수별 실수치 범위 폭(물리, 평균): 1회 ${w1.toFixed(1)} · 3회 ${w3.toFixed(1)} · 6회 ${w6.toFixed(1)}`);
    if (!(w3 < w1 && w6 < w3)) fail("공격 역산: 관측이 늘어도 범위가 좁아지지 않음");
    // 메가 전→후 혼합: 같은 공격 배분으로 메가 전(첫 관측)·메가 후(둘째 관측, 메가폼 공격 종족값·특성)에 맞은 기록이 진짜 값을 남기는지,
    // 태그를 떼면(둘 다 메가 전으로 계산) 진짜 값이 빠지는 사례가 있는지(=관측별 폼이 실제로 쓰이는지)
    const megaSpecies = species.filter((p) => p.megaEvolutions?.length);
    let megaOk = 0;
    let megaTried = 0;
    let untaggedMissed = 0;
    for (let t = 0; t < 80; t++) {
      const poke = pick(megaSpecies);
      const mega = pick(poke.megaEvolutions);
      const truth = { atk: Math.floor(rnd() * 33), nature: pick(natureIds) };
      const pre = slot(poke.id, { points: pts({ atk: truth.atk }), nature: truth.nature });
      const post = slot(poke.id, { points: pts({ atk: truth.atk }), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
      const mySlot = slot(pick(species).id, { points: pts({ hp: 32, def: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myMax = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot).baseStats, mySlot.points, mySlot.nature).hp;
      const physical = attackMoves.filter((m) => m.category === "physical");
      const first = makeAttackObservation(physical, pre, mySlot, myMax, myMax);
      const second = first && makeAttackObservation(physical, post, mySlot, myMax, first.hpAfter);
      if (!second) continue;
      megaTried++;
      const observations = [first, { ...second, megaForm: mega.form }];
      const mixed = ai.inferAttack({ attacker: slot(poke.id), defender: mySlot, observations });
      if (mixed?.status === "ok" && mixed.atk.min <= truth.atk && truth.atk <= mixed.atk.max) megaOk++;
      else fail(`공격 역산 메가 혼합: 진짜 값이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${mixed?.status}`);
      // 3.1 L1-b) 메가 전·후 나란히: 폼별 종족값으로 환산한 진짜 공격 실수치가 범위에 있어야 한다
      const fv = mixed?.formViews ?? [];
      if (
        fv.length !== 2 || fv[1].form !== mega.form ||
        !within(fv[0].real.atk, stat.computeRealStats(poke.baseStats, pre.points, pre.nature).atk) ||
        !within(fv[1].real.atk, stat.computeRealStats(mega.baseStats, post.points, post.nature).atk)
      ) fail(`메가 전·후 나란히(공격): 폼별 진짜 실수치가 범위에 없음 ${mega.form} truth=${JSON.stringify(truth)}`);
      const untagged = ai.inferAttack({ attacker: slot(poke.id), defender: mySlot, observations: observations.map((o) => ({ ...o, megaForm: undefined })) });
      if (untagged?.status !== "ok" || untagged.atk.min > truth.atk || truth.atk > untagged.atk.max) untaggedMissed++;
    }
    console.log(`공격 역산 메가 전→후 혼합 ${megaOk}/${megaTried} 통과 · 태그 없이는 진짜 값이 빠진 경우 ${untaggedMissed}건`);
    if (megaTried === 0) fail("공격 역산 메가 혼합 시행이 0건");
    if (untaggedMissed === 0) fail("공격 역산 메가 혼합: 태그 유무 차이가 전혀 없음(태그가 반영되지 않는 듯)");
    const badForm = ai.inferAttack({
      attacker: slot("한카리아스"),
      defender: slot("망나뇽", { points: pts({ hp: 20 }) }),
      observations: [{ move: data.getMove("지진"), critical: false, hpBefore: 100, hpAfter: 50, megaForm: "없는폼" }],
    });
    if (badForm?.status !== "invalid" || !badForm.observationErrors[0]?.includes("메가폼")) fail("공격 역산: 없는 메가폼 태그가 invalid로 안 잡힘");
    // 공격 보정 후보 목록(화면의 "상대 공격 보정 특성·도구 가정") — 대표 항목이 들어 있고 방어 후보(반감 열매 등)는 섞이지 않는다
    const atkItems = new Set(ai.ATTACK_ITEM_CANDIDATES.map((i) => i.id));
    const atkAbilities = new Set(ai.ATTACK_ABILITY_CANDIDATES.map((x) => x.id));
    if (!["생명의구슬", "달인의띠", "힘의머리띠", "박식안경", "실크스카프"].every((id) => atkItems.has(id)) || ai.ATTACK_ITEM_CANDIDATES.some((i) => i.resistsSuperEffectiveType !== undefined)) {
      fail("공격 보정 도구 후보가 이상함");
    }
    if (!["테크니션", "근성", "천하장사", "맹화"].every((id) => atkAbilities.has(id))) fail("공격 보정 특성 후보가 이상함");
    console.log(`공격 보정 후보: 도구 ${atkItems.size}종 · 특성 ${atkAbilities.size}종`);
    // 방어·공격 결합(성격 공유 + 포인트 예산): 같은 상대의 진짜 배분으로 두 종류 관측을 만들어 결합해도 진짜 값이 남고,
    // 결합 전(각각)보다 후보가 늘지 않으며, 실제로 좁아지는 사례가 있는지
    const cb = await server.ssrLoadModule("/src/lib/combinedInference.ts");
    let cbTried = 0;
    let cbOk = 0;
    let defNarrowed = 0;
    let atkNarrowed = 0;
    let sumNaturesBefore = 0;
    let sumMs = 0;
    let maxMs = 0;
    let maxRounds = 0;
    let sumNaturesAfter = 0;
    for (let t = 0; t < 200; t++) {
      const opp = pick(species);
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), atk: Math.floor(rnd() * 33), spa: Math.floor(rnd() * 33), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd + truth.atk + truth.spa > 66) continue;
      const oppTrue = slot(opp.id, { points: pts(truth), nature: truth.nature });
      const mySlot = slot(pick(species).id, { points: pts({ hp: 32, atk: 32, spa: 32, def: Math.floor(rnd() * 20), spd: Math.floor(rnd() * 20) }), nature: pick(natureIds) });
      const myForm = form.getEffectiveForm(data.getPokemon(mySlot.pokemonId), mySlot);
      const myReal = stat.computeRealStats(myForm.baseStats, mySlot.points, mySlot.nature);
      const oppReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(opp.id), oppTrue).baseStats, oppTrue.points, oppTrue.nature);
      // 방어 쪽: 내가 입힌 데미지(물리+특수), 공격 쪽: 내가 받은 데미지(물리+특수)
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
      cbTried++;
      const defenseInput = { attacker: mySlot, defender: slot(opp.id), observations: dealt };
      const attackInput = { attacker: slot(opp.id), defender: mySlot, observations: received };
      const d0 = inf.inferDefense(defenseInput);
      const a0 = ai.inferAttack(attackInput);
      const t0 = performance.now();
      const c = cb.inferCombined(defenseInput, attackInput);
      const ms = performance.now() - t0;
      digestResult(c);
      maxRounds = Math.max(maxRounds, c.rounds);
      if (!c.converged) fail(`결합 되풀이가 수렴하지 않고 상한에서 끊김 opp=${opp.id}`);
      sumMs += ms;
      maxMs = Math.max(maxMs, ms);
      const inR = (r, v) => !r || (r.min <= v && v <= r.max);
      const okAll =
        c.conflict === null && c.defense?.status === "ok" && c.attack?.status === "ok" &&
        inR(c.defense.hp, truth.hp) && inR(c.defense.def, truth.def) && inR(c.defense.spd, truth.spd) &&
        inR(c.attack.atk, truth.atk) && inR(c.attack.spa, truth.spa) &&
        c.natures?.some((n) => n.name === data.NATURES.find((x) => x.id === truth.nature).name) &&
        c.defense.feasible <= d0.feasible && c.attack.feasible <= a0.feasible;
      if (okAll) {
        cbOk++;
        if (c.defense.feasible < d0.feasible) defNarrowed++;
        if (c.attack.feasible < a0.feasible) atkNarrowed++;
        sumNaturesBefore += data.NATURES.filter((n) => d0.groups.some((g) => g.feasible > 0 && g.natureNames.includes(n.name))).length;
        sumNaturesAfter += c.natures.length;
      } else fail(`결합 왕복: 진짜 배분이 빠지거나 후보가 늘었음 opp=${opp.id} truth=${JSON.stringify(truth)} 충돌=${c.conflict} 방어=${c.defense?.status} 공격=${c.attack?.status}`);
    }
    console.log(
      `방어·공격 결합 왕복 ${cbOk}/${cbTried} 통과 · 후보가 줄어든 사례 방어 ${defNarrowed}건·공격 ${atkNarrowed}건 · 성격 후보 평균 ${(sumNaturesBefore / Math.max(1, cbOk)).toFixed(1)}개(방어 쪽만) → ${(sumNaturesAfter / Math.max(1, cbOk)).toFixed(1)}개(결합)`,
    );
    if (cbTried === 0) fail("방어·공격 결합 왕복 시행이 0건");
    console.log(`방어·공격 결합 계산 시간: 평균 ${(sumMs / Math.max(1, cbTried)).toFixed(0)}ms · 최대 ${maxMs.toFixed(0)}ms · 되풀이 최대 ${maxRounds}번`);
    if (maxMs > 5000) fail(`방어·공격 결합이 너무 느림(${maxMs.toFixed(0)}ms)`);
    if (defNarrowed + atkNarrowed === 0) fail("방어·공격 결합: 후보가 줄어든 사례가 전혀 없음(결합이 반영되지 않는 듯)");
    // 일부러 틀린 관측(불가능한 데미지)은 모순이어야 한다
    const mine = slot("한카리아스", { points: pts({ hp: 20 }), nature: "조심" });
    const myMax = stat.computeRealStats(form.getEffectiveForm(data.getPokemon("한카리아스"), mine).baseStats, mine.points, mine.nature).hp;
    const contradiction = ai.inferAttack({
      attacker: slot("망나뇽"),
      defender: mine,
      observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: myMax, hpAfter: myMax - 3 }],
    });
    const faint = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: 30, hpAfter: 0 }] });
    const badHp = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: myMax + 5, hpAfter: 10 }] });
    const noMove = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("자이로볼"), critical: false, hpBefore: myMax, hpAfter: myMax - 40 }] });
    if (contradiction?.status !== "contradiction") fail(`공격 역산: 불가능한 데미지가 ${contradiction?.status}`);
    // 쓰러진 공격(3.6 I1-e): 데미지가 맞기 전 HP 이상이라는 부등식 — 가능한 쓰러짐은 ok, 풀피에서 한 방에 쓰러질 수 없는 조합은 모순, 다단히트는 invalid
    const faintFull = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("아이언헤드"), critical: false, hpBefore: myMax, hpAfter: 0 }] });
    const faintMulti = ai.inferAttack({ attacker: slot("망나뇽"), defender: mine, observations: [{ move: data.getMove("더블어택"), critical: false, hpBefore: 30, hpAfter: 0, hits: 2 }] });
    if (faint?.status !== "ok") fail(`공격 역산: 쓰러진 관측이 ok가 아님(${faint?.status})`);
    if (faintFull?.status !== "contradiction") fail(`공격 역산: 풀피에서 한 방에 쓰러지는 관측이 ${faintFull?.status}`);
    if (faintMulti?.status !== "invalid" || !faintMulti.observationErrors[0]?.includes("쓰러진 다단히트")) fail("공격 역산: 쓰러진 다단히트가 invalid로 안 잡힘");
    if (badHp?.status !== "invalid" || !badHp.observationErrors[0]?.includes("최대 HP")) fail("공격 역산: 최대 HP 초과가 invalid로 안 잡힘");
    if (noMove?.status !== "invalid" || !noMove.observationErrors[0]?.includes("스피드")) fail("공격 역산: 스피드 위력 기술이 invalid로 안 잡힘");
    console.log(`공격 역산 예외: 모순 ${contradiction?.status} · 쓰러짐 ${faint?.status} · HP 초과 ${badHp?.status} · 자이로볼 ${noMove?.status}`);
    // 쓰러진 공격 왕복: 진짜 배분이 실제로 쓰러뜨릴 만한 데미지를 낼 때 "맞기 전 HP → 0"으로 넣어도 진짜 값이 후보에 남아야 한다
    {
      // 공용 난수열(rnd)을 쓰면 뒤 시나리오가 바뀌어 결합 결과 해시 대조가 깨지므로 이 블록은 따로 굴린다
      let koSeed = 777;
      const koRnd = () => {
        koSeed = (koSeed * 1664525 + 1013904223) >>> 0;
        return koSeed / 2 ** 32;
      };
      const koPick = (arr) => arr[Math.floor(koRnd() * arr.length)];
      let koTried = 0;
      let koOk = 0;
      for (let t = 0; t < 120; t++) {
        const opp = koPick(species);
        const truthKo = { atk: Math.floor(koRnd() * 33), spa: Math.floor(koRnd() * 33), nature: koPick(natureIds) };
        const oppTrue = slot(opp.id, { points: pts(truthKo), nature: truthKo.nature });
        const my = slot(koPick(species).id, { points: pts({ hp: Math.floor(koRnd() * 33), def: Math.floor(koRnd() * 33), spd: Math.floor(koRnd() * 33) }), nature: koPick(natureIds) });
        const myReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(my.pokemonId), my).baseStats, my.points, my.nature);
        const cat = koRnd() < 0.5 ? "physical" : "special";
        const move = koPick(attackMoves.filter((m) => m.category === cat));
        const res = ev.evaluateSlotMatchup(oppTrue, move, my, { defenderHpIsFull: true, skipVerdict: true });
        const parts = res?.damageParts;
        if (!parts || parts.typeEffectiveness === 0) continue;
        const damage = fm.integerTotalDamage(parts, res.defenseStat, (85 + Math.floor(koRnd() * 16)) / 100);
        const hpBefore = 1 + Math.floor(koRnd() * Math.min(damage, myReal.hp));
        const input = (hpAfter) => ({ attacker: slot(opp.id), defender: my, observations: [{ move, critical: false, hpBefore, hpAfter }] });
        const ko = ai.inferAttack(input(0));
        koTried++;
        const r = ko?.[cat === "physical" ? "atk" : "spa"];
        if (ko?.status === "ok" && within(r, truthKo[cat === "physical" ? "atk" : "spa"])) koOk++;
        else fail(`쓰러진 공격 왕복: 진짜 값이 빠짐 opp=${opp.id} ${move.id} hp ${hpBefore}→0 상태=${ko?.status}`);
      }
      if (koTried === 0) fail("쓰러진 공격 왕복 시행이 0건");
      console.log(`쓰러진 공격 왕복 ${koOk}/${koTried} 통과`);
    }
  }
}
