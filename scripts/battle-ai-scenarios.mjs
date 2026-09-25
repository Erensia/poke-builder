/**
 * 배틀 AI 규칙 시나리오 테스트 — 특정 상황을 직접 만들어 규칙 하나하나가 맞게 동작하는지 확인한다.
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:ai
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const state = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const ev = await server.ssrLoadModule("/src/lib/battle/ai/evaluator.ts");
  const ai = await server.ssrLoadModule("/src/lib/battle/ai/index.ts");
  const dec = await server.ssrLoadModule("/src/lib/battle/ai/decision.ts");

  const pts = (o = {}) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });
  // 엔진은 습득 가능 여부를 검사하지 않으므로 기술·특성·도구를 자유롭게 조합한다.
  const mon = (pokemonId, moves, ability = null, item = null, points = pts({ atk: 32, spe: 32, hp: 2 })) => ({
    slot: { pokemonId, moves: [...moves, null, null, null, null].slice(0, 4), ability, item, nature: null, points },
    moves: moves.map((m) => data.getMove(m)),
  });
  const battle = (aMons, bMons) =>
    state.createBattleState({
      a: { slots: aMons.map((m) => m.slot), movesList: aMons.map((m) => m.moves) },
      b: { slots: bMons.map((m) => m.slot), movesList: bMons.map((m) => m.moves) },
    });
  const opt = (opts, moveId) => opts.find((o) => o.move?.id === moveId);
  const rows = [];
  const check = (name, ok, detail = "") => rows.push({ name, ok, detail: String(detail).slice(0, 90) });

  // 부유: 땅 기술 무효
  {
    const st = battle([mon("한카리아스", ["지진", "스톤에지"])], [mon("팬텀", ["10만볼트"], "부유")]);
    const o = opt(ev.evaluateOptions(st, "a"), "지진");
    check("부유 → 땅 기술 무효", o.typeMatchup.offensive === 0 && o.hitsToKill.expected === Infinity, `eff=${o.typeMatchup.offensive} c=${o.hitsToKill.expected}`);
  }
  // 여왕의위엄: 우선도 기술 실패
  {
    const st = battle([mon("루카리오", ["전광석화", "인파이트"])], [mon("갸라도스", ["폭포오르기"].filter((m) => data.getMove(m)), "여왕의위엄")]);
    const o = opt(ev.evaluateOptions(st, "a"), "전광석화");
    check("여왕의위엄 → 우선도 기술 실패", o.hitsToKill.expected === Infinity, `c=${o.hitsToKill.expected}`);
  }
  // 기합의띠 / 하드 오버라이드: 핫삼은 불꽃 4배 약점 → 띠 없으면 확정 1타
  {
    const sash = battle([mon("한카리아스", ["불꽃펀치"])], [mon("핫삼", ["코멧펀치"], null, "기합의띠", pts())]);
    const noSash = battle([mon("한카리아스", ["불꽃펀치"])], [mon("핫삼", ["코멧펀치"], null, null, pts())]);
    const withSash = opt(ev.evaluateOptions(sash, "a"), "불꽃펀치");
    const without = opt(ev.evaluateOptions(noSash, "a"), "불꽃펀치");
    check(
      "기합의띠 → 확정 2타로 보정",
      without.hitsToKill.worstCase.count === 1 && withSash.hitsToKill.worstCase.count === 2 && withSash.hitsToKill.expected >= 2,
      `띠없음=${JSON.stringify(without.hitsToKill.worstCase)} 띠=${JSON.stringify(withSash.hitsToKill.worstCase)}`,
    );
    check("선공+확정1타+필중 → 하드 오버라이드", dec.isHardOverride(without) && !dec.isHardOverride(withSash), `first=${without.firstProbability} acc=${without.accuracy}`);
    const d = ai.chooseAiAction(noSash, "a", 0.5);
    check("오버라이드 옵션 선택", d.action.kind === "move" && d.action.move.id === "불꽃펀치");
  }
  // 명중률: 스톤에지 80% → 오버라이드 제외
  {
    const st = battle([mon("한카리아스", ["스톤에지"])], [mon("핫삼", ["불꽃펀치"], null, null, pts())]);
    const o = opt(ev.evaluateOptions(st, "a"), "스톤에지");
    check("스톤에지 명중률 0.8", Math.abs(o.accuracy - 0.8) < 1e-9 && !dec.isHardOverride(o), `acc=${o.accuracy}`);
  }
  // 메가진화: 스톤 보유 시 mega 선언, 평가가 원래 state를 건드리지 않음
  {
    const st = battle([mon("갸라도스", ["지진"], "위협", "갸라도스나이트")], [mon("핫삼", ["불꽃펀치"])]);
    const opts = ev.evaluateOptions(st, "a");
    const d = ai.chooseAiAction(st, "a", 0.5);
    check("메가스톤 보유 → 메가진화 선언", opts.every((o) => o.optionType !== "move" || o.mega) && d.action.mega === true);
    check("메가 평가가 state를 변형하지 않음", st.a.hasMegaEvolved !== true && st.sideA.megaUsed !== true);
  }
  // 2마리 파티에서도 교체 옵션 정상
  {
    const st = battle(
      [mon("핫삼", ["불꽃펀치"], null, null, pts({ hp: 2 })), mon("메타그로스", ["코멧펀치"], null, null, pts({ atk: 32, hp: 32 }))],
      [mon("갸라도스", ["하이드로펌프"], null, null, pts({ spa: 32, spe: 32 }))],
    );
    const d = ai.chooseAiAction(st, "a", 0.5);
    check("2마리 파티 판단 정상", !!d.action, JSON.stringify(d.action.kind === "switch" ? d.action : { move: d.action.move.id }));
  }
  // 유턴류: 교대할 포켓몬이 있으면 "공격 + 교체"로 평가, 없으면 일반 공격기
  {
    const withBench = battle(
      [mon("핫삼", ["유턴", "불꽃펀치"]), mon("메타그로스", ["코멧펀치"])],
      [mon("갸라도스", ["하이드로펌프"], null, null, pts({ hp: 32, def: 32 }))],
    );
    const solo = battle([mon("핫삼", ["유턴", "불꽃펀치"])], [mon("갸라도스", ["하이드로펌프"], null, null, pts({ hp: 32, def: 32 }))]);
    const pivotOpt = opt(ev.evaluateOptions(withBench, "a"), "유턴");
    const soloOpt = opt(ev.evaluateOptions(solo, "a"), "유턴");
    const on = dec.scoreOption(pivotOpt, 0.5);
    const off = dec.scoreOption(pivotOpt, 0.5, { ...dec.DEFAULT_DECISION_PARAMS, pivotAware: false });
    check(
      "유턴류 → 공격+교체로 평가",
      pivotOpt.pivot?.candidates.length === 1 && !soloOpt.pivot && on !== off,
      `candidates=${pivotOpt.pivot?.candidates.length} solo=${!!soloOpt.pivot} on=${on.toFixed(3)} off=${off.toFixed(3)}`,
    );
  }
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
  // ── 엔진: 날씨 기술·썰렁개그(2026-09-24 사용자 확인 규칙) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const rng = () => 0.5;
    const moveAction = (id) => ({ kind: "move", move: data.getMove(id) });
    const idle = moveAction("칼춤");
    // 같은 날씨 → 실패, 남은 턴 유지 / 다른 날씨 → 덮어쓰고 5턴
    const same = battle([mon("패리퍼", ["비바라기"])], [mon("한카리아스", ["칼춤"])]);
    same.weather = "비";
    same.weatherTurnsRemaining = 2;
    const sameOut = rt.runTurn(same, moveAction("비바라기"), idle, rng);
    const sameAct = sameOut.result.actions.find((a) => a.actor === "a");
    check(
      "같은 날씨에 비바라기 → 실패·턴 유지",
      sameAct.weatherSetFailed === true && !sameAct.setWeather && sameOut.nextState.weatherTurnsRemaining === 1,
      `failed=${sameAct.weatherSetFailed} 남은턴=${sameOut.nextState.weatherTurnsRemaining}`,
    );
    const other = battle([mon("패리퍼", ["비바라기"])], [mon("한카리아스", ["칼춤"])]);
    other.weather = "쾌청";
    other.weatherTurnsRemaining = 2;
    const otherOut = rt.runTurn(other, moveAction("비바라기"), idle, rng);
    check("다른 날씨에 비바라기 → 덮어씀", otherOut.nextState.weather === "비" && otherOut.nextState.weatherTurnsRemaining === 4, `${otherOut.nextState.weather} ${otherOut.nextState.weatherTurnsRemaining}`);
    // 썰렁개그: 이미 눈이어도 실패 후 교체(returnsToTrainer)
    const chilly = battle([mon("야도킹", ["썰렁개그"]), mon("피카츄", ["10만볼트"])], [mon("한카리아스", ["칼춤"])]);
    chilly.weather = "눈";
    chilly.weatherTurnsRemaining = 3;
    const paused = rt.runTurn(chilly, moveAction("썰렁개그"), idle, rng);
    const chillyAct = paused.partialResult?.actions.find((a) => a.actor === "a");
    const resumed = "awaitingSelfSwitch" in paused ? rt.resumeTurn(paused._ctx, 1) : paused;
    const chillySwitch = resumed.result?.switches.find((s) => s.side === "a" && s.afterMove);
    check(
      "이미 눈에 썰렁개그 → 실패해도 교체",
      "awaitingSelfSwitch" in paused && chillyAct?.weatherSetFailed === true && chillySwitch?.returnsToTrainer === true && resumed.nextState.sideA.activeIndex === 1,
      `paused=${"awaitingSelfSwitch" in paused} failed=${chillyAct?.weatherSetFailed} 교체=${chillySwitch?.returnsToTrainer}`,
    );
    // 공격기의 랭크 변화는 맞았을 때만(방어로 막힘·빗나감·상성 무효면 없음)
    const overheat = (defMoves, rngValue) => {
      const s = battle([mon("히트로토무", ["오버히트"], null, null, pts({ spa: 32, hp: 32 }))], [mon("잠만보", defMoves, null, null, pts({ hp: 32 }))]);
      const out = rt.runTurn(s, moveAction("오버히트"), moveAction(defMoves[0]), () => rngValue);
      return out.nextState.a.stages.spa;
    };
    const blocked = overheat(["방어"], 0.5);
    const landed = overheat(["칼춤"], 0.5);
    const missed = overheat(["칼춤"], 0.95);
    check("오버히트: 방어로 막힘·빗나감 → 특공 유지, 명중 → −2", blocked === 0 && missed === 0 && landed === -2, `막힘=${blocked} 빗나감=${missed} 명중=${landed}`);
    const cc = battle([mon("루카리오", ["인파이트"], null, null, pts({ atk: 32 }))], [mon("팬텀", ["칼춤"], null, null, pts({ hp: 32 }))]);
    const ccOut = rt.runTurn(cc, moveAction("인파이트"), moveAction("칼춤"), rng);
    check("인파이트 vs 고스트(무효) → 방어·특방 유지", ccOut.nextState.a.stages.def === 0 && ccOut.nextState.a.stages.spd === 0, `def=${ccOut.nextState.a.stages.def}`);
    // 같은 날씨 특성으로 등장 → 턴 재충전 없음
    const entry = battle([mon("한카리아스", ["칼춤"]), mon("패리퍼", ["비바라기"], "잔비")], [mon("한카리아스", ["칼춤"])]);
    entry.weather = "비";
    entry.weatherTurnsRemaining = 2;
    const entered = sw.applySwitch(entry, "a", 1).nextState;
    check("같은 날씨 특성 등장 → 턴 유지", entered.weatherTurnsRemaining === 2, `남은턴=${entered.weatherTurnsRemaining}`);
  }
  // ── 도감 특성 배선(ver.1.8 트랙 J): 갈지자걸음·총대장 ──
  {
    const hc = await server.ssrLoadModule("/src/lib/battle/hitChance.ts");
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    // 갈지자걸음: 혼란 상태일 때만 상대 명중률 ×0.5, 틀깨기는 무시
    const edge = data.getMove("스톤에지");
    const chance = (confused, attackerAbilityId) => {
      const st = battle([mon("한카리아스", ["스톤에지"], attackerAbilityId)], [mon("핫삼", ["불꽃펀치"], "갈지자걸음")]);
      if (confused) st.b.volatile.active.confusion = { turnsRemaining: 3 };
      const defenderAbility = attackerAbilityId === "틀깨기" ? undefined : data.getAbility("갈지자걸음");
      return hc.computeBattleHitChance({
        state: st, attacker: st.a, defender: st.b, move: edge,
        attackerAbility: attackerAbilityId ? data.getAbility(attackerAbilityId) : undefined, defenderAbility,
        attackerItem: undefined, defenderItem: undefined, attackerMovesSecond: false,
      });
    };
    const calm = chance(false, null);
    const confused = chance(true, null);
    const moldBreaker = chance(true, "틀깨기");
    check("갈지자걸음: 혼란 시 명중 ×0.5·틀깨기 무시", Math.abs(calm - 0.8) < 1e-9 && Math.abs(confused - 0.4) < 1e-9 && Math.abs(moldBreaker - 0.8) < 1e-9, `평상=${calm} 혼란=${confused} 틀깨기=${moldBreaker}`);

    // 총대장: 등장 시 쓰러진 같은 편 수를 세고(로그 2줄), 물러나면 초기화, 위력 ×(1 + 0.1 × 수)
    const overlordParty = () => [
      mon("핫삼", ["불꽃펀치"]),
      mon("메타그로스", ["코멧펀치"]),
      mon("대도각참", ["아이언헤드", "칼춤"], "총대장", null, pts({ atk: 32, hp: 32 })),
    ];
    const foe = () => [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))];
    const two = battle(overlordParty(), foe());
    two.sideA.party[0].currentHp = 0;
    two.sideA.party[1].currentHp = 0;
    two.a.currentHp = 0;
    const entered = sw.applySwitch(two, "a", 2, { voluntary: false });
    const msgs = entered.entryMessages.join(" / ");
    check(
      "총대장: 쓰러진 2마리 → 수 2·발동 로그 2줄",
      entered.nextState.a.supremeOverlordCount === 2 && msgs.includes("대도각참의 총대장!") && msgs.includes("대도각참은 쓰러진 동료에게서 힘을 받았다!"),
      `count=${entered.nextState.a.supremeOverlordCount} ${msgs}`,
    );
    const none = sw.applySwitch(battle(overlordParty(), foe()), "a", 2);
    check("총대장: 쓰러진 동료 없음 → 발동 안 함", none.nextState.a.supremeOverlordCount === 0 && !none.entryMessages.join("").includes("총대장"), none.entryMessages.join(" / "));
    const back = sw.applySwitch(entered.nextState, "a", 0);
    check("총대장: 물러나면 수 초기화", back.nextState.sideA.party[2].supremeOverlordCount === undefined, `${back.nextState.sideA.party[2].supremeOverlordCount}`);
    const hit = (count) => {
      const st = sw.applySwitch(battle(overlordParty(), foe()), "a", 2).nextState;
      st.a.supremeOverlordCount = count;
      const out = rt.runTurn(st, { kind: "move", move: data.getMove("아이언헤드") }, { kind: "move", move: data.getMove("칼춤") }, () => 0.5);
      return out.result.actions.find((a) => a.actor === "a").damage;
    };
    const base = hit(0);
    const boosted = hit(5);
    check("총대장: 수 5 → 데미지 약 1.5배", boosted / base > 1.4 && boosted / base < 1.6, `${base} → ${boosted}`);
  }
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
  // ── 매치업 난수별 데미지(ver.1.7 트랙 H): 기존 격파 판정과 같은 관계식인지 대조 ──
  {
    const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
    let mismatches = 0;
    let checked = 0;
    for (let i = 0; i < 2000; i++) {
      const offense = 50 + ((i * 7919) % 400);
      const bulk = 40 + ((i * 104729) % 300);
      const rolls = bp.damageRollPercents(offense, bulk);
      const chance = bp.evaluateMatchupChance(offense, bulk);
      const ohko = rolls.filter((r) => r.percent + 1e-9 >= 100).length;
      checked++;
      if (chance.verdict === "guaranteed-1hit" && ohko !== 16) mismatches++;
      if (chance.verdict === "random-1hit" && ohko !== chance.killingRolls[0]) mismatches++;
      if ((chance.verdict === "guaranteed-2hit" || chance.verdict === "random-2hit" || chance.verdict === "needs-3hit-plus") && ohko !== 0) mismatches++;
      if (chance.verdict === "needs-3hit-plus" && rolls[15].percent * 2 + 1e-9 >= 100) mismatches++;
    }
    check("난수별 데미지 % ↔ 격파 판정 일치(2000조합)", mismatches === 0, `불일치 ${mismatches}/${checked}`);
  }
  // 상대가 나에게 데미지를 줄 수단이 없을 때(+Infinity 점수)
  {
    const st = battle([mon("팬텀", ["10만볼트"])], [mon("한카리아스", ["지진"])]);
    st.a.effectiveAbilityId = "부유";
    const d = ai.chooseAiAction(st, "a", 0.5);
    check("상대 공격 불가 상황 처리", d.action.kind === "move", d.scored.map((s) => s.score).join(","));
  }

  console.table(rows);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server.close();
}
