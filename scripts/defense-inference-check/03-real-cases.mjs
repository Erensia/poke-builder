// 실측 사례·메가폼 상대·메가 전→후 혼합
export default async function ({ data, inf, stat, rnd, pick, pts, usable, species, natureIds, within, slot, makeObservation, fail }) {
  // 2.4 X1) 실측 사례 — 신중 메가갑주무사(HP31·특방32·스피드3, 흡혈) → 한카리아스(HP32·방어12·특방22, 215칸): 215→124(57%)→30(13%).
  // 화면 %가 올림(58%·14%)이 아니라 내림이라는 근거 — 올림 가정이면 이 관측과 맞는 진짜 배분이 빠진다.
  {
    const mega = data.getPokemon("갑주무사").megaEvolutions[0];
    const realAtk = { pokemonId: "갑주무사", ability: mega.ability, item: null, nature: "신중", points: pts({ hp: 31, spd: 32, spe: 3 }), activeMegaForm: mega.form };
    const realDef = slot("한카리아스");
    const move = data.getMove("흡혈");
    const res = inf.inferDefense({
      attacker: realAtk,
      defender: realDef,
      observations: [
        { move, critical: false, before: 100, after: 57 },
        { move, critical: false, before: 57, after: 13 },
      ],
    });
    if (inf.displayPercent(124, 215) !== 57 || inf.displayPercent(30, 215) !== 13 || inf.displayPercent(1, 215) !== 1) fail("화면 % 규칙(내림·최소 1%)이 실측과 다름");
    if (res?.status !== "ok" || res.hpDefGrid[12 * 33 + 32] !== 1) fail("실측 사례: 진짜 배분(HP32·방어12)이 후보에서 빠짐");
    else console.log("실측 사례 통과 (215→124→30, 57%·13%)");
  }

  // 2.2 C3) 메가폼 상대 — 메가 종족값·고정 특성으로 만든 관측이 메가 지정 역산에서 진짜 배분을 남기는지
  {
    const megaSpecies = data.POKEMON.filter((p) => p.megaEvolutions?.length);
    let megaOk = 0;
    let megaTried = 0;
    for (let t = 0; t < 60; t++) {
      const poke = pick(megaSpecies);
      const mega = pick(poke.megaEvolutions);
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd > 66) continue;
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const defTrue = slot(poke.id, { points: pts(truth), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
      const dReal = stat.computeRealStats(mega.baseStats, defTrue.points, defTrue.nature);
      const made = makeObservation(usable.filter((m) => m.category === "physical"), atk, defTrue, dReal, dReal.hp);
      if (!made) continue;
      megaTried++;
      const asMega = inf.inferDefense({ attacker: atk, defender: slot(poke.id, { activeMegaForm: mega.form, ability: mega.ability }), observations: [made.observation] });
      if (asMega?.status === "ok" && asMega.hp.min <= truth.hp && truth.hp <= asMega.hp.max && asMega.def.min <= truth.def && truth.def <= asMega.def.max) megaOk++;
      else fail(`메가 왕복: 진짜 배분이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${asMega?.status}`);
    }
    console.log(`메가 왕복 ${megaOk}/${megaTried} 통과`);
    if (megaTried === 0) fail("메가 왕복 시행이 0건");
  }

  // 2.5 L1) 메가 전→후 혼합 — 같은 포인트 배분으로 메가 전(첫 관측)·메가 후(둘째 관측)를 맞은 기록이 진짜 배분을 남기는지,
  // 그리고 메가 후 관측을 메가 전 폼으로 잘못 계산하면 진짜 배분이 빠지는지(=관측별 폼 태그가 실제로 쓰이는지)
  {
    const megaSpecies = data.POKEMON.filter((p) => p.megaEvolutions?.length && p.megaEvolutions.some((m) => m.baseStats.hp === p.baseStats.hp));
    let mixOk = 0;
    let mixTried = 0;
    let untaggedMissed = 0;
    for (let t = 0; t < 80; t++) {
      const poke = pick(megaSpecies);
      const mega = pick(poke.megaEvolutions.filter((m) => m.baseStats.hp === poke.baseStats.hp));
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: Math.floor(rnd() * 33), nature: pick(natureIds) };
      if (truth.hp + truth.def + truth.spd > 66) continue;
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const pre = slot(poke.id, { points: pts(truth), nature: truth.nature });
      const post = slot(poke.id, { points: pts(truth), nature: truth.nature, activeMegaForm: mega.form, ability: mega.ability });
      const preReal = stat.computeRealStats(poke.baseStats, pre.points, pre.nature);
      const postReal = stat.computeRealStats(mega.baseStats, post.points, post.nature);
      const physical = usable.filter((m) => m.category === "physical");
      const first = makeObservation(physical, atk, pre, preReal, preReal.hp);
      if (!first) continue;
      const second = makeObservation(physical, atk, post, postReal, preReal.hp - first.damage, true);
      if (!second) continue;
      mixTried++;
      const observations = [first.observation, { ...second.observation, megaForm: mega.form }];
      const mixed = inf.inferDefense({ attacker: atk, defender: slot(poke.id), observations });
      if (mixed?.status === "ok" && mixed.hpDefGrid[truth.def * 33 + truth.hp] === 1) mixOk++;
      else fail(`메가 전→후 혼합: 진짜 배분이 빠짐 ${mega.form} truth=${JSON.stringify(truth)} 상태=${mixed?.status}`);
      // 3.1 L1-b) 메가 전·후 나란히: 폼마다 그 폼의 종족값으로 환산한 진짜 실수치·내구 지수가 범위에 들어야 한다
      const fv = mixed?.formViews ?? [];
      const bulkPre = preReal.hp * preReal.def;
      const bulkPost = postReal.hp * postReal.def;
      if (
        fv.length !== 2 || fv[0].form !== "" || fv[1].form !== mega.form ||
        !within(fv[0].real.def, preReal.def) || !within(fv[1].real.def, postReal.def) ||
        !within(fv[1].real.hp, postReal.hp) || fv[0].real.spd !== undefined ||
        !within(fv[0].bulkPhysical?.support, bulkPre) || !within(fv[1].bulkPhysical?.support, bulkPost)
      ) fail(`메가 전·후 나란히(방어): 폼별 진짜 실수치가 범위에 없음 ${mega.form} truth=${JSON.stringify(truth)} 폼=${fv.map((v) => v.form).join("|")}`);
      // 태그를 떼면(둘 다 메가 전으로 계산) 방어 종족값이 다른 경우 진짜 배분이 빠지거나 모순이 나야 한다 — 빠지는 사례가 하나라도 있어야 태그가 의미 있다
      const untagged = inf.inferDefense({ attacker: atk, defender: slot(poke.id), observations: observations.map((o) => ({ ...o, megaForm: undefined })) });
      if (untagged?.status !== "ok" || untagged.hpDefGrid[truth.def * 33 + truth.hp] !== 1) untaggedMissed++;
    }
    console.log(`메가 전→후 혼합 ${mixOk}/${mixTried} 통과 · 태그 없이는 진짜 배분이 빠진 경우 ${untaggedMissed}건`);
    if (mixTried === 0) fail("메가 전→후 혼합 시행이 0건");
    if (untaggedMissed === 0) fail("메가 전→후 혼합: 태그 유무 차이가 전혀 없음(태그가 반영되지 않는 듯)");
    const bad = inf.inferDefense({ attacker: slot("한카리아스"), defender: slot("갑주무사"), observations: [{ move: data.getMove("지진"), critical: false, before: 100, after: 50, megaForm: "없는폼" }] });
    if (bad?.status !== "invalid" || !bad.observationErrors[0]?.includes("메가폼")) fail("없는 메가폼 태그가 invalid로 안 잡힘");
  }
}
