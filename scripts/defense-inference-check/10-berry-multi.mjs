// 4.0 F2 자뭉열매·F3 내구 조정 여러 공격
export default async function ({ server, trials, data, inf, ev, stat, form, fm, rnd, pick, pts, usable, species, natureIds, slot, makeObservation, fail }) {
  // 4.0 F2) 자뭉열매 — 맞은 뒤 HP가 1/2 이하라 먹으면 화면 %에는 회복(최대 HP÷4)이 섞인다. 켠 채로 넣은 기록이 진짜 배분을 남기는지,
  // 켜지 않으면 모순돼 진짜 배분이 빠지는 경우가 실제로 있는지, 절반 초과인데 켜거나 두 번 켜면 거부되는지
  {
    let ok = 0;
    let tried = 0;
    let dropped = 0;
    for (let t = 0; t < trials * 6 && tried < 40; t++) {
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const defId = pick(species).id;
      const truth = { hp: Math.floor(rnd() * 33), def: Math.floor(rnd() * 33), spd: 0, nature: pick(natureIds) };
      const defTrue = slot(defId, { points: pts(truth), nature: truth.nature });
      const dReal = stat.computeRealStats(form.getEffectiveForm(data.getPokemon(defId), defTrue).baseStats, defTrue.points, defTrue.nature);
      const first = makeObservation(usable.filter((m) => m.category === "physical"), atk, defTrue, dReal, dReal.hp);
      if (!first) continue;
      const hpHit = dReal.hp - first.damage;
      if (hpHit * 2 > dReal.hp) continue; // 절반 이하로 맞은 경우만 먹는다
      const hpEaten = Math.min(dReal.hp, hpHit + Math.floor(dReal.hp / 4));
      const second = makeObservation(usable.filter((m) => m.category === "physical"), atk, defTrue, dReal, hpEaten, true);
      if (!second) continue;
      tried++;
      const observations = [{ ...first.observation, after: inf.displayPercent(hpEaten, dReal.hp), endTurn: ["sitrus"] }, second.observation];
      const withBerry = inf.inferDefense({ attacker: atk, defender: slot(defId), observations });
      if (withBerry?.status === "ok" && withBerry.hp.min <= truth.hp && truth.hp <= withBerry.hp.max && withBerry.def.min <= truth.def && truth.def <= withBerry.def.max) ok++;
      else fail(`자뭉열매 왕복: 진짜 배분이 빠짐 truth=${JSON.stringify(truth)} 상태=${withBerry?.status}`);
      const without = inf.inferDefense({ attacker: atk, defender: slot(defId), observations: observations.map((o) => ({ ...o, endTurn: undefined })) });
      if (without?.status !== "ok" || without.hp.min > truth.hp || truth.hp > without.hp.max) dropped++;
      // 두 줄 다 켜면 거부, 절반 초과로 맞은 줄에 켜면 후보가 없다
      const twice = inf.inferDefense({ attacker: atk, defender: slot(defId), observations: observations.map((o) => ({ ...o, endTurn: ["sitrus"] })) });
      if (!twice || twice.observationErrors.every((e) => !e)) fail("자뭉열매를 두 줄에 켜도 거부되지 않음");
    }
    console.log(`자뭉열매 왕복 ${ok}/${tried} 통과 · 열매를 빼면 어긋나는 경우 ${dropped}건`);
    if (tried < 10) fail("자뭉열매 왕복 시행 부족");
    if (dropped === 0) fail("열매를 빼도 항상 맞으면 열매가 쓰이는지 알 수 없음");
    // 절반 초과 입력: 100% → 70%에 열매를 켜면 어떤 HP로도 불가능
    const sample = slot(pick(species).id);
    const impossible = inf.inferDefense({ attacker: slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }) }), defender: sample, observations: [{ move: pick(usable), critical: false, before: 100, after: 70, endTurn: ["sitrus"] }] });
    if (impossible?.status === "ok") fail("절반 초과로 맞은 줄에 자뭉열매를 켰는데 가능으로 나옴");
    // 메가진화하는 포켓몬은 메가스톤을 들어 도구 효과(자뭉열매·먹다남은음식)가 무시된다 — 켜든 안 켜든 결과가 같다
    const megaSpecies = data.POKEMON.find((p) => p.megaEvolutions?.length);
    const megaForm = megaSpecies.megaEvolutions[0].form;
    const megaAtk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }) });
    const megaObs = (endTurn) => [{ move: pick(usable.filter((m) => m.category === "physical")), critical: false, before: 100, after: 70, megaForm, endTurn }];
    const megaMove = megaObs(undefined)[0].move;
    const run = (endTurn) => JSON.stringify(inf.inferDefense({ attacker: megaAtk, defender: slot(megaSpecies.id), observations: [{ ...megaObs(endTurn)[0], move: megaMove }] })?.hp);
    if (run(["sitrus", "leftovers"]) !== run(undefined)) fail("메가 관측에서 도구 효과가 무시되지 않음");
  }
  // 4.0 F3) 내구 조정 여러 공격 — 공격 2~3개(물리·특수 섞음)를 모두 맞고도 버티는 조합: 각 조합의 버틸 확률이 16단계 난수 전수 곱 계산과 같고,
  // 이 HP에서 합이 더 적은 조합이 없으며, 확정일 때 전체 최소 합이 33³칸 전수 탐색과 같다
  {
    const bulk = await server.ssrLoadModule("/src/lib/bulkAdjust.ts");
    // 독립 계산: 공격별 난수 분포를 전수로 곱해 총합이 hp 미만일 확률
    const survivalBrute = (list, real) => {
      let dist = new Map([[0, 1]]);
      for (const p of list) {
        const set = fm.damageRollSet(p, real[p.defenseKey]);
        const next = new Map();
        for (const [v0, w0] of dist) set.values.forEach((v, k) => next.set(v0 + v, (next.get(v0 + v) ?? 0) + w0 * (set.probs ? set.probs[k] : 1 / set.values.length)));
        dist = next;
      }
      return [...dist].reduce((sum, [v, w]) => sum + (v < real.hp ? w : 0), 0);
    };
    // hp 구간 안에서 목표 확률을 넘는 가장 작은 세 포인트 합(없으면 Infinity)
    const searchMin = (ctx, target, hpFrom, hpTo) => {
      let best = Infinity;
      for (let hp = hpFrom; hp <= hpTo; hp++) {
        for (let d = 0; d <= (ctx.usesDef ? 32 : 0); d++) {
          for (let sp = 0; sp <= (ctx.usesSpd ? 32 : 0) && hp + d + sp < best; sp++) {
            if (survivalBrute(ctx.list, ctx.realAt(hp, d, sp)) >= target - 1e-9) best = hp + d + sp;
          }
        }
      }
      return best;
    };
    const checkTarget = (ctx, target) => {
      const opts = bulk.bulkOptions(ctx.list, ctx.dForm.baseStats, ctx.mine.nature, ctx.mine.points, target);
      for (const o of opts) {
        const brute = survivalBrute(ctx.list, ctx.realAt(o.hpPoints, o.defPoints, o.spdPoints));
        if (Math.abs(brute - o.survival) > 1e-9 || brute < target - 1e-9) fail(`내구 조정 여러 공격: 확률 불일치 ${ctx.defId} ${o.hpPoints}/${o.defPoints}/${o.spdPoints} ${o.survival} vs ${brute}`);
        if (searchMin(ctx, target, o.hpPoints, o.hpPoints) !== o.hpPoints + o.defPoints + o.spdPoints) fail(`내구 조정 여러 공격: 이 HP의 최소 합이 아님 ${ctx.defId} ${o.hpPoints}/${o.defPoints}/${o.spdPoints} target ${target}`);
      }
      if (target === 1 && (opts.length ? opts[0].hpPoints + opts[0].defPoints + opts[0].spdPoints : Infinity) !== searchMin(ctx, 1, 0, 32)) fail(`내구 조정 여러 공격: 전체 최소 합이 전수와 다름 ${ctx.defId}`);
    };
    let checked = 0;
    let both = 0;
    for (let t = 0; t < 60 && checked < 12; t++) {
      const atk = slot(pick(species).id, { points: pts({ atk: 32, spa: 32 }), nature: pick(natureIds) });
      const defId = pick(species).id;
      const mine = slot(defId, { points: pts({ spe: 10 }), nature: pick(natureIds) });
      const list = Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => ev.evaluateSlotMatchup(atk, pick(usable), mine)?.damageParts).filter((p) => p && p.typeEffectiveness !== 0);
      if (list.length < 2) continue;
      const dForm = form.getEffectiveForm(data.getPokemon(defId), mine);
      const usesDef = list.some((p) => p.defenseKey === "def");
      const usesSpd = list.some((p) => p.defenseKey === "spd");
      const realAt = (hp, d, sp) => stat.computeRealStats(dForm.baseStats, { ...mine.points, hp, def: usesDef ? d : mine.points.def, spd: usesSpd ? sp : mine.points.spd }, mine.nature);
      const ctx = { list, mine, defId, dForm, usesDef, usesSpd, realAt };
      if (usesDef && usesSpd) both++;
      checkTarget(ctx, 1);
      checkTarget(ctx, 0.75);
      checked++;
    }
    console.log(`내구 조정 여러 공격 ${checked}건(방어·특방 둘 다 읽는 경우 ${both}건: 확률 전수 곱·HP별 최소 합·전체 최소 합 전수) ${checked >= 8 && both >= 2 ? "통과" : "시행 부족"}`);
    if (checked < 8 || both < 2) fail("내구 조정 여러 공격 시행 부족");
  }
}
