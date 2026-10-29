/**
 * 배틀 AI 규칙 시나리오 테스트 — 특정 상황을 직접 만들어 규칙 하나하나가 맞게 동작하는지 확인한다.
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:ai
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const state = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const ev = await server.ssrLoadModule("/src/lib/battle/ai/evaluator.ts");
  const ai = await server.ssrLoadModule("/src/lib/battle/ai/index.ts");
  const dec = await server.ssrLoadModule("/src/lib/battle/ai/decision.ts");
  const l1 = await server.ssrLoadModule("/src/lib/battle/ai/levelOne.ts");

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
  const ctx = { server, data, state, ev, ai, dec, l1, pts, mon, battle, opt, check };
  // 영역별 파일을 이름순으로 실행한다 — 행 순서(= 출력 순서)가 원래와 같다.
  const dir = new URL("./battle-ai-scenarios/", import.meta.url);
  for (const f of readdirSync(dir).sort()) await (await import(new URL(f, dir))).default(ctx);

  console.table(rows);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server.close();
}
