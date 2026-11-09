/**
 * 타입 상성표(공격) 계산 점검 (7.6 T3·T4) — computePartyAttackMatrix가 손계산과 같은지 확인한다.
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:party-attack
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

try {
  const { computePartyAttackMatrix } = await server.ssrLoadModule("/src/lib/partyAnalysis.ts");
  const { getMove } = await server.ssrLoadModule("/src/lib/data.ts");
  const presets = (await server.ssrLoadModule("/src/data/samplePartyPresets.json")).default;
  const pts = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const party = (...monMoves) =>
    [...monMoves.map((moves) => ({ pokemonId: "리자몽", moves: [...moves, null, null, null].slice(0, 4), ability: null, item: null, nature: null, points: pts })), null, null, null, null, null, null].slice(0, 6);

  // 1) 손계산 사례 — 리자몽 특수 4개(불꽃·비행·격투·풀)
  const a = computePartyAttackMatrix(party(["화염방사", "에어슬래시", "기합구슬", "솔라빔"]));
  const row = (m, t) => m.rows.find((r) => r.type === t).cells[0];
  check("기술 타입별 개수", ["불꽃", "비행", "격투", "풀"].every((t) => row(a, t).special === 1 && row(a, t).physical === 0 && row(a, t).status === 0));
  check("기술 없는 타입은 0", row(a, "물").special === 0);
  check("공격·변화 기술 수", a.memberTotals[0].damage === 4 && a.memberTotals[0].status === 0);
  check("약점 커버 타입", same(a.coveredTypes, ["풀", "얼음", "벌레", "강철", "격투", "노말", "바위", "악", "물", "땅"]), a.coveredTypes.join(","));
  check("못 찌르는 타입 = 18 − 커버", a.uncoveredTypes.length === 8 && a.memberTotals[0].covered === 10);

  // 2) 변화 기술은 세지만 커버에는 들어가지 않는다
  const b = computePartyAttackMatrix(party(["도깨비불"]));
  check("변화 기술 개수", row(b, "불꽃").status === 1 && b.memberTotals[0].status === 1 && b.memberTotals[0].damage === 0);
  check("변화 기술은 커버 0", b.coveredTypes.length === 0 && b.uncoveredTypes.length === 18);

  // 3) 프리즈드라이는 물 타입에게 ×2 (상성 덮어쓰기) — 얼음의 통상 약점 4종 + 물
  const c = computePartyAttackMatrix(party(["프리즈드라이"]));
  check("프리즈드라이 커버", same(c.coveredTypes, ["풀", "땅", "비행", "드래곤", "물"]), c.coveredTypes.join(","));

  // 4) 빈 파티·여러 마리 합계
  const e = computePartyAttackMatrix(Array(6).fill(null));
  check("빈 파티", e.members.length === 0 && e.rows.length === 18 && e.coveredTypes.length === 0);
  const d = computePartyAttackMatrix(party(["화염방사"], ["화염방사", "도깨비불"]));
  check("파티 합계 열", d.rows.find((r) => r.type === "불꽃").total.special === 2 && d.rows.find((r) => r.type === "불꽃").total.status === 1);

  // 5) 샘플 파티 전수 정합성 — 합계 = 기술 수, 커버 ∪ 미커버 = 18, 분류 합 = 기술 데이터
  let bad = 0;
  for (const p of presets) {
    const m = computePartyAttackMatrix(p.slots);
    const known = m.members.flatMap((x) => x.moves).filter((id) => id && getMove(id)?.type && getMove(id)?.category).length;
    const grid = m.rows.reduce((n, r) => n + r.total.physical + r.total.special + r.total.status, 0);
    const foot = m.memberTotals.reduce((n, t) => n + t.damage + t.status, 0);
    const rowsOk = m.rows.every((r) => ["physical", "special", "status"].every((k) => r.cells.reduce((n, c) => n + c[k], 0) === r.total[k]));
    if (grid !== known || foot !== known || !rowsOk || m.coveredTypes.length + m.uncoveredTypes.length !== 18 || m.memberTotals.some((t) => t.covered > 18)) {
      bad++;
      console.log("  불일치:", p.id ?? p.name, { known, grid, foot });
    }
  }
  check(`샘플 파티 ${presets.length}개 정합성`, bad === 0, `${bad}개 불일치`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
