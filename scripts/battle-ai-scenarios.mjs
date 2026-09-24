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
