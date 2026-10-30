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
  const { canonical, hashOf, itemHashes, mergeLists, planSync } = await server.ssrLoadModule("/src/lib/cloudSyncPlan.ts");
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
  // 클라우드에 이미 저장된 문서와 같은 문자열이어야 한다 — 키 순서가 바뀌면 모든 목록이 "바뀐 것"으로 보여 한꺼번에 다시 올라간다
  check("정규형의 키 순서 고정(파티: id·name·slots·savedAt)", c1.json.startsWith('[{"id":"a","name":"첫 파티","slots":[') && c1.json.includes('],"savedAt":10},{"id":"b"'), c1.json.slice(0, 60));
  const cs = canonical("slotPresets", [slotPreset("s", "라이츄", 7)]);
  check("정규형의 키 순서 고정(포켓몬: id·name·slot·savedAt)", cs.json.startsWith('[{"id":"s","name":"라이츄","slot":{') && cs.json.endsWith(',"savedAt":7}]'), cs.json.slice(0, 60));
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

  // ── 항목 단위 병합(6.2 C4) ──
  const P = "partyPresets";
  const list = (...items) => canonical(P, items).json;
  const ids = (json) => JSON.parse(json).map((i) => i.id).join("");
  const A = party("a", "A", 10);
  const B = party("b", "B", 20);
  const C = party("c", "C", 30);
  const baseOf = (...items) => itemHashes(list(...items));
  const merge = (local, remote, base) => mergeLists(P, local, remote, base);

  check("itemHashes는 id마다 해시를 준다", Object.keys(baseOf(A, B)).join() === "a,b" && baseOf(A)["a"] !== baseOf({ ...A, name: "다른 이름" })["a"]);
  check("각자 추가한 항목은 둘 다 남고 최근 저장 순이다", ids(merge(list(A, B), list(A, C), baseOf(A))) === "cba");
  check("내가 지운 항목은 상대가 안 바꿨으면 같이 지운다", ids(merge(list(), list(A, C), baseOf(A))) === "c");
  check("상대가 지운 항목은 내가 안 바꿨으면 같이 지운다", ids(merge(list(A, B), list(), baseOf(A))) === "b");
  check("수정 vs 삭제는 수정을 남긴다(내가 수정)", merge(list({ ...A, name: "바꿈" }, B), list(C), baseOf(A)).includes('"name":"바꿈"'));
  check("수정 vs 삭제는 수정을 남긴다(상대가 수정)", merge(list(B), list({ ...A, name: "상대가 바꿈" }, C), baseOf(A)).includes("상대가 바꿈"));
  const renamed = (x, name) => ({ ...x, name });
  check("한쪽만 이름을 바꿨으면 그쪽(상대)", merge(list(A, B), list(renamed(A, "R"), C), baseOf(A)).includes('"name":"R"'));
  check("한쪽만 이름을 바꿨으면 그쪽(나)", merge(list(renamed(A, "L"), B), list(A, C), baseOf(A)).includes('"name":"L"'));
  check("둘 다 이름을 바꿨으면 이 기기 것", (() => { const m = merge(list(renamed(A, "L"), B), list(renamed(A, "R"), C), baseOf(A)); return m.includes('"name":"L"') && !m.includes('"name":"R"'); })());
  check("기준이 없으면 합집합이고 같은 id는 이 기기 것", (() => { const m = merge(list(renamed(A, "L"), B), list(renamed(A, "R"), C), null); return ids(m) === "cba" && m.includes('"name":"L"'); })());
  check("병합 결과는 정규형이고 멱등이다", (() => { const m = merge(list(A, B), list(A, C), baseOf(A)); return canonical(P, JSON.parse(m)).json === m && merge(m, m, baseOf(A)) === m; })());
  check("항목이 없던 기준(빈 목록)에서는 양쪽 추가분이 모두 남는다", ids(merge(list(A), list(B), {})) === "ba");

  // ── 두 기기 시나리오 — 판정(planSync)과 병합을 cloudSync.syncList와 같은 순서로 엮어 본다 ──
  const mkBase = (json, at) => ({ hash: hashOf(json), remoteUpdatedAt: at, items: itemHashes(json) });
  const net = { cloud: null, at: 0 };
  const dev = () => ({ local: list(), base: null });
  const add = (d, item) => (d.local = list(item, ...JSON.parse(d.local)));
  const del = (d, id) => (d.local = list(...JSON.parse(d.local).filter((i) => i.id !== id)));
  const rename = (d, id, name) => (d.local = list(...JSON.parse(d.local).map((i) => (i.id === id ? { ...i, name } : i))));
  function sync(d) {
    const p = planSync(d.local, net.cloud, d.base);
    const publish = (json) => {
      net.cloud = { json, updatedAt: ++net.at };
      return net.at;
    };
    if (p === "adopt") d.base = mkBase(d.local, net.cloud?.updatedAt ?? 0);
    else if (p === "pull") {
      d.local = net.cloud.json;
      d.base = mkBase(d.local, net.cloud.updatedAt);
    }
    else if (p === "push") d.base = mkBase(d.local, publish(d.local));
    else if (p === "conflict") {
      const m = merge(d.local, net.cloud.json, d.base?.items ?? null);
      const at = m === net.cloud.json ? net.cloud.updatedAt : publish(m);
      d.local = m;
      d.base = mkBase(m, at);
    }
    return p;
  }
  const x = dev();
  const y = dev();
  add(x, A);
  sync(x);
  check("[2기기] 빈 기기는 받아 온다", sync(y) === "pull" && ids(y.local) === "a");
  add(x, B);
  add(y, C);
  sync(x);
  check("[2기기] 따로 추가하면 합쳐진다(뒤에 동기화한 쪽)", sync(y) === "conflict" && ids(y.local) === "cba");
  check("[2기기] 먼저 올린 쪽은 받아서 같아진다", sync(x) === "pull" && x.local === y.local);
  check("[2기기] 같아진 뒤에는 더 올리거나 받을 것이 없다", ["none", "adopt"].includes(sync(x)) && ["none", "adopt"].includes(sync(y)) && x.local === y.local);
  del(x, "a");
  sync(x);
  check("[2기기] 지운 항목이 상대에게 전해진다", sync(y) === "pull" && ids(y.local) === "cb");
  add(y, party("d", "D", 40));
  del(x, "b");
  sync(x);
  check("[2기기] 한쪽은 삭제·한쪽은 추가해도 둘 다 반영된다", sync(y) === "conflict" && ids(y.local) === "dc" && sync(x) === "pull" && x.local === y.local);
  rename(x, "c", "수정됨");
  del(y, "c");
  sync(x);
  check("[2기기] 수정 vs 삭제는 수정이 살아남는다", sync(y) === "conflict" && ids(y.local) === "dc" && y.local.includes("수정됨"));
  const z = dev();
  add(z, party("z", "Z", 5));
  check("[2기기] 처음 연결인데 양쪽에 있으면 합집합(예전에는 충돌 선택)", sync(z) === "conflict" && ids(z.local) === "dcz");

  // ── 내 샘플(6.2 C3) ──
  const mySample = (id, name, extra = {}) => ({ id, name, style: "테스트", group: "real", description: "설명", slots: sample[0].slots, ...extra });
  const cm = canonical("mySamples", [mySample("my-1", "첫 샘플"), mySample("my-2", "둘째")]);
  check("내 샘플 정규형의 키 순서 고정(id·name·style·group·description·slots)", cm.json.startsWith('[{"id":"my-1","name":"첫 샘플","style":"테스트","group":"real","description":"설명","slots":['), cm.json.slice(0, 90));
  check("내 샘플 정규형은 멱등이고 id를 그대로 둔다", canonical("mySamples", JSON.parse(cm.json)).json === cm.json && cm.items[1].id === "my-2");
  check("틀린 내 샘플(id 없음·분류 오류·슬롯 5개)은 건너뛴다", canonical("mySamples", [mySample("my-1", "ok"), { ...mySample("x", "n"), id: undefined }, mySample("y", "g", { group: "?" }), mySample("z", "s", { slots: sample[0].slots.slice(0, 5) })]).items.length === 1);
  const MA = mySample("my-a", "A");
  const MB = mySample("my-b", "B");
  const MC = mySample("my-c", "C");
  const mlist = (...items) => canonical("mySamples", items).json;
  const mm = mergeLists("mySamples", mlist(MA, MB), mlist(MA, MC), itemHashes(mlist(MA)));
  check("내 샘플 병합: savedAt이 없어도 양쪽 추가분이 남고 이 기기 순서 뒤에 붙는다", JSON.parse(mm).map((i) => i.id).join() === "my-a,my-b,my-c", mm.slice(0, 60));
  check("내 샘플 병합: 상대가 지운 샘플은 안 바꿨으면 같이 지운다", JSON.parse(mergeLists("mySamples", mlist(MA, MB), mlist(), itemHashes(mlist(MA)))).map((i) => i.id).join() === "my-b");

  // ── 랭크배틀·프런티어 기록(6.2 C5) ──
  const { EMPTY_RANK_SAVE } = await server.ssrLoadModule("/src/lib/battleRankSave.ts");
  const { EMPTY_FRONTIER } = await server.ssrLoadModule("/src/lib/battleSeries.ts");
  const { emptyJson, isObjectDoc } = await server.ssrLoadModule("/src/lib/cloudSyncPlan.ts");
  const played = { ...EMPTY_RANK_SAVE, state: { ...EMPTY_RANK_SAVE.state, gauge: 0, wins: 12, losses: 5, streak: 3, rating: 2143.5, maxRating: 2200.25, champion: false }, seasonStartedAt: 1730000000000, pendingId: "sample-x" };
  const rj = canonical("battleRank", played).json;
  const rp = JSON.parse(rj);
  check("랭크 정규형: 진행 중인 판(pendingId)은 항상 null", rp.pendingId === null && JSON.parse(canonical("battleRank", { ...played, pendingId: null }).json).pendingId === null);
  check("랭크 정규형: 마스터볼 레이팅·최대 레이팅·승패가 그대로 전달된다", rp.state.rating === 2143.5 && rp.state.maxRating === 2200.25 && rp.state.wins === 12 && rp.state.losses === 5 && rp.state.streak === 3);
  check("랭크 정규형의 키 순서 고정", rj.startsWith('{"state":{"gauge":0,"wins":12,"losses":5,"streak":3,"lossStreak":0,"rating":2143.5,"maxRating":2200.25,"champion":false},"history":[],"seasons":[],"pendingId":null,"seasonStartedAt":1730000000000,"lastParty":null}'), rj.slice(0, 120));
  check("랭크 정규형은 멱등이다", canonical("battleRank", JSON.parse(rj)).json === rj);
  check("진행 중 판만 다른 두 저장본은 같은 정규형이다(판이 시작돼도 올릴 것이 없다)", canonical("battleRank", { ...played, pendingId: null }).json === rj);
  check("틀린 랭크 문서는 던진다(bad-remote)", (() => { try { canonical("battleRank", { state: 1 }); return false; } catch (e) { return e.message === "bad-remote"; } })());
  const fj = canonical("battleFrontier", { streak: 4, best: 9, samples: { s1: { wins: 2, losses: 1 } }, pendingId: "s2", queue: ["s3"], includeMine: true }).json;
  check("프런티어 정규형: pendingId는 null, 나머지는 그대로, 키 순서 고정", fj === '{"streak":4,"best":9,"samples":{"s1":{"wins":2,"losses":1}},"pendingId":null,"queue":["s3"],"includeMine":true}', fj);
  check("프런티어 정규형: 옛 저장본(queue·includeMine 없음)은 기본값으로 채운다", canonical("battleFrontier", { streak: 0, best: 0, samples: {}, pendingId: null }).json === canonical("battleFrontier", EMPTY_FRONTIER).json);
  check("틀린 프런티어 문서(전적이 정수가 아님)는 던진다", (() => { try { canonical("battleFrontier", { ...EMPTY_FRONTIER, samples: { a: { wins: "x", losses: 1 } } }); return false; } catch (e) { return e.message === "bad-remote"; } })());
  check("랭크·프런티어는 통째 문서이고 목록은 아니다", isObjectDoc("battleRank") && isObjectDoc("battleFrontier") && !isObjectDoc("partyPresets"));
  const RE = emptyJson("battleRank");
  const FE = emptyJson("battleFrontier");
  check("빈 문서의 정규형은 기록 없는 저장본이다", RE === canonical("battleRank", EMPTY_RANK_SAVE).json && FE === canonical("battleFrontier", EMPTY_FRONTIER).json && emptyJson("partyPresets") === "[]");
  const rplan = (local, rem, b) => planSync(local, rem, b, RE);
  check("랭크: 한 판도 안 했고 클라우드에도 없으면 아무것도 안 한다", rplan(RE, null, null) === "none");
  check("랭크: 클라우드에 없고 기록이 있으면 올린다", rplan(rj, null, null) === "push");
  check("랭크: 이 기기가 비었으면 클라우드 기록을 받는다", rplan(RE, remote(rj), null) === "pull");
  check("랭크: 클라우드가 비었으면 이 기기 기록을 올린다", rplan(rj, remote(RE), null) === "push");
  const rj2 = canonical("battleRank", { ...played, state: { ...played.state, wins: 20 } }).json;
  check("랭크: 처음 연결인데 양쪽에 기록이 다르면 충돌(합치지 않는다)", rplan(rj, remote(rj2), null) === "conflict");
  check("랭크: 한쪽만 바뀌었으면 자동으로 옮긴다", rplan(rj2, remote(rj, 100), base(rj, 100)) === "push" && rplan(rj, remote(rj2, 200), base(rj, 100)) === "pull");
  check("랭크: 양쪽이 다 바뀌었으면 충돌", rplan(rj2, remote(canonical("battleRank", { ...played, state: { ...played.state, wins: 30 } }).json, 200), base(rj, 100)) === "conflict");

  console.log(failed ? `\n${failed}/${total}개 실패` : `\n${total}개 통과`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
