// AI-A1·A2(ver.1.8)
export default async function ({ server, data, ev, dec, pts, mon, battle, opt, check }) {
  // ── AI-A1(ver.1.8): 배북·흑안개·혼란·헤롱헤롱·씨뿌리기·하품·희망사항·신비의부적 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
    const P = dec.DEFAULT_DECISION_PARAMS;
    const moveAction = (id) => ({ kind: "move", move: data.getMove(id) });
    const effOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    const score = (o) => dec.scoreOption(o, 0.5, P);
    // 배북(엔진 버그 수정): HP 절반을 쓰고 공격 +6, HP가 절반 이하면 실패
    {
      const st = battle([mon("잠만보", ["배북"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["섀도볼"], null, null, pts())]);
      const full = st.a.currentHp;
      const out = rt.runTurn(st, moveAction("배북"), moveAction("섀도볼"), () => 0.5).nextState;
      const low = battle([mon("잠만보", ["배북"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["섀도볼"], null, null, pts())]);
      low.a.currentHp = Math.floor(low.a.maxHp / 2);
      const lowOut = rt.runTurn(low, moveAction("배북"), moveAction("섀도볼"), () => 0.5).nextState;
      const o = effOf(battle([mon("잠만보", ["배북", "누르기"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["섀도볼"], null, null, pts())]), "배북");
      check(
        "A1: 배북 — HP 절반 소비·공격 +6, 절반 이하면 실패 + AI 랭크업기로 평가",
        out.a.stages.atk === 6 && full - out.a.currentHp >= Math.floor(full / 2) && lowOut.a.stages.atk === 0 && o.support.kind === "setup" && Number.isFinite(score(o)),
        `공격=${out.a.stages.atk} 소비=${full - out.a.currentHp}/${full} 절반HP=${lowOut.a.stages.atk} kind=${o.support.kind}`,
      );
    }
    // 흑안개: 상대 랭크업을 지우면 버티는 턴 증가, 지울 랭크가 없으면 실패
    {
      const st = battle([mon("잠만보", ["흑안개", "누르기"], null, null, pts({ hp: 32 }))], [mon("갸라도스", ["폭포오르기"].filter((m) => data.getMove(m)), null, null, pts({ atk: 32 }))]);
      st.b.stages = { ...st.b.stages, atk: 4 };
      const e = effOf(st, "흑안개").support.effect;
      const none = battle([mon("잠만보", ["흑안개", "누르기"])], [mon("갸라도스", ["폭포오르기"].filter((m) => data.getMove(m)))]);
      check("A1: 흑안개 — 상대 +4 제거로 d 증가, 랭크 없으면 실패", e && e.hit.survivalTurns > e.base.survivalTurns && score(effOf(none, "흑안개")) === -Infinity, `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)}`);
    }
    // 혼란(이상한빛): 상대 행동 손실 + 자멸로 d 증가. 이미 혼란·미스트필드면 실패. turnsToKo: 혼란 공격측은 더 오래 걸림
    {
      const st = battle([mon("팬텀", ["이상한빛", "섀도볼"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))]);
      const e = effOf(st, "이상한빛").support.effect;
      const already = battle([mon("팬텀", ["이상한빛", "섀도볼"])], [mon("한카리아스", ["역린"])]);
      already.b.volatile = { active: { confusion: { turnsRemaining: 3 } } };
      const misty = battle([mon("팬텀", ["이상한빛", "섀도볼"])], [mon("한카리아스", ["역린"])]);
      misty.field = "미스트필드";
      const calm = tr.turnsToKo(0.25, st.b, st.a, st.a.currentHp);
      const conf = { ...st.b, volatile: { active: { confusion: { turnsRemaining: 3 } } } };
      const confused = tr.turnsToKo(0.25, conf, st.a, st.a.currentHp);
      check(
        "A1: 이상한빛 — d 증가, 이미 혼란·미스트필드면 실패, 혼란 공격측 처치 턴 증가",
        e && e.hit.survivalTurns > e.base.survivalTurns && score(effOf(already, "이상한빛")) === -Infinity && score(effOf(misty, "이상한빛")) === -Infinity && confused > calm,
        `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)} 처치턴 ${calm.toFixed(2)}→${confused.toFixed(2)}`,
      );
    }
    // 헤롱헤롱: 이성이면 d 증가, 동성이면 실패
    {
      const make = (g) => {
        const st = battle([mon("팬텀", ["헤롱헤롱", "섀도볼"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))]);
        st.a.gender = "male";
        st.b.gender = g;
        return st;
      };
      const e = effOf(make("female"), "헤롱헤롱").support.effect;
      check("A1: 헤롱헤롱 — 이성이면 d 증가, 동성이면 실패", e && e.hit.survivalTurns > e.base.survivalTurns * 1.5 && score(effOf(make("male"), "헤롱헤롱")) === -Infinity, `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)}`);
    }
    // 씨뿌리기: 상대 지속 피해(c 감소) + 내 회복(d 증가), 풀 타입이면 실패
    {
      const st = battle([mon("이상해꽃", ["씨뿌리기", "기가드레인"], null, null, pts({ hp: 32 }))], [mon("잠만보", ["누르기"], null, null, pts({ hp: 32 }))]);
      const e = effOf(st, "씨뿌리기").support.effect;
      const grass = battle([mon("이상해꽃", ["씨뿌리기", "기가드레인"])], [mon("이상해꽃", ["기가드레인"])]);
      check("A1: 씨뿌리기 — c 감소·d 증가, 풀 타입이면 실패", e && e.hit.killTurns < e.base.killTurns && e.hit.survivalTurns > e.base.survivalTurns && score(effOf(grass, "씨뿌리기")) === -Infinity, `c ${e?.base.killTurns.toFixed(2)}→${e?.hit.killTurns.toFixed(2)} d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)}`);
    }
    // 하품: 버티는 대면이면 d 증가(다음 턴 끝 잠듦), 상대가 이미 상태이상이면 실패
    {
      const st = battle([mon("잠만보", ["하품", "누르기"], null, null, pts({ hp: 32, def: 32 }))], [mon("헬가", ["악의파동"], null, null, pts())]);
      const e = effOf(st, "하품").support.effect;
      const burned = battle([mon("잠만보", ["하품", "누르기"])], [mon("헬가", ["악의파동"])]);
      burned.b.status = { condition: "burn", turnsElapsed: 1 };
      check("A1: 하품 — d 증가, 이미 상태이상이면 실패", e && e.hit.survivalTurns > e.base.survivalTurns && score(effOf(burned, "하품")) === -Infinity, `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)}`);
    }
    // 희망사항: 절반 HP에서 회복기로 평가(유한), 이미 예약돼 있으면 실패
    {
      const st = battle([mon("잠만보", ["희망사항", "누르기"], null, null, pts({ hp: 32, def: 32 }))], [mon("팬텀", ["섀도볼"], null, null, pts())]);
      st.a.currentHp = Math.floor(st.a.maxHp / 2);
      const o = effOf(st, "희망사항");
      const pending = battle([mon("잠만보", ["희망사항", "누르기"], null, null, pts({ hp: 32, def: 32 }))], [mon("팬텀", ["섀도볼"], null, null, pts())]);
      pending.a.currentHp = Math.floor(pending.a.maxHp / 2);
      pending.sideA.wish = { turnsRemaining: 1, healAmount: 50 };
      check("A1: 희망사항 — 회복기로 평가, 이미 예약이면 실패", o.support.kind === "heal" && Number.isFinite(score(o)) && score(effOf(pending, "희망사항")) === -Infinity, `score=${score(o).toFixed(3)} 회복후=${o.support.healedHpFraction?.toFixed(2)}`);
    }
    // 신비의부적: 상대 상태이상기를 헛수고로(d 증가 또는 유지), 이미 깔려 있으면 실패
    {
      const st = battle([mon("잠만보", ["신비의부적", "누르기"], null, null, pts({ hp: 32 }))], [mon("헬가", ["도깨비불", "악의파동"], null, null, pts())]);
      const e = effOf(st, "신비의부적").support.effect;
      const set = battle([mon("잠만보", ["신비의부적", "누르기"])], [mon("헬가", ["도깨비불", "악의파동"])]);
      set.sideA.safeguardTurnsRemaining = 3;
      // 가치는 작게(또는 음수로) 나온다 — 상대 변화기 확률이 공격기로 옮겨가는 모델 한계(도발과 같은 축, decision-layer §4-3).
      check("A1: 신비의부적 — 평가됨(유한), 이미 깔렸으면 실패", e && Number.isFinite(score(effOf(st, "신비의부적"))) && score(effOf(set, "신비의부적")) === -Infinity, `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)}`);
    }
  }
  // ── AI-A2(ver.1.8): 대타출동·잠꼬대·울부짖기/날려버리기·추억의선물 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
    const P = dec.DEFAULT_DECISION_PARAMS;
    const score = (o, params = P) => dec.scoreOption(o, 0.5, params);
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    // 대타출동: 최대 HP 1/4 비용, d 증가, 이미 대타·HP 1/4 이하면 실패. turnsToKo: 대타가 있으면 처치 턴 증가
    {
      const st = battle([mon("잠만보", ["대타출동", "누르기"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))]);
      const e = optOf(st, "대타출동").support.effect;
      const withSub = battle([mon("잠만보", ["대타출동", "누르기"])], [mon("한카리아스", ["역린"])]);
      withSub.a.substituteHp = 50;
      const low = battle([mon("잠만보", ["대타출동", "누르기"])], [mon("한카리아스", ["역린"])]);
      low.a.currentHp = Math.floor(low.a.maxHp / 4);
      const plain = tr.turnsToKo(0.3, st.b, st.a, st.a.currentHp);
      const subbed = tr.turnsToKo(0.3, st.b, { ...st.a, substituteHp: Math.floor(st.a.maxHp / 4) }, st.a.currentHp);
      check(
        "A2: 대타출동 — 비용 1/4·d 증가, 이미 대타·HP 부족이면 실패, 대타 있으면 처치 턴 증가",
        e && Math.abs(e.selfCost - 0.25) < 0.01 && e.hit.survivalTurns > e.base.survivalTurns * 0.75 && score(optOf(withSub, "대타출동")) === -Infinity && score(optOf(low, "대타출동")) === -Infinity && subbed > plain,
        `비용=${e?.selfCost?.toFixed(3)} d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)} 처치턴 ${plain.toFixed(2)}→${subbed.toFixed(2)}`,
      );
      // 낮은 HP에서도 대타를 깨는 턴은 절대 데미지로 — 현재 HP 대비 비율(한 방에 잘림)로 보면 수십 턴으로 부풀었다
      const lowHp = battle([mon("잠만보", ["대타출동", "누르기"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))]);
      lowHp.a.currentHp = Math.floor(lowHp.a.maxHp * 0.3);
      const le = optOf(lowHp, "대타출동").support.effect;
      check("A2: 대타출동(HP 30%) — 대타는 한두 대분만 버팀(부풀지 않음)", le && le.hit.survivalTurns <= le.base.survivalTurns + 2.5, `d ${le?.base.survivalTurns.toFixed(2)}→${le?.hit.survivalTurns.toFixed(2)}`);
      // 상대 기술 모델: 대타가 있으면 상대의 도깨비불은 헛수고
      const burner = battle([mon("잠만보", ["누르기"])], [mon("헬가", ["도깨비불", "악의파동"])]);
      burner.a.substituteHp = 50;
      const threat = await server.ssrLoadModule("/src/lib/battle/ai/opponentMoveModel.ts");
      const t = threat.evaluateOpponentThreat({ state: burner, opponent: burner.b, target: burner.a, targetSide: burner.sideA, opponentMovesSecond: false });
      check("A2: 대타 → 상대 상태이상기 확률 0", !t.moveWeights.some((w) => w.move.id === "도깨비불" && w.weight > 0), t.moveWeights.map((w) => `${w.move.id}:${w.weight.toFixed(2)}`).join(" "));
    }
    // 잠꼬대: 잠든 동안 고를 수 있고, 다른 공격기(잠들어 못 씀)보다 처치 턴이 짧다. 안 잠들었으면 선택지에 없다
    {
      const st = battle([mon("잠만보", ["잠꼬대", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("한카리아스", ["역린"], null, null, pts())]);
      st.a.status = { condition: "sleep", turnsElapsed: 1, sleepTurns: 3 };
      const opts = ev.evaluateOptions(st, "a");
      const talk = opt(opts, "잠꼬대");
      const body = opt(opts, "누르기");
      const awake = battle([mon("잠만보", ["잠꼬대", "누르기"])], [mon("한카리아스", ["역린"])]);
      check(
        "A2: 잠꼬대 — 잠든 동안 처치 턴 단축·유한 점수, 깨어 있으면 선택지 없음",
        talk && Number.isFinite(score(talk)) && talk.hitsToKill.expected < body.hitsToKill.expected && !opt(ev.evaluateOptions(awake, "a"), "잠꼬대") && score(talk, { ...P, a2Aware: false }) === -Infinity,
        `잠꼬대 c=${talk?.hitsToKill.expected.toFixed(2)} 누르기 c=${body?.hitsToKill.expected.toFixed(2)}`,
      );
    }
    // 울부짖기: 상대가 +6이면 끌어내는 편이 낫다(파티 모드), 예비가 없으면 실패. 엔진도 실제로 강제 교체
    {
      const make = () =>
        battle(
          [mon("잠만보", ["울부짖기", "누르기"], null, null, pts({ hp: 32, def: 32 })), mon("핫삼", ["불꽃펀치"])],
          [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 })), mon("팬텀", ["섀도볼"], null, null, pts())],
        );
      const st = make();
      st.b.stages = { ...st.b.stages, atk: 2 };
      const opts = ev.evaluateOptions(st, "a");
      const roar = opt(opts, "울부짖기");
      const body = opt(opts, "누르기");
      const solo = battle([mon("잠만보", ["울부짖기", "누르기"])], [mon("한카리아스", ["역린"])]);
      const eng = make();
      const out = rt.runTurn(eng, { kind: "move", move: data.getMove("울부짖기") }, { kind: "move", move: data.getMove("역린") }, () => 0.5).nextState;
      check(
        "A2: 울부짖기 — 상대 +2면 공격보다 높은 점수, 예비 없으면 실패, 엔진 강제 교체",
        roar && score(roar) > score(body) && score(optOf(solo, "울부짖기")) === -Infinity && out.sideB.activeIndex === 1,
        `울부짖기=${roar ? score(roar).toFixed(3) : "-"} 누르기=${score(body).toFixed(3)} 교체=${out.sideB.activeIndex}`,
      );
    }
    // 추억의선물: 파티 모드에서만 평가(유한), 끄면 −∞, 엔진은 자신 기절 + 상대 −2/−2
    {
      const make = () =>
        battle(
          [mon("팬텀", ["추억의선물", "섀도볼"], null, null, pts()), mon("메타그로스", ["코멧펀치"], null, null, pts({ atk: 32, hp: 32 }))],
          [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))],
        );
      const o = optOf(make(), "추억의선물");
      const eng = make();
      const out = rt.runTurn(eng, { kind: "move", move: data.getMove("추억의선물") }, { kind: "move", move: data.getMove("역린") }, () => 0.5);
      const ns = out.nextState ?? out._ctx.state;
      check(
        "A2: 추억의선물 — 파티 모드에서 유한·끄면 −∞, 엔진은 자신 기절(버그 수정)",
        Number.isFinite(score(o)) && score(o, { ...P, partyAware: false }) === -Infinity && ns.sideA.party[0].currentHp === 0,
        `점수=${score(o).toFixed(3)} 사용자HP=${ns.sideA.party[0].currentHp} 상대공격=${ns.b.stages.atk}`,
      );
    }
  }
}
