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
  // ── 트랙 M1(ver.1.8): 엔진 신규 변화기 + 구애 잠금 엔진 이관 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const st0 = await server.ssrLoadModule("/src/lib/battle/state.ts");
    const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
    const P = dec.DEFAULT_DECISION_PARAMS;
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const turn = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.5).nextState;
    const score = (o, params = P) => dec.scoreOption(o, 0.5, params);
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    // 구애 잠금: 구애스카프를 지닌 채 기술을 쓰면 그 기술로 잠기고, 트릭으로 넘기면 넘긴 쪽은 풀리고 받은 쪽은 다음 기술부터
    {
      const st = battle([mon("팬텀", ["트릭", "섀도볼"], null, "구애스카프")], [mon("잠만보", ["누르기", "하품"], null, "먹다남은음식", pts({ hp: 32 }))]);
      const s1 = turn(st, "섀도볼", "누르기");
      const lockedBefore = st0.choiceLockedMoveOf(s1.a);
      const s2 = turn(s1, "트릭", "누르기");
      const s3 = turn(s2, "섀도볼", "하품");
      check(
        "M1: 트릭 — 도구 교환 + 구애 잠금 이전(넘긴 쪽 해제, 받은 쪽은 받은 뒤 처음 쓴 기술로 잠김 — 같은 턴 후공이면 그 기술)",
        lockedBefore === "섀도볼" && s2.a.currentItemId === "먹다남은음식" && s2.b.currentItemId === "구애스카프" && st0.choiceLockedMoveOf(s2.a) === null && st0.choiceLockedMoveOf(s2.b) === "누르기" && st0.choiceLockedMoveOf(s3.b) === "누르기",
        `잠금전=${lockedBefore} 내도구=${s2.a.currentItemId} 상대도구=${s2.b.currentItemId} 상대잠금=${st0.choiceLockedMoveOf(s2.b)}`,
      );
      const none = battle([mon("팬텀", ["트릭"])], [mon("잠만보", ["누르기"])]);
      const s4 = turn(none, "트릭", "누르기");
      const sticky = battle([mon("팬텀", ["트릭"], null, "구애스카프")], [mon("잠만보", ["누르기"], "점착", "먹다남은음식")]);
      const s5 = turn(sticky, "트릭", "누르기");
      check("M1: 트릭 실패 — 둘 다 무도구·점착", !s4.a.currentItemId && s5.b.currentItemId === "먹다남은음식", `점착=${s5.b.currentItemId}`);
    }
    // 아픔나누기: 두 HP 합을 반씩
    {
      const st = battle([mon("팬텀", ["아픔나누기"], null, null, pts())], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]);
      st.a.currentHp = 20;
      const total = st.a.currentHp + st.b.currentHp;
      const s1 = turn(st, "아픔나누기", "칼춤");
      const half = Math.floor(total / 2);
      check("M1: 아픔나누기 — HP 합을 반씩(최대 HP까지)", s1.a.currentHp === Math.min(s1.a.maxHp, half) && s1.b.currentHp === Math.min(s1.b.maxHp, half), `${s1.a.currentHp}/${s1.b.currentHp} 반=${half}`);
      const o = optOf(battle([mon("팬텀", ["아픔나누기", "섀도볼"], null, null, pts())], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]), "아픔나누기");
      check("M1: 아픔나누기 AI — HP 변화 반영(hpAfter)", !!o.support?.effect?.hpAfter && Number.isFinite(score(o)), JSON.stringify(o.support?.effect?.hpAfter));
    }
    // 순풍: 4턴(쓴 턴 포함) 스피드 2배, 이미 불면 실패, 끝나면 "멈췄다"
    {
      const st = battle([mon("잠만보", ["순풍", "누르기"])], [mon("팬텀", ["칼춤"])]);
      const before = toi.computeTurnOrderSpeed(st, st.a);
      let s = turn(st, "순풍", "칼춤");
      const doubled = toi.computeTurnOrderSpeed(s, s.a);
      const again = rt.runTurn(s, act("순풍"), act("칼춤"), () => 0.5).result.actions.find((x) => x.actor === "a");
      let expired = false;
      for (let i = 0; i < 3; i++) {
        const out = rt.runTurn(s, act("누르기"), act("칼춤"), () => 0.5);
        if (out.result.expiredTailwind?.includes("a")) expired = i === 2;
        s = out.nextState;
      }
      const e = optOf(battle([mon("잠만보", ["순풍", "누르기"])], [mon("팬텀", ["칼춤"])]), "순풍").support?.effect;
      check(
        "M1: 순풍 — 스피드 2배·중복 실패·4턴째 끝에 멈춤 + AI 선공 반영",
        doubled === before * 2 && again?.tailwindSetFailed === true && expired && !(s.sideA.tailwindTurnsRemaining > 0) && e && e.hit.firstProbability >= e.base.firstProbability,
        `스피드 ${before}→${doubled} 멈춤=${expired} p ${e?.base.firstProbability}→${e?.hit.firstProbability}`,
      );
    }
    // 생명의물방울(1/4 회복)·꿀꺽(비축 2 → 1/2 회복·비축과 방어/특방 되돌림, 0이면 실패)·리사이클
    {
      const dew = battle([mon("잠만보", ["생명의물방울"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["칼춤"])]);
      dew.a.currentHp = Math.floor(dew.a.maxHp / 2);
      const d1 = turn(dew, "생명의물방울", "칼춤");
      const sw = battle([mon("잠만보", ["꿀꺽"], null, null, pts({ hp: 32 }))], [mon("팬텀", ["칼춤"])]);
      sw.a.currentHp = 10;
      sw.a.stockpileCount = 2;
      sw.a.stages = { ...sw.a.stages, def: 2, spd: 2 };
      const w1 = turn(sw, "꿀꺽", "칼춤");
      const empty = battle([mon("잠만보", ["꿀꺽"])], [mon("팬텀", ["칼춤"])]);
      const wAct = rt.runTurn(empty, act("꿀꺽"), act("칼춤"), () => 0.5).result.actions.find((x) => x.actor === "a");
      const rc = battle([mon("잠만보", ["리사이클"])], [mon("팬텀", ["칼춤"])]);
      rc.a.currentItemId = null;
      rc.a.lastConsumedItemId = "자뭉열매";
      const r1 = turn(rc, "리사이클", "칼춤");
      check(
        "M1: 생명의물방울·꿀꺽·리사이클",
        d1.a.currentHp - dew.a.currentHp === Math.floor(dew.a.maxHp / 4) &&
          w1.a.currentHp === 10 + Math.floor(w1.a.maxHp / 2) && w1.a.stockpileCount === 0 && w1.a.stages.def === 0 &&
          wAct?.stockpileHealFailed === true && r1.a.currentItemId === "자뭉열매",
        `물방울+${d1.a.currentHp - dew.a.currentHp} 꿀꺽HP=${w1.a.currentHp} 비축=${w1.a.stockpileCount} 리사이클=${r1.a.currentItemId}`,
      );
    }
  }
  // ── 트랙 M2(ver.1.8): 자기암시·원한·봉인·트집·흉내쟁이·경혈찌르기·파워셰어 (엔진) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.5);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 자기암시: 상대 랭크 복사 / 파워셰어: 공격·특공 평균
    {
      const st = battle([mon("팬텀", ["자기암시", "파워셰어"])], [mon("잠만보", ["칼춤"])]);
      st.b.stages = { ...st.b.stages, atk: 2, spe: -1 };
      st.b.accuracyStages = { ...st.b.accuracyStages, evasion: 1 };
      const s1 = run(st, "자기암시", "칼춤").nextState;
      const avgAtk = Math.floor((st.a.realStats.atk + st.b.realStats.atk) / 2);
      const avgSpa = Math.floor((st.a.realStats.spa + st.b.realStats.spa) / 2);
      const s2 = run(st, "파워셰어", "칼춤").nextState;
      check(
        "M2: 자기암시(랭크 복사)·파워셰어(공격·특공 평균)",
        s1.a.stages.atk === 2 && s1.a.stages.spe === -1 && s1.a.accuracyStages.evasion === 1 &&
          s2.a.realStats.atk === avgAtk && s2.b.realStats.atk === avgAtk && s2.a.realStats.spa === avgSpa && s2.b.realStats.spa === avgSpa,
        `복사 atk=${s1.a.stages.atk} spe=${s1.a.stages.spe} 공격=${s2.a.realStats.atk}/${s2.b.realStats.atk}(${avgAtk})`,
      );
    }
    // 원한: 상대 직전 기술 PP −4, 쓴 기술이 없으면 실패
    {
      const st = battle([mon("팬텀", ["원한"])], [mon("잠만보", ["누르기", "칼춤"])]);
      const fresh = actionOf(run(st, "원한", "칼춤"), "a");
      st.b.lastMoveId = "누르기";
      const before = st.b.remainingPp["누르기"];
      const out = run(st, "원한", "칼춤");
      check(
        "M2: 원한 — 직전 기술 PP −4 / 쓴 기술 없으면 실패",
        fresh?.spiteFailed === true && out.nextState.b.remainingPp["누르기"] === before - 4 && actionOf(out, "a")?.spitePp?.amount === 4,
        `PP ${before}→${out.nextState.b.remainingPp["누르기"]} 실패=${fresh?.spiteFailed}`,
      );
    }
    // 트집: 같은 기술 연속 불가 / 봉인: 시전자가 배운 기술 사용 불가
    {
      const st = battle([mon("팬텀", ["트집", "봉인", "누르기"])], [mon("잠만보", ["누르기", "칼춤"])]);
      const t1 = run(st, "트집", "누르기");
      const t2 = run(t1.nextState, "누르기", "누르기");
      const t3 = run(t2.nextState, "누르기", "칼춤");
      const i1 = run(st, "봉인", "누르기");
      const i2 = run(i1.nextState, "누르기", "칼춤");
      const again = actionOf(run(i1.nextState, "봉인", "칼춤"), "a");
      check(
        "M2: 트집(연속 사용 불가)·봉인(시전자 기술 사용 불가·중복 실패)",
        actionOf(t2, "b")?.moveRestrictionKind === "torment" && !actionOf(t3, "b")?.blockedReason &&
          actionOf(i1, "b")?.moveRestrictionKind === "imprison" && !actionOf(i2, "b")?.blockedReason && again?.statusInflictFailed === true,
        `트집=${actionOf(t2, "b")?.moveRestrictionKind} 봉인=${actionOf(i1, "b")?.moveRestrictionKind} 재봉인실패=${again?.statusInflictFailed}`,
      );
    }
    // 흉내쟁이: 이번 턴 먼저 나온 상대 기술을 따라 씀 / 나온 기술이 없거나 방어류면 실패
    {
      const st = battle([mon("잠만보", ["흉내쟁이"])], [mon("팬텀", ["칼춤", "방어"])]);
      const c1 = run(st, "흉내쟁이", "칼춤");
      const fast = battle([mon("팬텀", ["흉내쟁이"])], [mon("잠만보", ["칼춤", "방어"])]);
      const c2 = actionOf(run(fast, "흉내쟁이", "칼춤"), "a");
      const c3 = actionOf(run(st, "흉내쟁이", "방어"), "a");
      // 턴·기절 교체를 넘어서도 직전 기술을 기억한다(사용자 제보: 죽기살기 → 객기로 기절 → 교체해 나온 흉내쟁이 = 객기)
      const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
      const chain = battle([mon("시비꼬", ["죽기살기"]), mon("마임맨", ["흉내쟁이"])], [mon("가디안", ["객기", "사이코키네시스"])]);
      chain.a.currentHp = 5;
      const k1 = run(chain, "죽기살기", "객기");
      const afterFaint = k1.forcedSwitch?.a ? sw.applySwitch(k1.nextState, "a", 1).nextState : k1.nextState;
      const k2 = actionOf(run(afterFaint, "흉내쟁이", "사이코키네시스"), "a");
      check(
        "M2: 흉내쟁이 — 기절 교체 뒤 다음 턴에도 직전 기술(객기)을 따라 씀",
        afterFaint.lastMoveUsedId === "객기" && k2?.copycatCalledMoveName === "객기" && k2.damage > 0,
        `교체 뒤 기록=${afterFaint.lastMoveUsedId} 따라씀=${k2?.copycatCalledMoveName} 데미지=${k2?.damage}`,
      );
      check(
        "M2: 흉내쟁이 — 직전 기술 따라 쓰기 / 없음·방어류면 실패",
        c1.nextState.a.stages.atk === 2 && actionOf(c1, "a")?.copycatCalledMoveName === "칼춤" && c2?.blockedReason === "usageCondition" && c3?.blockedReason === "usageCondition",
        `공격=${c1.nextState.a.stages.atk} 선공=${c2?.blockedReason} 방어=${c3?.blockedReason}`,
      );
    }
    // 경혈찌르기: +6이 아닌 능력 하나가 2 오른다 / 전부 +6이면 실패
    {
      const st = battle([mon("잠만보", ["경혈찌르기"])], [mon("팬텀", ["칼춤"])]);
      const s1 = run(st, "경혈찌르기", "칼춤");
      const sum = (f) => Object.values(f.stages).reduce((a, b) => a + b, 0) + f.accuracyStages.accuracy + f.accuracyStages.evasion;
      const maxed = battle([mon("잠만보", ["경혈찌르기"])], [mon("팬텀", ["칼춤"])]);
      maxed.a.stages = { atk: 6, def: 6, spa: 6, spd: 6, spe: 6 };
      maxed.a.accuracyStages = { accuracy: 6, evasion: 6 };
      const failed = actionOf(run(maxed, "경혈찌르기", "칼춤"), "a");
      check(
        "M2: 경혈찌르기 — 무작위 능력 +2 / 전부 +6이면 실패",
        sum(s1.nextState.a) === 2 && actionOf(s1, "a")?.acupressureRaised?.delta === 2 && failed?.acupressureFailed === true,
        `합=${sum(s1.nextState.a)} ${JSON.stringify(actionOf(s1, "a")?.acupressureRaised)}`,
      );
    }
  }
  // ── 트랙 M2(ver.1.8): AI 평가 ──
  {
    const P = dec.DEFAULT_DECISION_PARAMS;
    const score = (o, params = P) => dec.scoreOption(o, 0.5, params);
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    const offM = { ...P, trackMAware: false };
    // 자기암시: 상대 공격 +2를 복사하면 처치가 빨라진다 / 같은 랭크면 안 씀
    {
      const st = battle([mon("잠만보", ["자기암시", "누르기"], null, null, pts({ atk: 32, hp: 32 }))], [mon("블래키", ["깨물어부수기", "칼춤"])]);
      st.b.stages = { ...st.b.stages, atk: 2, spa: 2 };
      const o = optOf(st, "자기암시");
      const e = o.support?.effect;
      const flat = optOf(battle([mon("잠만보", ["자기암시", "누르기"])], [mon("블래키", ["깨물어부수기"])]), "자기암시");
      check(
        "M2 AI: 자기암시 — 복사한 랭크로 대면 재계산 / 같은 랭크면 안 씀·토글",
        e?.kind === "copyStages" && e.hit.killTurns < e.base.killTurns && Number.isFinite(score(o)) && score(flat) === -Infinity && score(o, offM) === -Infinity,
        `c ${e?.base.killTurns}→${e?.hit.killTurns}`,
      );
    }
    // 파워셰어: 공격이 약한 쪽이 쓰면 처치가 빨라진다
    {
      const st = battle([mon("블래키", ["파워셰어", "지구던지기"], null, null, pts({ hp: 32, def: 32 }))], [mon("메타그로스", ["코멧펀치"])]);
      const e = optOf(st, "파워셰어").support?.effect;
      check("M2 AI: 파워셰어 — 공격·특공 평균 반영", e?.kind === "powerSplit" && e.hit.survivalTurns > e.base.survivalTurns, `d ${e?.base.survivalTurns}→${e?.hit.survivalTurns}`);
    }
    // 원한: 직전 기술 PP를 0으로 만들 때만
    {
      const mk = (pp) => {
        const st = battle([mon("메타그로스", ["원한", "코멧펀치"])], [mon("잠만보", ["누르기"])]);
        st.b.lastMoveId = "누르기";
        st.b.remainingPp["누르기"] = pp;
        return optOf(st, "원한");
      };
      const zero = mk(4);
      const many = mk(12);
      check(
        "M2 AI: 원한 — PP를 0으로 만들면 평가(유일한 공격기 봉쇄) / 아니면 안 씀",
        zero.support?.effect?.kind === "spite" && Number.isFinite(score(zero)) && zero.support.effect.hit.survivalTurns > zero.support.effect.base.survivalTurns && score(many) === -Infinity,
        `d ${zero.support?.effect?.base.survivalTurns}→${zero.support?.effect?.hit.survivalTurns}`,
      );
    }
    // 봉인: 상대 공격기를 나도 배웠으면 그 기술을 막는다 / 겹치는 기술이 없으면 안 씀
    {
      const st = battle([mon("팬텀", ["봉인", "섀도볼"])], [mon("블래키", ["섀도볼"])]);
      const o = optOf(st, "봉인");
      const none = optOf(battle([mon("팬텀", ["봉인", "섀도볼"])], [mon("잠만보", ["누르기"])]), "봉인");
      check(
        "M2 AI: 봉인 — 겹치는 공격기 봉쇄 / 겹치는 기술 없으면 안 씀",
        o.support?.effect?.kind === "imprison" && o.support.effect.hit.survivalTurns > o.support.effect.base.survivalTurns && score(none) === -Infinity,
        `d ${o.support?.effect?.base.survivalTurns}→${o.support?.effect?.hit.survivalTurns}`,
      );
    }
    // 트집: 최선 공격기를 한 턴 걸러 쓰게 된다(대면 절반만큼 섞음)
    {
      const st = battle([mon("잠만보", ["트집", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("메타그로스", ["코멧펀치", "전광석화"])]);
      const e = optOf(st, "트집").support?.effect;
      check(
        "M2 AI: 트집 — 최선 공격기 격턴 봉쇄로 생존 턴 증가",
        e?.kind === "torment" && e.hit.survivalTurns > e.base.survivalTurns && Number.isFinite(e.party?.turns),
        `d ${e?.base.survivalTurns}→${e?.hit.survivalTurns} 섞은턴=${e?.party?.turns}`,
      );
    }
    // 경혈찌르기: 능력별 갈래 평균
    {
      const o = optOf(battle([mon("잠만보", ["경혈찌르기", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("팬텀", ["섀도볼"])]), "경혈찌르기");
      const e = o.support?.effect;
      check("M2 AI: 경혈찌르기 — 7갈래 평균", e?.kind === "acupressure" && e.branches?.length === 7 && Number.isFinite(score(o)), `갈래=${e?.branches?.length}`);
    }
    // 흉내쟁이: 후공이면 상대가 이번 턴 낼 기술 갈래 / 선공인데 나온 기술이 없으면 안 씀
    {
      const slow = optOf(battle([mon("잠만보", ["흉내쟁이", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("메타그로스", ["코멧펀치", "칼춤"])]), "흉내쟁이");
      const fast = optOf(battle([mon("팬텀", ["흉내쟁이", "섀도볼"])], [mon("잠만보", ["누르기"])]), "흉내쟁이");
      const copied = slow.copycat?.branches.filter((b) => b.option).map((b) => b.option.move.id) ?? [];
      check(
        "M2 AI: 흉내쟁이 — 후공 상대 기술 갈래 평가 / 선공·기록 없음이면 안 씀·토글",
        copied.length > 0 && Number.isFinite(score(slow)) && score(fast) === -Infinity && score(slow, offM) === -Infinity,
        `갈래=${copied.join(",")} 점수=${score(slow).toFixed(3)}`,
      );
    }
  }
  // ── 트랙 M3(ver.1.8): 특성·타입 바꾸기 + 특성 면역 + 교체 시 원복 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => 0.5);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 스킬스왑·동료만들기·역할 / 폼 변화 특성(배틀스위치)·트레이스는 안 됨
    {
      const st = battle([mon("팬텀", ["스킬스왑", "동료만들기", "역할"], "부유")], [mon("잠만보", ["칼춤"], "두꺼운지방")]);
      const sw1 = run(st, "스킬스왑", "칼춤").nextState;
      const give = run(st, "동료만들기", "칼춤").nextState;
      const copy = run(st, "역할", "칼춤").nextState;
      const fixed = actionOf(run(battle([mon("팬텀", ["스킬스왑"], "부유")], [mon("킬가르도", ["칼춤"], "배틀스위치")]), "스킬스왑", "칼춤"), "a");
      const trace = actionOf(run(battle([mon("팬텀", ["역할"], "부유")], [mon("잠만보", ["칼춤"], "트레이스")]), "역할", "칼춤"), "a");
      check(
        "M3: 스킬스왑·동료만들기·역할 / 배틀스위치 교환·트레이스 복사는 실패",
        sw1.a.effectiveAbilityId === "두꺼운지방" && sw1.b.effectiveAbilityId === "부유" && give.b.effectiveAbilityId === "부유" &&
          copy.a.effectiveAbilityId === "두꺼운지방" && fixed?.abilityChangeFailed === true && trace?.abilityChangeFailed === true,
        `교환=${sw1.a.effectiveAbilityId}/${sw1.b.effectiveAbilityId} 건넴=${give.b.effectiveAbilityId} 복사=${copy.a.effectiveAbilityId}`,
      );
    }
    // 위액: 특성 무효화 → 물러나면 원래 특성 / 심플빔·숲의저주도 물러나면 원복
    {
      const st = battle([mon("팬텀", ["위액", "심플빔", "숲의저주", "칼춤"])], [mon("잠만보", ["칼춤"], "두꺼운지방"), mon("메타그로스", ["코멧펀치"])]);
      const s1 = run(st, "위액", "칼춤").nextState;
      const s2 = run(run(s1, "심플빔", "칼춤").nextState, "숲의저주", "칼춤").nextState;
      const out = run(s2, "칼춤", { kind: "switch", toIndex: 1 }).nextState;
      const back = run(out, "칼춤", { kind: "switch", toIndex: 0 }).nextState;
      check(
        "M3: 위액(특성 무효) + 교체하면 특성·타입 원복(심플빔·숲의저주 포함)",
        s1.b.effectiveAbilityId === null && s1.b.abilitySuppressed === true && s2.b.effectiveAbilityId === "단순" && s2.b.types.includes("풀") &&
          back.b.effectiveAbilityId === "두꺼운지방" && !back.b.types.includes("풀") && !back.b.abilitySuppressed,
        `위액=${s1.b.effectiveAbilityId} 심플빔=${s2.b.effectiveAbilityId} 복귀=${back.b.effectiveAbilityId} 타입=${back.b.types}`,
      );
    }
    // 고민씨: 잠든 상대가 불면이 되면 바로 깬다 / 물붓기·미러타입
    {
      const st = battle([mon("팬텀", ["고민씨", "물붓기", "미러타입"])], [mon("잠만보", ["칼춤"])]);
      st.b.status = { condition: "sleep", turnsElapsed: 0, sleepTurns: 3 };
      const w = run(st, "고민씨", "칼춤");
      const soak = run(st, "물붓기", "칼춤").nextState;
      const mirror = run(st, "미러타입", "칼춤").nextState;
      check(
        "M3: 고민씨(불면 → 잠이 깸)·물붓기(단일 물)·미러타입(상대 타입 복사)",
        w.nextState.b.effectiveAbilityId === "불면" && !w.nextState.b.status.condition && actionOf(w, "a")?.curedStatus === "sleep" &&
          soak.b.types.join() === "물" && mirror.a.types.join() === st.b.types.join(),
        `고민씨=${w.nextState.b.effectiveAbilityId}/${w.nextState.b.status.condition} 물붓기=${soak.b.types} 미러=${mirror.a.types}`,
      );
    }
    // 특성 면역: 마이페이스(혼란) · 둔감(도발) · 정신력(위협)
    {
      const conf = actionOf(run(battle([mon("팬텀", ["이상한빛"])], [mon("잠만보", ["칼춤"], "마이페이스")]), "이상한빛", "칼춤"), "a");
      const taunt = actionOf(run(battle([mon("팬텀", ["도발"])], [mon("잠만보", ["칼춤"], "둔감")]), "도발", "칼춤"), "a");
      const intim = battle([mon("갸라도스", ["폭포오르기"], "위협")], [mon("잠만보", ["칼춤"], "정신력")]);
      const plain = battle([mon("갸라도스", ["폭포오르기"], "위협")], [mon("잠만보", ["칼춤"])]);
      check(
        "M3: 마이페이스 혼란 면역·둔감 도발 면역·정신력 위협 면역",
        conf?.volatileBlockedByAbility?.volatile === "confusion" && taunt?.volatileBlockedByAbility?.volatile === "taunt" &&
          intim.b.stages.atk === 0 && plain.b.stages.atk === -1,
        `혼란=${conf?.volatileBlockedByAbility?.abilityName} 도발=${taunt?.volatileBlockedByAbility?.abilityName} 위협 atk=${intim.b.stages.atk}/${plain.b.stages.atk}`,
      );
    }
    // AI: 물붓기로 땅타입을 물로 → 10만볼트가 통함 / 위액으로 두꺼운지방 해제 → 화염방사가 잘 들어감 / 토글
    {
      const P = dec.DEFAULT_DECISION_PARAMS;
      const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
      const soak = optOf(battle([mon("로토무", ["물붓기", "10만볼트"])], [mon("한카리아스", ["스톤에지"])]), "물붓기").support?.effect;
      const gastroOpt = optOf(battle([mon("리자몽", ["위액", "화염방사"])], [mon("잠만보", ["누르기"], "두꺼운지방", null, pts({ hp: 32 }))]), "위액");
      const gastro = gastroOpt.support?.effect;
      check(
        "M3 AI: 물붓기(면역 → 통함)·위액(두꺼운지방 해제) 재평가 + 토글",
        soak?.kind === "typeSet" && soak.base.killTurns === Infinity && Number.isFinite(soak.hit.killTurns) &&
          gastro?.kind === "abilitySuppress" && gastro.hit.killTurns < gastro.base.killTurns &&
          dec.scoreOption(gastroOpt, 0.5, { ...P, trackMAware: false }) === -Infinity,
        `물붓기 c ${soak?.base.killTurns}→${soak?.hit.killTurns} 위액 c ${gastro?.base.killTurns}→${gastro?.hit.killTurns}`,
      );
    }
  }
  // ── 트랙 M4(ver.1.8): 원더룸·매직룸·중력·전자부유·떨어뜨리기 + 접지 판정 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => 0.5);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 원더룸: 물리 기술이 특방으로 받아진다(메타그로스 방어 > 특방 → 더 아픔) / 다시 쓰면 해제 · 트릭룸도 다시 쓰면 해제
    {
      const st = battle([mon("한카리아스", ["지진", "원더룸", "트릭룸"])], [mon("메타그로스", ["원더룸", "칼춤"], null, null, pts({ hp: 32 }))]);
      const plain = actionOf(run(st, "지진", "칼춤"), "a").damage;
      const roomed = run(st, "원더룸", "칼춤").nextState;
      const inRoom = actionOf(run(roomed, "지진", "칼춤"), "a").damage;
      const off = run(roomed, "원더룸", "칼춤");
      const tr = run(run(st, "트릭룸", "칼춤").nextState, "트릭룸", "칼춤");
      check(
        "M4: 원더룸(방어·특방 맞바꿈)·다시 쓰면 해제 · 트릭룸도 다시 쓰면 해제",
        inRoom > plain && off.nextState.wonderRoomTurnsRemaining === undefined && actionOf(off, "a")?.roomChange?.on === false &&
          tr.nextState.trickRoomTurnsRemaining === undefined && actionOf(tr, "a")?.trickRoomEnded === true,
        `데미지 ${plain}→${inRoom} 해제=${off.nextState.wonderRoomTurnsRemaining} 트릭룸=${tr.nextState.trickRoomTurnsRemaining}`,
      );
    }
    // 매직룸: 구애스카프 스피드·먹다남은음식 회복이 꺼진다
    {
      const st = battle([mon("잠만보", ["매직룸", "칼춤"], null, "구애스카프", pts({ hp: 32 }))], [mon("메타그로스", ["칼춤"], null, "먹다남은음식")]);
      const before = toi.computeTurnOrderSpeed(st, st.a);
      st.b.currentHp = 100;
      const out = run(st, "매직룸", "칼춤").nextState;
      const after = toi.computeTurnOrderSpeed(out, out.a);
      check(
        "M4: 매직룸 — 구애스카프 스피드·먹다남은음식 회복 무효",
        out.magicRoomTurnsRemaining > 0 && after < before && out.b.currentHp === 100,
        `스피드 ${before}→${after} 음식 HP=${out.b.currentHp}`,
      );
    }
    // 중력: 비행 타입도 지진에 맞고 공중날기는 못 씀 / 이미 있으면 실패 / 5턴째 끝에 해제
    {
      const st = battle([mon("한카리아스", ["중력", "지진", "칼춤"])], [mon("갸라도스", ["공중날기", "칼춤"], null, null, pts({ hp: 32 }))]);
      const immune = actionOf(run(st, "지진", "칼춤"), "a").damage;
      let s = run(st, "중력", "칼춤").nextState;
      const eq = actionOf(run(s, "지진", "칼춤"), "a").damage;
      const fly = actionOf(run(s, "지진", "공중날기"), "b");
      const again = actionOf(run(s, "중력", "칼춤"), "a");
      let expired = false;
      for (let i = 0; i < 4; i++) {
        const out = run(s, "칼춤", "칼춤");
        if (out.result.expiredFieldEffects?.includes("gravity")) expired = i === 3;
        s = out.nextState;
      }
      check(
        "M4: 중력 — 비행 타입 접지·공중날기 사용 불가·중복 실패·5턴 해제",
        immune === 0 && eq > 0 && fly?.moveRestrictionKind === "gravity" && again?.gravitySetFailed === true && expired && s.gravityTurnsRemaining === undefined,
        `지진 ${immune}→${eq} 공중날기=${fly?.moveRestrictionKind} 해제=${expired}`,
      );
    }
    // 전자부유: 지진 무시 / 떨어뜨리기에 맞으면 풀리고 땅에 붙잡힘 / 중력 중엔 실패
    {
      const st = battle([mon("로토무", ["전자부유", "칼춤"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["지진", "떨어뜨리기", "중력"])]);
      const s1 = run(st, "전자부유", "칼춤").nextState;
      const dodge = actionOf(run(s1, "칼춤", "지진"), "b").damage;
      const smack = run(s1, "칼춤", "떨어뜨리기");
      const hit = actionOf(run(smack.nextState, "칼춤", "지진"), "b").damage;
      const grav = run(st, "칼춤", "중력").nextState;
      const failed = actionOf(run(grav, "전자부유", "칼춤"), "a");
      check(
        "M4: 전자부유(땅 무시) · 떨어뜨리기(풀리고 접지) · 중력 중엔 사용 불가",
        s1.a.magnetRiseTurnsRemaining > 0 && dodge === 0 && smack.nextState.a.smackedDown === true && actionOf(smack, "b")?.smackedDownTarget === true &&
          hit > 0 && failed?.moveRestrictionKind === "gravity",
        `부유 지진=${dodge} 떨어뜨린 뒤=${hit} 중력 중=${failed?.moveRestrictionKind}`,
      );
    }
    // 필드 접지: 비행 타입은 그래스필드 회복을 못 받고 미스트필드로 상태이상이 막히지 않는다
    {
      const st = battle([mon("로토무", ["도깨비불"])], [mon("갸라도스", ["칼춤"], null, null, pts({ hp: 32 }))]);
      st.field = "그래스필드";
      st.fieldTurnsRemaining = 5;
      st.b.currentHp = 100;
      const grassy = run(st, "도깨비불", "칼춤").nextState;
      const misty = battle([mon("로토무", ["도깨비불"])], [mon("갸라도스", ["칼춤"])]);
      misty.field = "미스트필드";
      misty.fieldTurnsRemaining = 5;
      const burned = run(misty, "도깨비불", "칼춤").nextState;
      check(
        "M4: 비행 타입은 필드 밖 — 그래스필드 회복 없음·미스트필드 상태이상 보호 없음",
        grassy.b.currentHp <= 100 && burned.b.status.condition === "burn",
        `그래스 HP=${grassy.b.currentHp} 미스트 화상=${burned.b.status.condition}`,
      );
    }
    // AI: 땅 기술밖에 없을 때 중력으로 비행 타입을 잡을 수 있게 됨 / 전자부유로 땅 기술을 피함
    {
      const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
      const g = optOf(battle([mon("한카리아스", ["중력", "지진"])], [mon("갸라도스", ["폭포오르기"])]), "중력").support?.effect;
      const m = optOf(battle([mon("로토무", ["전자부유", "10만볼트"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["지진"])]), "전자부유").support?.effect;
      check(
        "M4 AI: 중력(비행 타입에 지진이 통함)·전자부유(지진 회피) 재평가",
        g?.kind === "gravity" && g.base.killTurns === Infinity && Number.isFinite(g.hit.killTurns) && m?.kind === "magnetRise" && m.hit.survivalTurns > m.base.survivalTurns,
        `중력 c ${g?.base.killTurns}→${g?.hit.killTurns} 전자부유 d ${m?.base.survivalTurns}→${m?.hit.survivalTurns}`,
      );
    }
  }
  // ── 트랙 M5(ver.1.8): 데미지 로직이 없던 데미지 기술 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.3) => rt.runTurn(st, act(a), act(b), () => r);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 일렉트릭볼(빠를수록 강함)·하드프레스(상대 HP 많을수록 강함)·분노의앞니(상대 HP 절반)
    {
      const fast = actionOf(run(battle([mon("로토무", ["일렉트릭볼"])], [mon("잠만보", ["칼춤"])]), "일렉트릭볼", "칼춤"), "a").damage;
      const slowSt = battle([mon("로토무", ["일렉트릭볼"])], [mon("잠만보", ["칼춤"])]);
      slowSt.a.stages = { ...slowSt.a.stages, spe: -6 };
      const slow = actionOf(run(slowSt, "일렉트릭볼", "칼춤"), "a").damage;
      const full = actionOf(run(battle([mon("메타그로스", ["하드프레스"])], [mon("잠만보", ["칼춤"])]), "하드프레스", "칼춤"), "a").damage;
      const halfSt = battle([mon("메타그로스", ["하드프레스"])], [mon("잠만보", ["칼춤"])]);
      halfSt.b.currentHp = Math.floor(halfSt.b.maxHp / 4);
      const quarter = actionOf(run(halfSt, "하드프레스", "칼춤"), "a").damage;
      const fangSt = battle([mon("메타그로스", ["분노의앞니"])], [mon("잠만보", ["칼춤"])]);
      const fang = run(fangSt, "분노의앞니", "칼춤").nextState.b.currentHp;
      check(
        "M5: 일렉트릭볼·하드프레스 가변 위력 · 분노의앞니 HP 절반",
        fast > slow && slow > 0 && full > quarter && quarter > 0 && fang === fangSt.b.maxHp - Math.floor(fangSt.b.maxHp / 2),
        `일렉트릭볼 ${fast}/${slow} 하드프레스 ${full}/${quarter} 앞니 남은=${fang}`,
      );
    }
    // 일격기: 명중하면 기절(명중 30%, 랭크 무시) · 옹골참 무효 · 절대영도는 얼음 무효·비얼음 사용자 20%
    {
      const hit = run(battle([mon("한카리아스", ["땅가르기"])], [mon("잠만보", ["칼춤"])]), "땅가르기", "칼춤", 0.29);
      const missSt = battle([mon("한카리아스", ["땅가르기"])], [mon("잠만보", ["칼춤"])]);
      missSt.a.accuracyStages = { ...missSt.a.accuracyStages, accuracy: 6 };
      const miss = actionOf(run(missSt, "땅가르기", "칼춤", 0.31), "a");
      const sturdy = actionOf(run(battle([mon("한카리아스", ["땅가르기"])], [mon("잠만보", ["칼춤"], "옹골참")]), "땅가르기", "칼춤", 0.1), "a");
      const iceImmune = actionOf(run(battle([mon("로토무", ["절대영도"])], [mon("알로라나인테일", ["칼춤"])]), "절대영도", "칼춤", 0.1), "a");
      const nonIce = actionOf(run(battle([mon("로토무", ["절대영도"])], [mon("잠만보", ["칼춤"])]), "절대영도", "칼춤", 0.25), "a");
      check(
        "M5: 일격기 — 30%·랭크 무시·옹골참 무효 · 절대영도 20%(비얼음 사용자)",
        hit.nextState.b.currentHp === 0 && !miss.hit && sturdy?.ohkoBlockedByAbilityName === "옹골참" && nonIce.hit === false && iceImmune?.ohkoImmune === true && iceImmune.damage === 0,
        `기절=${hit.nextState.b.currentHp === 0} 명중+6 빗나감=${!miss.hit} 옹골참=${sturdy?.ohkoBlockedByAbilityName} 비얼음 0.25=${nonIce.hit} 얼음상대=${iceImmune.damage}`,
      );
    }
    // 목숨걸기: 내 HP만큼 주고 기절 · 면역(고스트)이면 기절 안 함 · AI는 희생 평가(파티 모드)
    {
      const st = battle([mon("로토무", ["목숨걸기"])], [mon("잠만보", ["칼춤"])]);
      const myHp = st.a.currentHp;
      const out = run(st, "목숨걸기", "칼춤").nextState;
      const ghost = run(battle([mon("로토무", ["목숨걸기"])], [mon("팬텀", ["칼춤"])]), "목숨걸기", "칼춤").nextState;
      const o = opt(ev.evaluateOptions(battle([mon("로토무", ["목숨걸기", "10만볼트"]), mon("메타그로스", ["코멧펀치"])], [mon("잠만보", ["누르기"])]), "a"), "목숨걸기");
      check(
        "M5: 목숨걸기 — 내 HP만큼·기절 · 고스트 면역이면 기절 안 함 · AI 희생 평가",
        out.a.currentHp === 0 && out.b.maxHp - out.b.currentHp === myHp && ghost.a.currentHp > 0 &&
          o.support?.effect?.kind === "finalGambit" && !!o.support.effect.sacrifice && Number.isFinite(dec.scoreOption(o, 0.5)),
        `데미지=${out.b.maxHp - out.b.currentHp}/${myHp} 고스트 뒤 내 HP=${ghost.a.currentHp} 점수=${dec.scoreOption(o, 0.5).toFixed(3)}`,
      );
    }
  }
  // ── 트랙 M5: 내던지기(도구 위력·소모·도구 효과) + 자폭류 AI 희생 평가 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.3);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    {
      const ball = battle([mon("메타그로스", ["내던지기"], null, "검은철구")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]);
      const b1 = run(ball, "내던지기", "칼춤");
      const orb = run(battle([mon("메타그로스", ["내던지기"], null, "전기구슬")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]), "내던지기", "칼춤");
      const berrySt = battle([mon("메타그로스", ["내던지기"], null, "오랭열매")], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]);
      berrySt.b.currentHp = 100;
      const berry = actionOf(run(berrySt, "내던지기", "칼춤"), "a");
      const none = actionOf(run(battle([mon("메타그로스", ["내던지기"])], [mon("잠만보", ["칼춤"])]), "내던지기", "칼춤"), "a");
      check(
        "M5: 내던지기 — 도구 위력·소모(리사이클 가능)·전기구슬 마비·열매는 상대가 먹음·도구 없으면 실패",
        actionOf(b1, "a").damage > 0 && b1.nextState.a.currentItemId === null && b1.nextState.a.lastConsumedItemId === "검은철구" &&
          orb.nextState.b.status.condition === "paralysis" && (berry?.flingEffect?.berry?.healed ?? 0) > 0 && none?.blockedReason === "usageCondition",
        `철구 데미지=${actionOf(b1, "a").damage} 마비=${orb.nextState.b.status.condition} 열매 회복=${berry?.flingEffect?.berry?.healed} 무도구=${none?.blockedReason}`,
      );
    }
    {
      const o = opt(ev.evaluateOptions(battle([mon("메타그로스", ["대폭발", "코멧펀치"]), mon("잠만보", ["누르기"])], [mon("블래키", ["깨물어부수기"])]), "a"), "대폭발");
      const off = dec.scoreOption(o, 0.5, { ...dec.DEFAULT_DECISION_PARAMS, trackMAware: false });
      check(
        "M5 AI: 자폭류(대폭발) — 자신 기절을 반영한 희생 평가",
        o.support?.effect?.kind === "selfDestruct" && !!o.support.effect.sacrifice && Number.isFinite(dec.scoreOption(o, 0.5)) && off === -Infinity,
        `점수=${dec.scoreOption(o, 0.5).toFixed(3)} 성공=${o.support?.effect?.sacrifice?.success}`,
      );
    }
  }
  // ── 트랙 M6(ver.1.8): 교체 봉쇄·치유소원·부식가스·록온·자기장조작·집단구타 + 자동 검사 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b, r = 0.3) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => r);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 검은눈빛: 교체 불가(고스트 면제) · 건 쪽이 물러나면 풀림 · 아름다운허물은 무시 · 페어리록: 다음 턴 교체 불가
    {
      const st = battle([mon("블래키", ["검은눈빛", "칼춤"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["칼춤"]), mon("한카리아스", ["지진"])]);
      const s1 = run(st, "검은눈빛", "칼춤").nextState;
      const trapped = sw.isTrappedFromSwitching(s1.b, s1);
      const tryOut = run(s1, "칼춤", { kind: "switch", toIndex: 1 }).nextState;
      const freed = run(s1, { kind: "switch", toIndex: 1 }, "칼춤").nextState;
      const shed = battle([mon("블래키", ["검은눈빛"])], [mon("메타그로스", ["칼춤"], null, "아름다운허물")]);
      const s2 = run(shed, "검은눈빛", "칼춤").nextState;
      const ghost = actionOf(run(battle([mon("블래키", ["검은눈빛"])], [mon("팬텀", ["칼춤"])]), "검은눈빛", "칼춤"), "a");
      const fl = run(battle([mon("블래키", ["페어리록"])], [mon("메타그로스", ["칼춤"])]), "페어리록", "칼춤").nextState;
      check(
        "M6: 검은눈빛(교체 불가·고스트 면제·건 쪽이 물러나면 해제)·아름다운허물·페어리록",
        trapped && tryOut.sideB.activeIndex === 0 && !sw.isTrappedFromSwitching(freed.b, freed) && !sw.isTrappedFromSwitching(s2.b, s2) &&
          ghost?.statusInflictFailed === true && sw.isTrappedFromSwitching(fl.b, fl),
        `봉쇄=${trapped} 교체시도 후 활성=${tryOut.sideB.activeIndex} 허물=${sw.isTrappedFromSwitching(s2.b, s2)} 페어리록=${sw.isTrappedFromSwitching(fl.b, fl)}`,
      );
    }
    // 치유소원: 자신 기절 → 다음에 나온 포켓몬 HP·상태이상 전부 회복 / 교대할 포켓몬이 없으면 실패
    {
      const st = battle([mon("팬텀", ["치유소원"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["칼춤"])]);
      st.sideA.party[1].currentHp = 10;
      st.sideA.party[1].status = { condition: "burn", turnsElapsed: 0 };
      const out = run(st, "치유소원", "칼춤");
      const after = sw.applySwitch(out.nextState, "a", 1).nextState;
      const alone = actionOf(run(battle([mon("팬텀", ["치유소원"])], [mon("메타그로스", ["칼춤"])]), "치유소원", "칼춤"), "a");
      check(
        "M6: 치유소원 — 기절 후 나온 포켓몬 전부 회복 / 교대 불가면 실패",
        out.nextState.a.currentHp === 0 && after.a.currentHp === after.a.maxHp && !after.a.status.condition && alone?.healingWishFailed === true,
        `기절=${out.nextState.a.currentHp} 나온 HP=${after.a.currentHp}/${after.a.maxHp} 상태=${after.a.status.condition}`,
      );
    }
    // 부식가스(도구 제거·리사이클 불가)·록온(다음 일격기 필중)·자기장조작(플러스만)·집단구타(파티원마다 1타)
    {
      const gas = run(battle([mon("블래키", ["부식가스"])], [mon("메타그로스", ["칼춤"], null, "먹다남은음식")]), "부식가스", "칼춤").nextState;
      const lock = run(battle([mon("한카리아스", ["록온", "땅가르기"])], [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32 }))]), "록온", "칼춤").nextState;
      const ohko = run(lock, "땅가르기", "칼춤", 0.99).nextState;
      const flux = run(battle([mon("로토무", ["자기장조작"], "플러스")], [mon("메타그로스", ["칼춤"])]), "자기장조작", "칼춤").nextState;
      const noFlux = actionOf(run(battle([mon("로토무", ["자기장조작"])], [mon("메타그로스", ["칼춤"])]), "자기장조작", "칼춤"), "a");
      const beat = actionOf(run(battle([mon("블래키", ["집단구타"]), mon("잠만보", ["누르기"]), mon("메타그로스", ["칼춤"])], [mon("잠만보", ["칼춤"])]), "집단구타", "칼춤"), "a");
      check(
        "M6: 부식가스·록온(일격기 필중)·자기장조작(플러스만)·집단구타(3마리 → 3타)",
        gas.b.currentItemId === null && gas.b.lastConsumedItemId === undefined && ohko.b.currentHp === 0 &&
          flux.a.stages.def === 1 && flux.a.stages.spd === 1 && noFlux?.magneticFluxFailed === true && beat.damage > 0 && beat.hitCount === 3,
        `부식가스=${gas.b.currentItemId} 록온 일격=${ohko.b.currentHp === 0} 자기장=${flux.a.stages.def}/${flux.a.stages.spd} 집단구타 ${beat.hitCount}타 ${beat.damage}`,
      );
    }
    // AI: 부식가스(먹다남은음식 제거)·치유소원(희생 평가)·자기장조작 — 평가 가능 + 토글
    {
      const P = dec.DEFAULT_DECISION_PARAMS;
      const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
      const gas = optOf(battle([mon("블래키", ["부식가스", "깨물어부수기"])], [mon("메타그로스", ["코멧펀치"], null, "먹다남은음식")]), "부식가스");
      const wish = optOf(battle([mon("팬텀", ["치유소원", "섀도볼"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"])]), "치유소원");
      check(
        "M6 AI: 부식가스·치유소원 평가 + 토글",
        gas.support?.effect?.kind === "itemRemove" && Number.isFinite(dec.scoreOption(gas, 0.5)) &&
          wish.support?.effect?.kind === "healingWish" && !!wish.support.effect.sacrifice &&
          dec.scoreOption(gas, 0.5, { ...P, trackMAware: false }) === -Infinity,
        `부식가스=${dec.scoreOption(gas, 0.5).toFixed(3)} 치유소원=${dec.scoreOption(wish, 0.5)}`,
      );
    }
    // 자동 검사(재발 방지 — 트랙 M 원인): 효과 필드가 없는 변화기는 더블 전용 목록에만, 위력 null 데미지 기술은 위력 계산 필드가 있어야
    {
      const baseKeys = new Set(["id", "name", "type", "category", "power", "accuracy", "pp", "priority", "effect", "tags", "makesContact", "classification", "notReflectable", "excludedFromCopycat", "excludedFromSleepTalk", "usageCondition", "requiresWeather"]);
      const doublesOnly = new Set(["도우미", "코칭", "와이드가드", "당신먼저", "사이드체인지", "드래곤옐", "분노가루", "순서미루기", "아로마미스트", "지휘", "데코레이션", "날따름"]);
      const powerKeys = ["fixedDamage", "flingsHeldItem", "damageEqualsUserHp", "counters", "countersAllCategories", "reversalPower", "targetAbsoluteWeightPower", "targetHpRatioPower", "setsTargetHpToUserHp", "spitUpPower", "beatUpPower", "weightRatioPower", "gyroBallPower", "electroBallPower", "halvesTargetHp", "oneHitKo"];
      const all = data.MOVES;
      const noEffect = all.filter((m) => m.category === "status" && Object.keys(m).every((k) => baseKeys.has(k)) && !doublesOnly.has(m.name));
      const noPower = all.filter((m) => m.category !== "status" && m.power === null && !powerKeys.some((k) => m[k] !== undefined));
      check(
        "자동 검사: 효과 없는 변화기(더블 전용 제외)·위력 계산 없는 데미지 기술 0건",
        noEffect.length === 0 && noPower.length === 0,
        `변화기=${noEffect.map((m) => m.name).join(",")} 데미지=${noPower.map((m) => m.name).join(",")}`,
      );
    }
  }
  // ── 트랙 L(ver.1.8): 성묘 — 쓰러진 같은 편 수만큼 위력(엔진·AI 같은 계산) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const dmg = (fainted) => {
      const st = battle([mon("팬텀", ["성묘"]), mon("잠만보", ["누르기"]), mon("메타그로스", ["칼춤"])], [mon("블래키", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))]);
      for (let i = 1; i <= fainted; i++) st.sideA.party[i].currentHp = 0;
      const out = rt.runTurn(st, act("성묘"), act("칼춤"), () => 0.5);
      const ai = opt(ev.evaluateOptions(st, "a"), "성묘");
      return { damage: out.result.actions.find((x) => x.actor === "a").damage, aiTurns: ai.hitsToKill.expected };
    };
    const d0 = dmg(0);
    const d2 = dmg(2);
    check(
      "트랙 L: 성묘 — 쓰러진 동료 2마리면 위력 150(엔진 데미지·AI 처치 턴 모두 반영)",
      d2.damage > d0.damage * 2 && d2.aiTurns < d0.aiTurns,
      `데미지 ${d0.damage}→${d2.damage} AI 처치 턴 ${d0.aiTurns.toFixed(2)}→${d2.aiTurns.toFixed(2)}`,
    );
  }
  // ── 변화기 판단 Tier 2-A(ver.1.8) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, act(a), act(b), () => 0.3);
    const P = dec.DEFAULT_DECISION_PARAMS;
    const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
    // 엔진: 치료방울은 대기 포켓몬까지 · 코트체인지는 순풍도 맞바꿈
    {
      const st = battle([mon("잠만보", ["치료방울"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["칼춤"])]);
      st.a.status = { condition: "burn", turnsElapsed: 0 };
      st.sideA.party[1].status = { condition: "paralysis", turnsElapsed: 0 };
      const bell = run(st, "치료방울", "칼춤").nextState;
      const court = battle([mon("블래키", ["코트체인지"])], [mon("잠만보", ["칼춤"])]);
      court.sideB.tailwindTurnsRemaining = 3;
      court.sideB.hazards = { ...court.sideB.hazards, stealthRock: true };
      const c1 = run(court, "코트체인지", "칼춤").nextState;
      check(
        "T2-A: 치료방울 대기 포켓몬까지 치료 · 코트체인지 순풍·설치물 맞바꿈",
        !bell.a.status.condition && !bell.sideA.party[1].status.condition && c1.sideA.tailwindTurnsRemaining > 0 && c1.sideB.hazards.stealthRock === false && c1.sideA.hazards.stealthRock === true,
        `치료=${bell.a.status.condition}/${bell.sideA.party[1].status.condition} 순풍 A=${c1.sideA.tailwindTurnsRemaining}`,
      );
    }
    // AI: 파워스왑(상대 +2 공격을 가져옴)·뒤집어엎기(상대 +2 → −2)·변신 평가 + 토글
    {
      const swapSt = battle([mon("잠만보", ["파워스왑", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("블래키", ["깨물어부수기"])]);
      swapSt.b.stages = { ...swapSt.b.stages, atk: 2 };
      const swap = optOf(swapSt, "파워스왑");
      const topsySt = battle([mon("잠만보", ["뒤집어엎기", "누르기"], null, null, pts({ hp: 32, atk: 32 }))], [mon("블래키", ["깨물어부수기"])]);
      topsySt.b.stages = { ...topsySt.b.stages, atk: 2 };
      const topsy = optOf(topsySt, "뒤집어엎기").support?.effect;
      const tf = optOf(battle([mon("메타그로스", ["변신", "코멧펀치"])], [mon("한카리아스", ["지진"])]), "변신");
      const se = swap.support?.effect;
      check(
        "T2-A AI: 파워스왑·뒤집어엎기·변신 재평가 + tier2Aware 토글",
        se?.kind === "stageSwap" && se.hit.killTurns < se.base.killTurns && se.hit.survivalTurns > se.base.survivalTurns &&
          topsy?.kind === "invertStages" && topsy.hit.survivalTurns > topsy.base.survivalTurns &&
          tf.support?.effect?.kind === "transform" && Number.isFinite(dec.scoreOption(tf, 0.5)) &&
          dec.scoreOption(swap, 0.5, { ...P, tier2Aware: false }) === -Infinity,
        `파워스왑 c ${se?.base.killTurns}→${se?.hit.killTurns} d ${se?.base.survivalTurns}→${se?.hit.survivalTurns} 뒤집어 d ${topsy?.base.survivalTurns}→${topsy?.hit.survivalTurns}`,
      );
    }
    // 엔진: 다과회는 양쪽 모두 열매를 바로 먹는다(HP 조건 무시) · 아무도 없으면 실패
    {
      const st = battle([mon("잠만보", ["다과회"], null, "자뭉열매")], [mon("블래키", ["칼춤"], null, "리샘열매")]);
      st.a.currentHp -= 30;
      st.b.status = { condition: "sleep", turnsElapsed: 0, sleepTurns: 3 };
      const out = run(st, "다과회", "칼춤");
      const tea = out.result.actions.find((x) => x.actor === "a");
      const none = run(battle([mon("잠만보", ["다과회"])], [mon("블래키", ["칼춤"])]), "다과회", "칼춤").result.actions.find((x) => x.actor === "a");
      check(
        "T2-B: 다과회 양쪽 열매 즉시 발동 · 열매 없으면 실패",
        tea?.teaTime?.self?.healed > 0 && tea?.teaTime?.opponent?.curedStatus === "sleep" && !out.nextState.a.currentItemId && !out.nextState.b.currentItemId && none?.teaTimeFailed === true,
        `회복=${tea?.teaTime?.self?.healed} 치료=${tea?.teaTime?.opponent?.curedStatus} 실패=${none?.teaTimeFailed}`,
      );
    }
    // AI: 회생의기도(쓰러진 동료 부활)·멸망의노래(긴 대면에서 양쪽 기절)·다과회·문어굳히기 평가 + 토글
    {
      const revSt = battle([mon("잠만보", ["회생의기도", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]);
      revSt.sideA.party[1].currentHp = 0;
      const rev = optOf(revSt, "회생의기도");
      const noRev = optOf(battle([mon("잠만보", ["회생의기도", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]), "회생의기도");
      // 서로 못 쓰러뜨리는 긴 대면(둘 다 변화기뿐)이면 멸망의노래가 평가된다 / 짧은 대면이면 고르지 않는다
      const perish = optOf(battle([mon("팬텀", ["멸망의노래", "섀도볼"]), mon("잠만보", ["누르기"])], [mon("블래키", ["칼춤"])]), "멸망의노래");
      const shortPerish = optOf(battle([mon("팬텀", ["멸망의노래", "섀도볼"]), mon("잠만보", ["누르기"])], [mon("한카리아스", ["지진"])]), "멸망의노래");
      const teaSt = battle([mon("잠만보", ["다과회", "누르기"], null, "자뭉열매")], [mon("블래키", ["깨물어부수기"])]);
      teaSt.a.currentHp = Math.floor(teaSt.a.maxHp / 2);
      const tea = optOf(teaSt, "다과회");
      const octo = optOf(battle([mon("메타그로스", ["문어굳히기", "코멧펀치"])], [mon("잠만보", ["누르기"])]), "문어굳히기");
      const re = rev.support?.effect;
      check(
        "T2-B AI: 회생의기도·멸망의노래·다과회·문어굳히기 평가 + tier2Aware 토글",
        re?.kind === "revive" && re.partyShift?.extraCount === 1 && Number.isFinite(dec.scoreOption(rev, 0.5)) && !noRev.support?.effect &&
          perish.support?.effect?.kind === "perishSong" && Number.isFinite(dec.scoreOption(perish, 0.5)) && !shortPerish.support?.effect &&
          tea.support?.effect?.kind === "teaTime" && octo.support?.effect?.kind === "octolock" &&
          octo.support.effect.hit.killTurns <= octo.support.effect.base.killTurns &&
          dec.scoreOption(rev, 0.5, { ...P, tier2Aware: false }) === -Infinity,
        `회생=${dec.scoreOption(rev, 0.5).toFixed(3)} 멸망=${dec.scoreOption(perish, 0.5).toFixed(3)} 문어 c ${octo.support?.effect?.base.killTurns}→${octo.support?.effect?.hit.killTurns}`,
      );
    }
    // 엔진(T2-C에서 발견): 눈이면 얼음 타입 방어 1.5배 · 모래바람이면 바위 타입 특방 1.5배(데미지 감소)
    {
      const dmg = (weather, a, b, move) => {
        const st = battle([mon(a, [move])], [mon(b, ["칼춤"])]);
        if (weather) {
          st.weather = weather;
          st.weatherTurnsRemaining = 5;
        }
        const out = run(st, move, "칼춤");
        // 마기라스(바위)는 모래바람 틱 면제라 차이는 기술 데미지뿐
        return st.b.currentHp - out.nextState.b.currentHp;
      };
      const clear = dmg(undefined, "한카리아스", "크레베이스", "지진");
      const snow = dmg("눈", "한카리아스", "크레베이스", "지진");
      const snowSpecial = dmg("눈", "리자몽", "크레베이스", "화염방사");
      const clearSpecial = dmg(undefined, "리자몽", "크레베이스", "화염방사");
      const sandClear = dmg(undefined, "밀로틱", "마기라스", "하이드로펌프");
      const sandSpecial = dmg("모래바람", "밀로틱", "마기라스", "하이드로펌프");
      check(
        "T2-C 엔진: 눈 얼음 방어 1.5배 · 모래바람 바위 특방 1.5배",
        snow < clear && snowSpecial === clearSpecial && sandSpecial < sandClear,
        `눈 지진 ${clear}→${snow} 눈 특수 ${clearSpecial}→${snowSpecial} 모래 특수 ${sandClear}→${sandSpecial}`,
      );
    }
    // AI(T2-C): 꼬리자르기 — 대타를 넘겨받은 후보로 교체 평가(HP 절반 이하면 실패) · 썰렁개그 — 눈 state로 교체 평가 + 토글
    {
      const tailSt = battle([mon("잠만보", ["꼬리자르기", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]);
      const tail = optOf(tailSt, "꼬리자르기");
      const lowSt = battle([mon("잠만보", ["꼬리자르기", "누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]);
      lowSt.a.currentHp = Math.floor(lowSt.a.maxHp / 2);
      const low = optOf(lowSt, "꼬리자르기");
      const plain = optOf(battle([mon("잠만보", ["누르기"]), mon("메타그로스", ["코멧펀치"])], [mon("블래키", ["깨물어부수기"])]), "누르기");
      const plainSwitch = ev.evaluateOptions(tailSt, "a").find((o) => o.optionType === "switch");
      const tc = tail.pivot?.candidates[0];
      const chillSt = battle([mon("잠만보", ["썰렁개그", "누르기"]), mon("크레베이스", ["눈사태"])], [mon("한카리아스", ["지진"])]);
      const chill = optOf(chillSt, "썰렁개그");
      const chillSwitch = ev.evaluateOptions(chillSt, "a").find((o) => o.optionType === "switch");
      check(
        "T2-C AI: 꼬리자르기(대타 인계 후보)·썰렁개그(눈 후보) 교체 평가 + tier2Aware 토글",
        tail.pivot?.tier2 && Math.abs(tail.pivot.selfCost - 0.5) < 0.01 && tc.hitsToBeKilled.expected > plainSwitch.hitsToBeKilled.expected && !low.pivot &&
          Number.isFinite(dec.scoreOption(tail, 0.5)) && dec.scoreOption(tail, 0.5, { ...P, tier2Aware: false }) === -Infinity &&
          chill.pivot?.tier2 && chill.pivot.candidates[0].hitsToBeKilled.expected > chillSwitch.hitsToBeKilled.expected && Number.isFinite(dec.scoreOption(chill, 0.5)) &&
          !!plain,
        `꼬리 후보 d ${plainSwitch?.hitsToBeKilled.expected}→${tc?.hitsToBeKilled.expected} 썰렁 후보 d ${chillSwitch?.hitsToBeKilled.expected}→${chill.pivot?.candidates[0].hitsToBeKilled.expected}`,
      );
    }
    // 로드맵 3: 상대 자발적 교체 — 지는 대면의 상대는 내 공격을 받지 않는 대기 포켓몬으로 교체한다고 본다
    {
      const OFF = { ...P, oppSwitchAware: false };
      const st = battle([mon("한카리아스", ["지진", "검은눈빛"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["화염방사"])]);
      const opts = ev.evaluateOptions(st, "a");
      const quake = opt(opts, "지진");
      const trap = opt(opts, "검은눈빛");
      const on = dec.scoreOption(quake, 0.5);
      const off = dec.scoreOption(quake, 0.5, OFF);
      check(
        "로드맵 3: 상대 교체 모델링 — 이기는 대면 공격 값이 상대 교체(지진 무효 리자몽)만큼 낮아짐 · 검은눈빛은 켤 때만",
        on < off - 0.05 && trap.support?.effect?.kind === "trap" && trap.support.effect.party?.model.oppTrapped === true &&
          Number.isFinite(dec.scoreOption(trap, 0.5)) && dec.scoreOption(trap, 0.5, OFF) === -Infinity,
        `지진 켬 ${on.toFixed(3)} 끔 ${off.toFixed(3)} 검은눈빛 ${dec.scoreOption(trap, 0.5).toFixed(3)}`,
      );
    }
    // 로드맵 3: 멸망의노래 — 상대가 갇혀 있으면(교체 불가) 카운트로 쓰러지고, 아니면 교체로 피한다
    {
      const mk = () => battle([mon("잠만보", ["멸망의노래", "누르기"], null, null, pts({ hp: 32, def: 32 })), mon("메타그로스", ["코멧펀치"])], [mon("잠만보", ["깨물어부수기"]), mon("메타그로스", ["코멧펀치"])]);
      const free = opt(ev.evaluateOptions(mk(), "a"), "멸망의노래");
      const lockedSt = mk();
      lockedSt.b.volatile = { active: { ...lockedSt.b.volatile.active, meanLook: { turnsRemaining: undefined } } };
      const locked = opt(ev.evaluateOptions(lockedSt, "a"), "멸망의노래");
      const vFree = dec.scoreOption(free, 0.5);
      const vLocked = dec.scoreOption(locked, 0.5);
      check(
        "로드맵 3: 멸망의노래 — 갇힌 상대는 카운트로 쓰러짐(값 큼) · 교체 가능한 상대는 피함",
        Number.isFinite(vFree) && Number.isFinite(vLocked) && vLocked > vFree + 0.2,
        `교체 가능 ${vFree.toFixed(3)} 갇힘 ${vLocked.toFixed(3)}`,
      );
    }
    // 턴 종료 효과(ver.1.8): 대면 턴 수에 먹다남은음식·자뭉열매·그래스필드·모래바람(남은 턴만큼)을 센다 + 토글
    {
      const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
      const surv = (item, setup) => {
        const st = battle([mon("잠만보", ["누르기"], null, item)], [mon("메타그로스", ["코멧펀치"])]);
        setup?.(st);
        return opt(ev.evaluateOptions(st, "a"), "누르기").hitsToBeKilled.expected;
      };
      const plain = surv(null);
      const lefties = surv("먹다남은음식");
      const sitrus = surv("자뭉열매");
      const grassy = surv(null, (st) => {
        st.field = "그래스필드";
        st.fieldTurnsRemaining = 5;
      });
      const leftiesOff = tr.withEndOfTurnModel(false, () => surv("먹다남은음식"));
      const kill = (turns) => {
        const st = battle([mon("한카리아스", ["지진"])], [mon("잠만보", ["누르기"])]);
        if (turns) {
          st.weather = "모래바람";
          st.weatherTurnsRemaining = turns;
        }
        return opt(ev.evaluateOptions(st, "a"), "지진").hitsToKill.expected;
      };
      const k0 = kill(0);
      const k1 = kill(1);
      const k5 = kill(5);
      check(
        "턴 종료 효과: 먹다남은음식·자뭉열매·그래스필드로 버티는 턴 증가 · 모래바람은 남은 턴만큼 처치 턴 감소 · 토글",
        lefties > plain && sitrus > plain && grassy > plain && leftiesOff === plain && k5 < k1 && k1 < k0,
        `버팀 ${plain.toFixed(2)} 음식 ${lefties.toFixed(2)} 자뭉 ${sitrus.toFixed(2)} 그래스 ${grassy.toFixed(2)} · 처치 ${k0.toFixed(2)}/${k1.toFixed(2)}/${k5.toFixed(2)}`,
      );
    }
    // 쉬움 난이도(ver.1.8 A안): 프리셋(파티 평가 등 끔) + 점수 소프트맥스 — 어려움은 항상 같은 선택, 쉬움은 가끔 차선
    {
      const st = battle([mon("한카리아스", ["지진", "드래곤클로", "스톤에지", "칼춤"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"])]);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const pickName = (difficulty) => {
        const d = ai.chooseAiAction(st, "a", 0.5, { difficulty, random: rnd });
        return d.action.kind === "switch" ? `→${d.action.toIndex}` : d.action.move.name;
      };
      const hardPicks = new Set(Array.from({ length: 30 }, () => pickName("hard")));
      const easyPicks = new Set(Array.from({ length: 30 }, () => pickName("easy")));
      check(
        "쉬움 난이도: 어려움은 같은 선택 · 쉬움은 소프트맥스로 여러 선택 · 프리셋이 파티 평가 끔",
        hardPicks.size === 1 && easyPicks.size >= 2 && ai.DIFFICULTY_PRESETS.easy.partyAware === false && ai.DIFFICULTY_PRESETS.easy.choiceTemperature > 0,
        `어려움 ${[...hardPicks].join("/")} · 쉬움 ${[...easyPicks].join("/")}`,
      );
    }
    // 3선출 AI(ver.1.8 로드맵 7): 공격기 없는 빌드는 고르지 않고, 서로 다른 3마리를 선봉 먼저 돌려준다
    {
      const full = battle(
        [mon("잠만보", ["칼춤"]), mon("한카리아스", ["지진", "드래곤클로"]), mon("블래키", ["칼춤"]), mon("메타그로스", ["코멧펀치", "지진"]), mon("팬텀", ["칼춤"]), mon("리자몽", ["화염방사", "에어슬래시"])],
        [mon("잠만보", ["누르기"]), mon("블래키", ["깨물어부수기"]), mon("팬텀", ["섀도볼"]), mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["화염방사"]), mon("한카리아스", ["지진"])],
      );
      const sel = ai.chooseAiSelection(full, "a", { random: () => 0.5 });
      check(
        "3선출 AI: 공격기 없는 빌드 제외 · 서로 다른 3마리",
        sel.length === 3 && new Set(sel).size === 3 && sel.every((i) => [1, 3, 5].includes(i)),
        `선출 ${sel.join(",")}`,
      );
    }
    // 한계점 정리(ver.1.8): 필드 기술 접지 조건(엔진) · 페어리록 평가 · 끈적끈적네트 대면표 반영
    {
      const pe = await server.ssrLoadModule("/src/lib/battle/ai/partyEval.ts");
      const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
      const fe = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
      const glideSt = battle([mon("리자몽", ["그래스슬라이더"]), mon("이상해꽃", ["그래스슬라이더"])], [mon("잠만보", ["누르기"])]);
      glideSt.field = "그래스필드";
      glideSt.fieldTurnsRemaining = 5;
      const flyingPrio = toi.computeTurnOrderPriority(glideSt, glideSt.a, data.getMove("그래스슬라이더"));
      const groundPrio = toi.computeTurnOrderPriority(glideSt, glideSt.sideA.party[1], data.getMove("그래스슬라이더"));
      const volt = data.getMove("라이징볼트");
      const voltFlying = fe.getFieldPowerMultiplier(volt, "일렉트릭필드", true, false);
      const voltGround = fe.getFieldPowerMultiplier(volt, "일렉트릭필드", false, true);
      const lockSt = battle([mon("한카리아스", ["지진", "페어리록"]), mon("잠만보", ["누르기"])], [mon("메타그로스", ["코멧펀치"]), mon("리자몽", ["화염방사"])]);
      const lock = opt(ev.evaluateOptions(lockSt, "a"), "페어리록");
      const webSt = battle([mon("잠만보", ["누르기"]), mon("한카리아스", ["지진"])], [mon("메타그로스", ["코멧펀치"])]);
      webSt.sideA.hazards = { ...webSt.sideA.hazards, stickyWeb: true };
      const benchSpe = pe.createPartyModel(webSt, "a").pair(1, false, 0).me.stages.spe;
      check(
        "한계점 정리: 그래스슬라이더·라이징볼트 접지 조건 · 페어리록 평가(교체 모델링 켤 때만) · 끈적끈적네트 등장 스피드 −1",
        flyingPrio === 0 && groundPrio === 1 && voltFlying === 1 && voltGround === 2 &&
          lock.support?.effect?.kind === "fairyLock" && lock.support.effect.party?.model.switchLockedNextTurn === true &&
          Number.isFinite(dec.scoreOption(lock, 0.5)) && dec.scoreOption(lock, 0.5, { ...P, oppSwitchAware: false }) === -Infinity &&
          benchSpe === -1,
        `우선도 비행 ${flyingPrio}/땅 ${groundPrio} 라이징볼트 ${voltFlying}/${voltGround} 페어리록 ${dec.scoreOption(lock, 0.5).toFixed(3)} 네트 ${benchSpe}`,
      );
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
