/**
 * 배틀 AI 규칙 시나리오 테스트 — 특정 상황을 직접 만들어 규칙 하나하나가 맞게 동작하는지 확인한다.
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:ai
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
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
