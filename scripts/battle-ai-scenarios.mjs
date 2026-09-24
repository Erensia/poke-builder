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
