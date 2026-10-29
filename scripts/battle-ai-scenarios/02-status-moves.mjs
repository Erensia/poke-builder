// 변화기 평가(decision-layer §4-1~4-4)와 첫 턴 전용 기술
export default async function ({ data, ev, ai, dec, pts, mon, battle, opt, check }) {
  // ── 변화기(decision-layer §4-1 적용 후 재평가) ──
  const legacy = { ...dec.DEFAULT_DECISION_PARAMS, statusAware: false };
  // 도깨비불: 물리 공격 상대를 화상 → 내가 버티는 턴(d) 증가 / 이미 상태이상·불꽃 타입이면 실패
  {
    const physical = () => mon("한카리아스", ["역린", "지진"], null, null, pts({ atk: 32, hp: 32 }));
    const st = battle([mon("팬텀", ["도깨비불", "섀도볼"], null, null, pts({ hp: 32, def: 32 }))], [physical()]);
    const o = opt(ev.evaluateOptions(st, "a"), "도깨비불");
    const e = o.support?.effect;
    check(
      "도깨비불 → 적용 후 d 증가",
      o.support?.kind === "effect" && e.hit.survivalTurns > e.base.survivalTurns && e.hitChance < 1,
      `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)} 명중=${e?.hitChance}`,
    );
    check("statusAware:false → 변화기 −∞", dec.scoreOption(o, 0.5, legacy) === -Infinity && Number.isFinite(dec.scoreOption(o, 0.5)));
    st.b.status = { condition: "paralysis", turnsElapsed: 1 };
    const already = opt(ev.evaluateOptions(st, "a"), "도깨비불");
    const fire = battle([mon("팬텀", ["도깨비불", "섀도볼"])], [mon("리자몽", ["화염방사"])]);
    const immune = opt(ev.evaluateOptions(fire, "a"), "도깨비불");
    check("이미 상태이상·불꽃 타입 → 도깨비불 실패", dec.scoreOption(already, 0.5) === -Infinity && dec.scoreOption(immune, 0.5) === -Infinity);
  }
  // 가루 기술은 풀 타입에게 실패
  {
    const st = battle([mon("라플레시아", ["수면가루", "기가드레인"])], [mon("이상해꽃", ["기가드레인"])]);
    check("풀 타입 → 수면가루 실패", dec.scoreOption(opt(ev.evaluateOptions(st, "a"), "수면가루"), 0.5) === -Infinity);
  }
  // 전기자석파: 느린 내가 마비시키면 선공이 뒤집힌다
  {
    const st = battle(
      [mon("메타그로스", ["전기자석파", "코멧펀치"], null, null, pts({ atk: 32, hp: 32 }))],
      [mon("한카리아스", ["역린"], null, null, pts({ atk: 32, spe: 32 }))],
    );
    const e = opt(ev.evaluateOptions(st, "a"), "전기자석파").support?.effect;
    check("전기자석파 → 선공 역전", e && e.base.firstProbability === 0 && e.hit.firstProbability === 1, `p ${e?.base.firstProbability}→${e?.hit.firstProbability}`);
  }
  // 리플렉터: 물리 상대에게 d 증가, 이미 깔려 있으면 실패
  {
    const st = battle(
      [mon("메타그로스", ["리플렉터", "코멧펀치"], null, null, pts({ atk: 32, hp: 32 })), mon("팬텀", ["섀도볼"])],
      [mon("한카리아스", ["역린"], null, null, pts({ atk: 32, spe: 32 }))],
    );
    const e = opt(ev.evaluateOptions(st, "a"), "리플렉터").support?.effect;
    check("리플렉터 → 적용 후 d 증가", e && e.hit.survivalTurns > e.base.survivalTurns, `d ${e?.base.survivalTurns.toFixed(2)}→${e?.hit.survivalTurns.toFixed(2)} 이월=${e?.carry.toFixed(3)}`);
    st.sideA.screens = { ...st.sideA.screens, reflect: 3 };
    check("리플렉터 이미 있음 → 실패", dec.scoreOption(opt(ev.evaluateOptions(st, "a"), "리플렉터"), 0.5) === -Infinity);
  }
  // 스텔스록: 상대 대기 포켓몬이 있을 때만 이월 이득, 이미 깔려 있으면 실패
  {
    const foe = () => mon("리자몽", ["화염방사"]);
    const two = battle([mon("거대코뿌리", ["스텔스록", "지진"])], [foe(), foe()]);
    const one = battle([mon("거대코뿌리", ["스텔스록", "지진"])], [foe()]);
    const e2 = opt(ev.evaluateOptions(two, "a"), "스텔스록").support?.effect;
    const e1 = opt(ev.evaluateOptions(one, "a"), "스텔스록").support?.effect;
    check("스텔스록 → 대기 리자몽 1마리 = 1/2 이월", e2 && Math.abs(e2.carry - 0.5) < 0.01 && e1?.carry === 0, `carry=${e2?.carry} / 대기없음=${e1?.carry}`);
    two.sideB.hazards.stealthRock = true;
    check("스텔스록 이미 있음 → 실패", dec.scoreOption(opt(ev.evaluateOptions(two, "a"), "스텔스록"), 0.5) === -Infinity);
  }
  // 이기는 대면(확정 1타 선공)에서는 변화기를 고르지 않는다
  {
    const st = battle([mon("한카리아스", ["스텔스록", "불꽃엄니"])], [mon("핫삼", ["불릿펀치"], null, null, pts()), mon("핫삼", ["불릿펀치"])]);
    const d = ai.chooseAiAction(st, "a", 0.5);
    check("이기는 대면 → 공격 유지", d.action.kind === "move" && d.action.move.id === "불꽃엄니", d.action.move?.id);
  }
  // 배턴터치: 교대 후보를 랭크 이어받은 상태로 평가(유턴류 구조 재사용)
  {
    const st = battle(
      [mon("피카츄", ["배턴터치", "10만볼트"]), mon("한카리아스", ["역린"], null, null, pts({ atk: 32, spe: 32 }))],
      [mon("메타그로스", ["코멧펀치"], null, null, pts({ hp: 32, def: 32 }))],
    );
    st.a.stages = { ...st.a.stages, atk: 2 };
    const o = opt(ev.evaluateOptions(st, "a"), "배턴터치");
    const plain = ev.evaluateOptions(st, "a").find((x) => x.optionType === "switch");
    check(
      "배턴터치 → 랭크 이어받은 후보로 평가",
      o.pivot?.hitChance === 1 && o.pivot.candidates[0].hitsToKill.expected < plain.hitsToKill.expected && Number.isFinite(dec.scoreOption(o, 0.5)),
      `c 이어받음=${o.pivot?.candidates[0].hitsToKill.expected.toFixed(2)} 일반교체=${plain.hitsToKill.expected.toFixed(2)}`,
    );
  }
  // ── 랭크업기 재평가·배턴터치 연계(decision-layer §4-2) ──
  {
    // 고속이동: 느린 쪽이 스피드 +2로 선공 역전 → p 0→1
    const speed = battle(
      [mon("메타그로스", ["고속이동", "코멧펀치"], null, null, pts({ atk: 32, hp: 32 }))],
      [mon("한카리아스", ["역린"], null, null, pts({ atk: 32, spe: 32 }))],
    );
    const e = opt(ev.evaluateOptions(speed, "a"), "고속이동").support?.effect;
    check("고속이동 → 선공 역전 반영", e && e.base.firstProbability === 0 && e.hit.firstProbability === 1, `p ${e?.base.firstProbability}→${e?.hit.firstProbability}`);
    // 철벽: 물리 상대에게 d 증가
    const iron = battle(
      [mon("메타그로스", ["철벽", "코멧펀치"], null, null, pts({ atk: 32, hp: 32 }))],
      [mon("한카리아스", ["역린"], null, null, pts({ atk: 32, spe: 32 }))],
    );
    const ei = opt(ev.evaluateOptions(iron, "a"), "철벽").support?.effect;
    check("철벽 → d 증가 반영", ei && ei.hit.survivalTurns > ei.base.survivalTurns, `d ${ei?.base.survivalTurns.toFixed(2)}→${ei?.hit.survivalTurns.toFixed(2)}`);
    // 이미 +6이면 실패
    iron.a.stages = { ...iron.a.stages, def: 6 };
    const maxed = opt(ev.evaluateOptions(iron, "a"), "철벽");
    check("방어 +6 → 철벽 실패", maxed.support?.setupFailed === true && dec.scoreOption(maxed, 0.5) === -Infinity);
  }
  {
    // 번치코(가속): 칼춤 → 배턴터치로 한카리아스에게 넘기는 선택지가 계산된다
    const st = battle(
      [
        mon("번치코", ["칼춤", "배턴터치", "불꽃세례"].filter((m) => data.getMove(m)), "가속", null, pts({ hp: 32, spe: 32 })),
        mon("한카리아스", ["역린", "지진"], null, null, pts({ atk: 32, spe: 32 })),
      ],
      [mon("핫삼", ["불릿펀치"], null, null, pts({ hp: 32, def: 32 }))],
    );
    const sd = opt(ev.evaluateOptions(st, "a"), "칼춤");
    const follow = sd?.support?.batonFollowUp;
    const plainSwitch = ev.evaluateOptions(st, "a").find((o) => o.optionType === "switch");
    check(
      "칼춤 → 배턴터치 연계 계산(후보가 +2를 이어받음)",
      !!follow && follow.candidates[0].hitsToKill.expected < plainSwitch.hitsToKill.expected && Number.isFinite(dec.scoreOption(sd, 0.5)),
      `c 이어받음=${follow?.candidates[0].hitsToKill.expected.toFixed(2)} 일반교체=${plainSwitch?.hitsToKill.expected.toFixed(2)} score=${dec.scoreOption(sd, 0.5).toFixed(3)}`,
    );
  }
  // ── 3단계 변화기(§4-3): 날씨·필드·트릭룸·도발·앙코르 ──
  {
    const slowVsFast = () =>
      battle(
        [mon("메타그로스", ["트릭룸", "비바라기", "코멧펀치"], null, null, pts({ atk: 32, hp: 32 }))],
        [mon("한카리아스", ["역린", "칼춤"], null, null, pts({ atk: 32, spe: 32 }))],
      );
    const st = slowVsFast();
    const tr = opt(ev.evaluateOptions(st, "a"), "트릭룸").support?.effect;
    check(
      "트릭룸 → 선공 역전(지속 턴 비율만큼)",
      tr?.kind === "trickRoom" && tr.base.firstProbability === 0 && tr.hit.firstProbability > 0.5,
      `p ${tr?.base.firstProbability}→${tr?.hit.firstProbability.toFixed(2)}`,
    );
    st.trickRoomTurnsRemaining = 3;
    check("트릭룸 이미 있음 → 실패", dec.scoreOption(opt(ev.evaluateOptions(st, "a"), "트릭룸"), 0.5) === -Infinity);
    // 비바라기: 물 공격기가 강해져 c 감소, 이미 비면 실패
    const rain = battle(
      [mon("거북왕", ["비바라기", "하이드로펌프"], null, null, pts({ spa: 32, hp: 32 }))],
      [mon("한카리아스", ["역린"], null, null, pts({ hp: 32, def: 32 }))],
    );
    const rd = opt(ev.evaluateOptions(rain, "a"), "비바라기").support?.effect;
    check("비바라기 → 물 기술 강화로 c 감소", rd?.kind === "weather" && rd.hit.killTurns < rd.base.killTurns, `c ${rd?.base.killTurns.toFixed(2)}→${rd?.hit.killTurns.toFixed(2)}`);
    rain.weather = "비";
    rain.weatherTurnsRemaining = 3;
    check("이미 비 → 비바라기 실패", dec.scoreOption(opt(ev.evaluateOptions(rain, "a"), "비바라기"), 0.5) === -Infinity);
    // 앙코르: 상대가 직전에 칼춤(변화기)을 썼으면 묶어서 d 증가 / 아직 기술을 안 썼으면 실패
    const enc = battle(
      [mon("팬텀", ["앙코르", "섀도볼"], null, null, pts({ spa: 32, spe: 32 }))],
      [mon("한카리아스", ["역린", "칼춤"], null, null, pts({ atk: 32, hp: 32 }))],
    );
    check("상대가 기술을 안 씀 → 앙코르 실패", dec.scoreOption(opt(ev.evaluateOptions(enc, "a"), "앙코르"), 0.5) === -Infinity);
    enc.b.lastMoveId = "칼춤";
    const en = opt(ev.evaluateOptions(enc, "a"), "앙코르").support?.effect;
    check("직전 칼춤에 앙코르 → d 증가", en?.kind === "encore" && en.hit.survivalTurns > en.base.survivalTurns, `d ${en?.base.survivalTurns.toFixed(2)}→${en?.hit.survivalTurns.toFixed(2)}`);
    // 상대 모델이 앙코르를 반영: 칼춤에 묶인 상대는 공격하지 않는다
    enc.b.volatile = { active: { encore: { turnsRemaining: 3, moveId: "칼춤" } } };
    const locked = opt(ev.evaluateOptions(enc, "a"), "섀도볼");
    check("칼춤 앙코르 중인 상대 → 위협 없음(d = ∞)", locked.hitsToBeKilled.expected === Infinity, `d=${locked.hitsToBeKilled.expected}`);
    // 도발: 효과 계산 + 이미 도발이면 실패
    const taunt = battle(
      [mon("팬텀", ["도발", "섀도볼"], null, null, pts({ spa: 32, spe: 32 }))],
      [mon("한카리아스", ["역린", "칼춤"], null, null, pts({ atk: 32, hp: 32 }))],
    );
    const tn = opt(ev.evaluateOptions(taunt, "a"), "도발").support?.effect;
    taunt.b.volatile = { active: { taunt: { turnsRemaining: 2 } } };
    check("도발 계산 + 이미 도발이면 실패", tn?.kind === "taunt" && dec.scoreOption(opt(ev.evaluateOptions(taunt, "a"), "도발"), 0.5) === -Infinity);
  }
  // ── 방어류(§4-4 엔진 한 턴 시뮬레이션) ──
  {
    const protectOpt = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    // 방어: 맹독 상대 → 방어 턴에 상대만 맹독 데미지, 연속 사용이면 성공 확률 1/3
    const toxic = battle([mon("잠만보", ["방어", "누르기"], null, null, pts({ hp: 32, def: 32 }))], [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))]);
    toxic.b.status = { condition: "badly-poisoned", turnsElapsed: 3 };
    const tp = protectOpt(toxic, "방어").support?.protect;
    check("방어: 맹독 상대 HP만 깎임", tp?.group === "block" && tp.outcomes.every((o) => o.oppAfter < 1 && o.myAfter === 1), tp?.outcomes.map((o) => `나${o.myAfter.toFixed(2)} 상대${o.oppAfter.toFixed(2)}`).join(" "));
    toxic.a.protectStreak = 1;
    check("방어 연속 사용 → 성공 1/3", Math.abs(protectOpt(toxic, "방어").support.protect.successChance - 1 / 3) < 1e-9);
    // 패스트가드: 상대에게 선공기가 없으면 무의미, 있으면 평가
    const guard = (oppMoves) =>
      protectOpt(battle([mon("잠만보", ["패스트가드", "누르기"])], [mon("루카리오", oppMoves, null, null, pts({ atk: 32 }))]), "패스트가드").support.protect;
    // (신속 + 인파이트면 모델이 약한 신속에 5% 미만을 줘서 후보에서 빠진다 — 선공기가 주력인 상대로 확인)
    check("패스트가드: 선공기 없으면 무의미 / 신속이 주력이면 평가", guard(["인파이트"]).pointless === true && !guard(["신속", "칼춤"]).pointless);
    // 버티기: 이번 턴 안 쓰러지면 무의미, 쓰러질 상황이면 HP 1로 버팀
    const endure = (hpPts) =>
      protectOpt(battle([mon("피카츄", ["버티기", "10만볼트"], null, null, pts({ hp: hpPts }))], [mon("한카리아스", ["지진"], null, null, pts({ atk: 32 }))]), "버티기").support.protect;
    const lethal = endure(0);
    check("버티기: 쓰러질 상황이면 HP 1로 버팀", !lethal.pointless && lethal.outcomes.some((o) => o.myAfter > 0 && o.myAfter < 0.05), lethal.outcomes.map((o) => o.myAfter.toFixed(3)).join(","));
    const safe = protectOpt(battle([mon("잠만보", ["버티기", "누르기"], null, null, pts({ hp: 32, def: 32 }))], [mon("피카츄", ["전광석화"])]), "버티기").support.protect;
    check("버티기: 이번 턴 안 쓰러지면 무의미", safe.pointless === true);
    // 길동무: 내가 먼저 움직이고 이번 턴 쓰러지면 상대도 기절
    const bond = protectOpt(
      battle([mon("팬텀", ["길동무", "섀도볼"], null, null, pts({ spe: 32 }))], [mon("마기라스", ["깨물어부수기"], null, null, pts({ atk: 32 }))]),
      "길동무",
    ).support.protect;
    check("길동무: 먼저 움직이고 쓰러지면 동반 기절", bond.group === "destinyBond" && bond.outcomes.some((o) => o.myAfter === 0 && o.oppAfter === 0), bond.outcomes.map((o) => `나${o.myAfter.toFixed(2)} 상대${o.oppAfter.toFixed(2)}`).join(" "));
    // 킹실드: 접촉기를 막으면 상대 공격 −1 → 이어지는 대면에서 d 증가
    const shield = protectOpt(
      battle([mon("킬가르도", ["킹실드", "섀도볼"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["역린"], null, null, pts({ atk: 32 }))]),
      "킹실드",
    ).support;
    const shieldBase = shield.protect.base.survivalTurns;
    check("킹실드: 접촉기 막고 상대 공격 −1 → d 증가", shield.protect.group === "punish" && shield.protect.outcomes.some((o) => o.race && o.race.survivalTurns > shieldBase), `기본 d=${shieldBase.toFixed(2)} → ${shield.protect.outcomes.map((o) => o.race?.survivalTurns.toFixed(2)).join(",")}`);
    // 방어류 끄기(protectGroups)
    check("protectGroups에서 빼면 고르지 않음", dec.scoreOption(protectOpt(toxic, "방어"), 0.5, { ...dec.DEFAULT_DECISION_PARAMS, protectGroups: [] }) === -Infinity);
  }
  // 첫 턴 전용 기술(만나자마자): 등장 후 행동했으면 옵션·상대 위협에서 모두 빠진다(사용자 발견 버그)
  {
    const st = battle(
      [mon("갑주무사", ["만나자마자", "아쿠아브레이크", "시저크로스"], null, null, pts({ atk: 32, spe: 32 }))],
      [mon("보만다", ["역린", "지진", "만나자마자"].filter((m) => data.getMove(m)), null, null, pts({ atk: 32, spe: 32 }))],
    );
    const first = opt(ev.evaluateOptions(st, "a"), "만나자마자");
    const firstRaw = ev.evaluateOptions(st, "a").find((o) => o.move?.id === "시저크로스");
    check(
      "등장 첫 턴 → 만나자마자 선택 가능(이후는 다른 기술로 이어감)",
      !!first && first.hitsToKill.expected > 1 && Number.isFinite(first.hitsToKill.expected),
      `c=${first?.hitsToKill.expected.toFixed(2)} 시저크로스 c=${firstRaw?.hitsToKill.expected.toFixed(2)}`,
    );
    st.a.hasActedSinceSwitchIn = true;
    st.b.hasActedSinceSwitchIn = true;
    const later = ev.evaluateOptions(st, "a");
    const d = ai.chooseAiAction(st, "a", 0.5);
    check(
      "첫 턴 이후 → 만나자마자 제외",
      !opt(later, "만나자마자") && !(d.action.kind === "move" && d.action.move.id === "만나자마자"),
      JSON.stringify(d.action.kind === "move" ? d.action.move.id : d.action),
    );
  }
}
