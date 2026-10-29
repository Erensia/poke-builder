/**
 * 클라우드 동기화(6.0 K3)의 판정·정규화 검증 — `lib/cloudSyncPlan.ts`와 `lib/backup.ts`의 목록 검증을 본다(네트워크·저장소 없음).
 * 실제 Firestore 읽기·쓰기는 `npm run test:rules`(규칙)와 화면 확인(두 기기)으로 본다. 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:sync
 */
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
let total = 0;
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
};
try {
  const { canonical, hashOf, planSync } = await server.ssrLoadModule("/src/lib/cloudSyncPlan.ts");
  const { cleanPartyPresets, cleanSlotPresets, parseBackup, exportBackup } = await server.ssrLoadModule("/src/lib/backup.ts");

  // 실제 샘플 데이터로 목록을 만든다(검증을 통과하는 진짜 슬롯)
  const sample = JSON.parse(readFileSync(new URL("../src/data/samplePartyPresets.json", import.meta.url), "utf8"));
  const slots = sample[0].slots;
  const slot = slots.find(Boolean);
  const reorder = (o) => Object.fromEntries(Object.entries(o).reverse());
  const party = (id, name, savedAt = 1) => ({ id, name, slots, savedAt });
  const slotPreset = (id, name, savedAt = 1) => ({ id, name, slot, savedAt });

  // ── 정규형 ──
  const parties = [party("a", "첫 파티", 10), party("b", "둘째", 20)];
  const c1 = canonical("partyPresets", parties);
  check("정규형은 id·savedAt을 그대로 둔다", c1.items[0].id === "a" && c1.items[1].savedAt === 20, JSON.stringify(c1.items[0]).slice(0, 80));
  check("정규형은 멱등이다(정규형을 다시 정규화해도 같다)", canonical("partyPresets", JSON.parse(c1.json)).json === c1.json);
  const shuffled = [{ ...slotPreset("s1", "라이츄"), slot: reorder(slot) }];
  check("키 순서가 달라도 같은 정규형이다", canonical("slotPresets", shuffled).json === canonical("slotPresets", [slotPreset("s1", "라이츄")]).json);
  check("슬롯 빌드도 멱등이다", (() => { const j = canonical("slotPresets", [slotPreset("s1", "라이츄")]).json; return canonical("slotPresets", JSON.parse(j)).json === j; })());
  check("틀린 항목(없는 포켓몬·빈 이름)은 건너뛴다", cleanSlotPresets([slotPreset("x", "ok"), { ...slotPreset("y", "bad"), slot: { ...slot, pokemonId: "없는포켓몬" } }, slotPreset("z", "  ")], true).skipped === 2);
  check("savedAt이 틀리면 0(호출마다 달라지지 않음)", cleanPartyPresets([{ ...party("a", "p"), savedAt: "x" }], true).items[0].savedAt === 0);
  check("keepIds=false는 id를 새로 매긴다", cleanPartyPresets([party("a", "p")], false).items[0].id !== "a");

  // ── G1 백업 가져오기는 그대로 ──
  const backup = parseBackup(exportBackup([party("a", "p")], [slotPreset("s", "s")]));
  check("백업 가져오기는 id를 새로 매기고 항목을 읽는다", backup && backup.partyPresets.length === 1 && backup.slotPresets.length === 1 && backup.partyPresets[0].id !== "a" && backup.skipped === 0);
  check("백업이 아닌 파일은 null", parseBackup("{}") === null && parseBackup("not json") === null);

  // ── 해시 ──
  check("해시는 같은 문자열에 같고 한 글자만 달라도 다르다", hashOf("abc") === hashOf("abc") && hashOf("abc") !== hashOf("abd"));

  // ── 판정 ──
  const L = canonical("partyPresets", [party("a", "내 파티")]).json;
  const R = canonical("partyPresets", [party("a", "내 파티"), party("b", "다른 기기")]).json;
  const E = "[]";
  const remote = (json, updatedAt = 100) => ({ json, updatedAt });
  const base = (json, remoteUpdatedAt = 100) => ({ hash: hashOf(json), remoteUpdatedAt });
  const plan = (local, rem, b) => planSync(local, rem, b);

  check("클라우드에 없고 로컬이 비었으면 아무것도 안 한다", plan(E, null, null) === "none");
  check("클라우드에 없고 로컬에 있으면 올린다", plan(L, null, null) === "push");
  check("같은 내용이면 기록만 맞춘다(adopt)", plan(L, remote(L), null) === "adopt");
  check("처음 연결: 로컬이 비었으면 클라우드 것을 받는다", plan(E, remote(R), null) === "pull");
  check("처음 연결: 클라우드가 비었으면 올린다", plan(L, remote(E), null) === "push");
  check("처음 연결: 둘 다 있고 다르면 충돌", plan(L, remote(R), null) === "conflict");
  check("둘 다 안 바뀌었으면 아무것도 안 한다", plan(L, remote(R, 100), base(L, 100)) === "none");
  check("로컬은 그대로, 클라우드만 바뀌었으면 받는다", plan(L, remote(R, 200), base(L, 100)) === "pull");
  check("클라우드는 그대로, 로컬만 바뀌었으면 올린다", plan(R, remote(L, 100), base(L, 100)) === "push");
  check("양쪽 다 바뀌었으면 충돌", plan(R, remote(canonical("partyPresets", [party("c", "또 다른")]).json, 200), base(L, 100)) === "conflict");
  check("클라우드에서 전부 지워졌고 로컬은 그대로면 받는다(빈 목록)", plan(L, remote(E, 200), base(L, 100)) === "pull");
  check("로컬을 비웠고 클라우드는 그대로면 올린다(빈 목록)", plan(E, remote(L, 100), base(L, 100)) === "push");

  console.log(failed ? `\n${failed}/${total}개 실패` : `\n${total}개 통과`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
