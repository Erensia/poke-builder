/**
 * 타입 상성표(공격) 계산 점검 (7.6 T3·T4, 7.7 확장) — computePartyAttackMatrix가 손계산·독립 계산과 같은지 확인한다.
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
const flat = (list) => list.map((t) => t.join("/"));

try {
  const { computePartyAttackMatrix } = await server.ssrLoadModule("/src/lib/partyAnalysis.ts");
  const { getMove, POKEMON, MOVES } = await server.ssrLoadModule("/src/lib/data.ts");
  const CHART = (await server.ssrLoadModule("/src/data/typeChart.json")).default;
  const presets = (await server.ssrLoadModule("/src/data/samplePartyPresets.json")).default;
  const pts = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  // mon: { id?, moves, ability?, mega? } — 파티 6칸으로 만든다
  const party = (...mons) =>
    [
      ...mons.map((m) => ({
        pokemonId: m.id ?? "리자몽",
        moves: [...m.moves, null, null, null].slice(0, 4),
        ability: m.ability ?? null,
        item: null,
        nature: null,
        points: pts,
        ...(m.mega ? { activeMegaForm: m.mega } : {}),
      })),
      null, null, null, null, null, null,
    ].slice(0, 6);
  const row = (m, t) => m.rows.find((r) => r.type === t).cells[0];

  // 1) 손계산 사례 — 리자몽 특수 4개(불꽃·비행·격투·풀)
  const a = computePartyAttackMatrix(party({ moves: ["화염방사", "에어슬래시", "기합구슬", "솔라빔"] }));
  check("기술 타입별 개수", ["불꽃", "비행", "격투", "풀"].every((t) => row(a, t).special === 1 && row(a, t).physical === 0 && row(a, t).status === 0));
  check("기술 없는 타입은 0", row(a, "물").special === 0);
  check("공격·변화 기술 수", a.memberTotals[0].damage === 4 && a.memberTotals[0].status === 0);
  check("약점 커버(단일 18)", same(flat(a.single.uncovered), ["불꽃", "전기", "독", "비행", "에스퍼", "고스트", "드래곤", "페어리"]) && a.single.perMember[0] === 10, flat(a.single.uncovered).join(","));

  // 2) 변화 기술은 세지만 커버에는 들어가지 않는다
  const b = computePartyAttackMatrix(party({ moves: ["도깨비불"] }));
  check("변화 기술 개수", row(b, "불꽃").status === 1 && b.memberTotals[0].status === 1 && b.memberTotals[0].damage === 0);
  check("변화 기술은 커버 0", b.single.uncovered.length === 18 && b.single.perMember[0] === 0);

  // 3) 프리즈드라이는 물 타입에게 ×2 (상성 덮어쓰기) — 얼음의 통상 약점 4종 + 물
  const c = computePartyAttackMatrix(party({ moves: ["프리즈드라이"] }));
  check("프리즈드라이 커버(단일)", c.single.perMember[0] === 5 && !flat(c.single.uncovered).includes("물"), flat(c.single.uncovered).join(","));
  // 조합 기준은 아래 5)에서 만드는 keys로 비교한다(물이 든 조합은 물 부분을 ×2로 덮어쓰고 나머지 타입은 얼음 상성 그대로 — 엔진 moveContext와 같은 식)

  // 4) 빈 파티·여러 마리 합계
  const e = computePartyAttackMatrix(Array(6).fill(null));
  check("빈 파티", e.members.length === 0 && e.rows.length === 18 && e.single.uncovered.length === 18);
  const d = computePartyAttackMatrix(party({ moves: ["화염방사"] }, { moves: ["화염방사", "도깨비불"] }));
  check("파티 합계 열", d.rows.find((r) => r.type === "불꽃").total.special === 2 && d.rows.find((r) => r.type === "불꽃").total.status === 1);

  // 5) 이중 타입 조합 커버 — 방어 타입 조합 수는 데이터에서 독립 계산, 커버 여부는 타입 상성 JSON으로 독립 계산
  const keys = new Set();
  for (const p of POKEMON) {
    keys.add([...p.types].sort().join("/"));
    p.megaEvolutions?.forEach((m) => keys.add([...m.types].sort().join("/")));
    p.formVariants?.forEach((f) => keys.add([...f.types].sort().join("/")));
  }
  check("조합 총수 = 데이터의 서로 다른 타입 조합", a.combo.total === keys.size, `${a.combo.total} vs ${keys.size}`);
  const atkTypes = ["불꽃", "비행", "격투", "풀"];
  const expectedUncovered = [...keys].filter((k) => !atkTypes.some((t) => k.split("/").reduce((m, def) => m * (CHART[t][def] ?? 1), 1) >= 2));
  check("조합 커버가 독립 계산과 일치", same(a.combo.uncovered.map((t) => [...t].sort().join("/")), expectedUncovered), `${a.combo.uncovered.length} vs ${expectedUncovered.length}`);
  const iceMult = (types) => types.reduce((m, def) => m * (CHART["얼음"][def] ?? 1), 1);
  const expectedFD = [...keys].filter((k) => {
    const types = k.split("/");
    return (types.includes("물") ? 2 * iceMult(types.filter((t) => t !== "물")) : iceMult(types)) < 2;
  });
  check("프리즈드라이 조합 커버가 독립 계산과 일치(물 덮어쓰기 포함)", same(c.combo.uncovered.map((t) => [...t].sort().join("/")), expectedFD), `${c.combo.uncovered.length} vs ${expectedFD.length}`);

  // 6) 기술 타입 가변 — 스킨류 특성, 메가폼 특성, 레이징불(종)
  const normalMove = MOVES.find((m) => m.type === "노말" && m.category !== "status" && !m.weatherBall && !m.typeByUserSpecies && !m.overridesTypeEffectivenessFor)?.id;
  const plain = computePartyAttackMatrix(party({ moves: [normalMove] }));
  check(`스킨 없으면 ${normalMove}은 노말`, row(plain, "노말").physical + row(plain, "노말").special === 1);
  const skin = computePartyAttackMatrix(party({ moves: [normalMove], ability: "페어리스킨" }));
  check("페어리스킨 — 노말 기술이 페어리 행으로", row(skin, "노말").physical + row(skin, "노말").special === 0 && row(skin, "페어리").physical + row(skin, "페어리").special === 1);
  const SKIN_TYPE = { 페어리스킨: "페어리", 스카이스킨: "비행", 프리즈스킨: "얼음", 드래곤스킨: "드래곤" };
  const megaSkin = POKEMON.flatMap((p) => (p.megaEvolutions ?? []).filter((m) => SKIN_TYPE[m.ability]).map((m) => ({ p, m })));
  const badMega = megaSkin.filter(({ p, m }) => {
    const r = computePartyAttackMatrix(party({ id: p.id, moves: [normalMove], mega: m.form }));
    const t = SKIN_TYPE[m.ability];
    const cell = r.rows.find((x) => x.type === t).cells[0];
    return cell.physical + cell.special !== 1;
  });
  check(`메가폼 특성 반영(${megaSkin.length}종)`, megaSkin.length > 0 && badMega.length === 0, badMega.map((x) => x.m.form).join(","));
  const rage = computePartyAttackMatrix(party({ id: "팔데아켄타로스블레이즈종", moves: ["레이징불"] }));
  check("레이징불 — 블레이즈종은 불꽃 행", rage.rows.find((r) => r.type === "불꽃").cells[0].physical === 1 && rage.rows.find((r) => r.type === "노말").cells[0].physical === 0);
  const rageBase = computePartyAttackMatrix(party({ id: "켄타로스", moves: ["레이징불"] }));
  check("레이징불 — 기본 켄타로스는 노말 행", rageBase.rows.find((r) => r.type === "노말").cells[0].physical === 1);
  const wb = computePartyAttackMatrix(party({ moves: ["웨더볼"] }));
  check("웨더볼은 기본 타입(노말) 그대로", row(wb, "노말").special === 1);

  // 7) 샘플 파티 전수 정합성 — 합계 = 기술 수, 분류 합 = 기술 데이터, 커버 수 범위
  let bad = 0;
  for (const p of presets) {
    const m = computePartyAttackMatrix(p.slots);
    const known = m.members.flatMap((x) => x.moves).filter((id) => id && getMove(id)?.type && getMove(id)?.category).length;
    const grid = m.rows.reduce((n, r) => n + r.total.physical + r.total.special + r.total.status, 0);
    const foot = m.memberTotals.reduce((n, t) => n + t.damage + t.status, 0);
    const rowsOk = m.rows.every((r) => ["physical", "special", "status"].every((k) => r.cells.reduce((n, c) => n + c[k], 0) === r.total[k]));
    const covOk = [m.single, m.combo].every((cv) => cv.perMember.every((n) => n >= 0 && n <= cv.total) && cv.uncovered.length <= cv.total);
    // 조합 기준 커버 수는 단일 타입을 찌르는 기술이면 그 단일 타입 조합도 포함하므로 못 찌르는 비율이 지나치게 다르지 않아야 한다(상식 점검: 둘 다 0 초과 못 찌름은 허용)
    if (grid !== known || foot !== known || !rowsOk || !covOk) {
      bad++;
      console.log("  불일치:", p.id ?? p.name, { known, grid, foot });
    }
  }
  check(`샘플 파티 ${presets.length}개 정합성`, bad === 0, `${bad}개 불일치`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
