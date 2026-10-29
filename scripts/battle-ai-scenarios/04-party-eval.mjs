// 파티 단위 평가(decision-layer §4-5, ver.1.8)
export default async function ({ server, data, ev, ai, dec, pts, mon, battle, check }) {
  // ── 파티 단위 평가(decision-layer §4-5, ver.1.8) ──
  {
    const pe = await server.ssrLoadModule("/src/lib/battle/ai/partyEval.ts");
    const LAMBDA = dec.DEFAULT_DECISION_PARAMS.partyCountWeight;
    const CHAIN = { lambda: LAMBDA, noise: dec.DEFAULT_DECISION_PARAMS.partyDuelNoise };
    // 대면 갈래(duelBranches)를 결정적으로(noise 0) 나누면 HP 교환식(raceValue)과 같은 식인지:
    // (상대 잃은 HP) − (내가 잃은 HP) = raceValue. noise > 0이면 갈래 확률 합 1·여유가 클수록 이길 확률이 큼.
    let mismatch = 0;
    const r = (i, k) => ((i * 7919 + k * 104729) % 1000) / 1000;
    for (let i = 0; i < 3000; i++) {
      const c = i % 17 === 0 ? Infinity : 1 + r(i, 1) * 6;
      const d = i % 23 === 0 ? Infinity : 1 + r(i, 2) * 6;
      const p = [0, 0.5, 1][i % 3];
      const my = 0.05 + r(i, 3) * 0.95;
      const opp = 0.05 + r(i, 4) * 0.95;
      const lost = i % 2;
      const branches = pe.duelBranches([c, d, p, my, opp, lost], 0);
      const hpSwing = branches.reduce((sum, b) => sum + b.weight * (opp - b.opp - (my - b.my)), 0);
      if (Math.abs(hpSwing - dec.raceValue(c, d, p, my, opp, lost)) > 1e-9) mismatch++;
      const soft = pe.duelBranches([c, d, p, my, opp, lost], CHAIN.noise);
      if (Math.abs(soft.reduce((sum, b) => sum + b.weight, 0) - 1) > 1e-9) mismatch++;
    }
    const winChance = (d) => pe.duelBranches([3, d, 0, 1, 1, 0], CHAIN.noise).find((b) => b.opp === 0)?.weight ?? 0;
    check(
      "파티: 대면 갈래 ↔ HP 교환식 일치(3000조합) + 여유가 클수록 승률↑",
      mismatch === 0 && winChance(2.5) < 0.5 && winChance(3.5) > 0.5 && winChance(6) > winChance(3.5),
      `불일치 ${mismatch} 승률 d2.5=${winChance(2.5).toFixed(2)} d3.5=${winChance(3.5).toFixed(2)} d6=${winChance(6).toFixed(2)}`,
    );

    // 상대가 마지막 한 마리일 때 확실히 쓰러뜨리면(내가 선공 1타, 상대는 못 버팀) = HP 교환 + λ
    {
      const st = battle([mon("한카리아스", ["지진"]), mon("메타그로스", ["코멧펀치"])], [mon("핫삼", ["불꽃펀치"], null, null, pts())]);
      const model = pe.createPartyModel(st, "a");
      const v = pe.partyRaceValue({ model, myIndex: 0, myStaged: true }, [1, Infinity, 1, 1, 0.6, 0], CHAIN);
      check("파티: 상대 마지막 한 마리 확정 처치 → 0.6 + λ", Math.abs(v - (0.6 + LAMBDA)) < 1e-9, `v=${v}`);
    }
    // 내가 확실히 쓰러져도(상대에게 피해 0) 대기 포켓몬이 상대를 이기면 값 > −(내 HP) − λ
    {
      const st = battle(
        [mon("잠만보", ["하이퍼보이스"], null, null, pts()), mon("헬가", ["악의파동"], null, null, pts({ spa: 32, spe: 32 }))],
        [mon("팬텀", ["섀도볼"], null, null, pts())],
      );
      const model = pe.createPartyModel(st, "a");
      const v = pe.partyRaceValue({ model, myIndex: 0, myStaged: true }, [Infinity, 1, 0, 1, 1, 0], CHAIN);
      check("파티: 쓰러진 뒤 대기 포켓몬이 이김 → 값 > −1 − λ", v > -1 - LAMBDA, `v=${v.toFixed(3)}`);
    }
    // 교착(서로 피해 0): 노말 기술만 가진 잠만보 vs 고스트 기술만 가진 팬텀 — 상대를 칠 수 있는 대기 포켓몬으로 교체
    {
      const st = battle(
        [mon("잠만보", ["하이퍼보이스", "누르기"], null, null, pts({ hp: 32 })), mon("헬가", ["악의파동"], null, null, pts({ spa: 32, spe: 32 }))],
        [mon("팬텀", ["섀도볼"], null, null, pts()), mon("핫삼", ["불꽃펀치"], null, null, pts())],
      );
      const on = ai.chooseAiAction(st, "a", 0.5);
      check("파티: 교착 대면 → 칠 수 있는 포켓몬으로 교체", on.action.kind === "switch" && on.action.toIndex === 1, JSON.stringify(on.action.kind === "switch" ? on.action : { move: on.action.move.id }));
    }
    // 총대장(AI 보정): 대기 중인 총대장 포켓몬은 "지금 나온다면" 셀 같은 편 기절 수로 위력을 본다
    {
      const make = () =>
        battle(
          [mon("핫삼", ["불꽃펀치"]), mon("메타그로스", ["코멧펀치"]), mon("대도각참", ["아이언헤드"], "총대장", null, pts({ atk: 32, hp: 32 }))],
          [mon("잠만보", ["하이퍼보이스"], null, null, pts({ hp: 32, def: 32 }))],
        );
      const fresh = make();
      const fainted = make();
      fainted.sideA.party[1].currentHp = 0;
      const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
      const rawHits = (st) =>
        md.estimateMoveHits({ state: st, attacker: st.sideA.party[2], defender: st.b, defenderSide: st.sideB, attackerMovesSecond: false }, data.getMove("아이언헤드")).rawHits;
      const h0 = rawHits(fresh);
      const h1 = rawHits(fainted);
      // 두 state의 차이는 같은 편 1마리 기절뿐 — 보정이 없으면 두 값이 같다
      check("총대장 AI: 대기 포켓몬도 기절 수 반영(처치 타수 감소)", h1 < h0, `기절0=${h0.toFixed(3)} 기절1=${h1.toFixed(3)}`);
    }
  }
  // ── 파티 단위 평가 ②(§4-5): 효과를 대면표에 남기기·지속 턴·설치기·방어류 뒤 이어짐 ──
  {
    const pe = await server.ssrLoadModule("/src/lib/battle/ai/partyEval.ts");
    const fx = await server.ssrLoadModule("/src/lib/battle/ai/statusMoveEffects.ts");
    const P = dec.DEFAULT_DECISION_PARAMS;
    const CHAIN = { lambda: P.partyCountWeight, noise: P.partyDuelNoise };
    const threeVsThree = () =>
      battle(
        [mon("메타그로스", ["리플렉터", "코멧펀치", "칼춤"], null, null, pts({ atk: 32, hp: 32 })), mon("핫삼", ["불꽃펀치"]), mon("팬텀", ["섀도볼"])],
        [mon("한카리아스", ["역린", "지진"], null, null, pts({ atk: 32, spe: 32 })), mon("갸라도스", ["폭포오르기"].filter((m) => data.getMove(m))), mon("잠만보", ["누르기"])],
      );
    // 지속 턴 효과: 남은 턴 0이면 효과 없음과 같고, ∞면 대면표를 효과 것으로 바꾼 것과 같다(섞는 식의 양 끝)
    {
      const st = threeVsThree();
      const option = ev.evaluateOptions(st, "a").find((o) => o.move?.id === "리플렉터");
      const eff = option.support.effect.party;
      const inputs = [3, 4, 0.5, 1, 1, 1];
      const none = pe.partyRaceValue(option.party, inputs, CHAIN);
      const zero = pe.partyRaceValue({ ...option.party, effect: { model: eff.model, turns: 0 } }, inputs, CHAIN);
      const inf = pe.partyRaceValue({ ...option.party, effect: { model: eff.model, turns: Infinity } }, inputs, CHAIN);
      const swapped = pe.partyRaceValue({ ...option.party, model: eff.model }, inputs, CHAIN);
      const five = pe.partyRaceValue({ ...option.party, effect: { model: eff.model, turns: 5 } }, inputs, CHAIN);
      check(
        "파티②: 지속 턴 효과 — 0턴 = 효과 없음, ∞턴 = 효과 대면표, 벽 5턴은 그 사이 이상",
        Math.abs(zero - none) < 1e-9 && Math.abs(inf - swapped) < 1e-9 && five >= none - 1e-9 && eff.turns > 0 && eff.turns < 6,
        `없음=${none.toFixed(3)} 0턴=${zero.toFixed(3)} 5턴=${five.toFixed(3)} ∞=${inf.toFixed(3)} 옵션 턴=${eff.turns}`,
      );
    }
    // 랭크업: 이어지는 대면도 올린 랭크로(효과 대면표 = 랭크업 state)
    {
      const st = threeVsThree();
      const option = ev.evaluateOptions(st, "a").find((o) => o.move?.id === "칼춤");
      const on = { ...P, partyEffects: true };
      const withParty = dec.scoreOption(option, 0.5, on);
      const withoutParty = dec.scoreOption({ ...option, support: { ...option.support, effect: { ...option.support.effect, party: undefined } } }, 0.5, on);
      const boostedPair = option.support.effect.party.model.pair(0, true, 1);
      const basePair = option.party.model.pair(0, true, 1);
      check("파티②: 랭크업 → 이어지는 대면도 올린 랭크", boostedPair.myRate > basePair.myRate && withParty > withoutParty, `rate ${basePair.myRate.toFixed(3)}→${boostedPair.myRate.toFixed(3)} 점수 ${withoutParty.toFixed(3)}→${withParty.toFixed(3)}`);
    }
    // 독압정: 상대 대기 포켓몬은 독 상태로 대면(접지·비면역), 스텔스록: 상대 등장 비용 증가
    {
      const st = battle(
        [mon("팬텀", ["독압정", "스텔스록", "섀도볼"])],
        [mon("핫삼", ["불꽃펀치"]), mon("잠만보", ["누르기"]), mon("리자몽", ["화염방사"])],
      );
      const opts = ev.evaluateOptions(st, "a");
      const tspikes = opts.find((o) => o.move?.id === "독압정").support.effect;
      const rocks = opts.find((o) => o.move?.id === "스텔스록").support.effect;
      const snorlax = tspikes.party.model.pair(0, true, 1).opponent;
      const charizard = tspikes.party.model.pair(0, true, 2).opponent;
      const rockEntry = rocks.party.model.oppEntry[2];
      check(
        "파티②: 독압정 → 접지 대기 포켓몬 독(비행 제외), 스텔스록 → 등장 비용, 이월 항 0",
        snorlax.status.condition === "poison" && !charizard.status.condition && rockEntry > 0.2 && tspikes.partyCarry === 0 && rocks.partyCarry === 0,
        `잠만보=${snorlax.status.condition} 리자몽=${charizard.status.condition} 록(리자몽)=${rockEntry.toFixed(3)}`,
      );
    }
    // 방어류 뒤: 한 턴 뒤 상대 마지막 포켓몬이 쓰러졌으면 +λ, 길동무 동반 기절이면 남은 포켓몬끼리 이어서
    {
      const before = battle([mon("팬텀", ["길동무"]), mon("헬가", ["악의파동"], null, null, pts({ spa: 32, spe: 32 }))], [mon("잠만보", ["누르기"]), mon("팬텀", ["섀도볼"], null, null, pts())]);
      const lastOnly = battle([mon("팬텀", ["방어"])], [mon("핫삼", ["불꽃펀치"])]);
      const lastDown = battle([mon("팬텀", ["방어"])], [mon("핫삼", ["불꽃펀치"])]);
      lastDown.b.currentHp = 0;
      const v1 = pe.partyValueAfterTurn(pe.createPartyModel(lastDown, "a"), pe.createPartyModel(lastOnly, "a"), CHAIN);
      const both = battle([mon("팬텀", ["길동무"]), mon("헬가", ["악의파동"], null, null, pts({ spa: 32, spe: 32 }))], [mon("잠만보", ["누르기"]), mon("팬텀", ["섀도볼"], null, null, pts())]);
      both.a.currentHp = 0;
      both.b.currentHp = 0;
      const v2 = pe.partyValueAfterTurn(pe.createPartyModel(both, "a"), pe.createPartyModel(before, "a"), CHAIN);
      check("파티②: 한 턴 뒤 상대 마지막 기절 → +λ, 동반 기절 뒤 유리한 대기 포켓몬 → 양수", Math.abs(v1 - CHAIN.lambda) < 1e-9 && v2 > 0, `마지막=${v1.toFixed(3)} 동반=${v2.toFixed(3)}`);
    }
    check("파티②: 설치기 헬퍼", fx.hazardsAfter({ stealthRock: false, spikesLayers: 2, toxicSpikesLayers: 1, stickyWeb: false }, data.getMove("독압정")).toxicSpikesLayers === 2);
  }
}
