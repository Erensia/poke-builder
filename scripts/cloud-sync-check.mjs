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
  check("프런티어 정규형: pendingId는 null, 나머지는 그대로, 키 순서 고정", fj === '{"streak":4,"best":9,"samples":{"s1":{"wins":2,"losses":1}},"pendingId":null,"queue":["s3"],"includeMine":true,"games":[],"pendingAt":null}', fj);
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

  // ── 랭크 기록 재생 병합(6.2 C6) ──
  const { beginRankMatch, finishRankMatch, resetSeason } = await server.ssrLoadModule("/src/lib/battleRankSave.ts");
  const { mergeRank, mergeFrontier } = await server.ssrLoadModule("/src/lib/cloudSyncPlan.ts");
  const party6 = Array(6).fill(null);
  // 한 기기에서 순서대로 한 판: 시작(진행 중 표시) → 결과
  const play = (save, opp, won, at, turns = 20) => finishRankMatch(beginRankMatch(save, opp, party6, at), won ? { won: true, turns } : { won: false }, at);
  const cj = (s) => canonical("battleRank", s).json;
  const gaugeBase = [1, 2, 3].reduce((s, at) => play(s, "o" + at, true, at), EMPTY_RANK_SAVE);

  // 시각 순서가 L(10)·R(20)·L(30)으로 섞인 경우 — 한 기기에서 그 순서로 한 것과 완전히 같아야 한다
  const L1 = play(play(gaugeBase, "x", true, 10), "x2", false, 30);
  const R1 = play(gaugeBase, "y", true, 20);
  const seq1 = play(play(play(gaugeBase, "x", true, 10), "y", true, 20), "x2", false, 30);
  check("랭크 병합: 두 기기의 판이 한 기기에서 시각 순서대로 한 것과 같다(게이지 구간)", mergeRank(cj(gaugeBase), cj(L1), cj(R1)) === cj(seq1));
  check("랭크 병합: 승패 합과 기록 순서(최근 순)", (() => { const m = JSON.parse(mergeRank(cj(gaugeBase), cj(L1), cj(R1))); return m.state.wins === 5 && m.state.losses === 1 && m.history.map((h) => h.at).join() === "30,20,10,3,2,1"; })());

  // 마스터볼(레이팅) — 연승 배율이 판 순서에 달려 있다
  const masterBase = { ...EMPTY_RANK_SAVE, state: { ...EMPTY_RANK_SAVE.state, wins: 30, losses: 10, rating: 2000, maxRating: 2000 }, seasonStartedAt: 1 };
  const L2 = play(play(masterBase, "a", true, 100), "c", true, 300);
  const R2 = play(masterBase, "b", true, 200);
  const seq2 = play(play(play(masterBase, "a", true, 100), "b", true, 200), "c", true, 300);
  check("랭크 병합: 마스터볼 레이팅·연승 배율도 정확히 재현된다", mergeRank(cj(masterBase), cj(L2), cj(R2)) === cj(seq2) && JSON.parse(cj(seq2)).state.rating > 2000);
  check("랭크 병합: 한쪽이 지고 한쪽이 이겨도 순서대로 계산된다", (() => { const l = play(masterBase, "a", false, 100); const r = play(play(masterBase, "b", true, 50), "c", true, 150); return mergeRank(cj(masterBase), cj(l), cj(r)) === cj(play(play(play(masterBase, "b", true, 50), "a", false, 100), "c", true, 150)); })());

  // 같은 결과를 다시 합쳐도 그대로(멱등), 한쪽에 새 판이 없어도 된다
  const M1 = mergeRank(cj(gaugeBase), cj(L1), cj(R1));
  check("랭크 병합: 합친 결과를 양쪽으로 다시 합쳐도 같다", mergeRank(cj(gaugeBase), M1, M1) === M1);
  check("랭크 병합: 한쪽에 새 판이 없어도 합쳐진다(진행 중 표시만 있는 경우)", (() => { const m = JSON.parse(mergeRank(cj(gaugeBase), cj(beginRankMatch(gaugeBase, "z", party6, 40)), cj(R1))); return m.state.wins === 4 && m.history.length === 4; })());
  check("랭크 병합: 결과의 진행 중 표시(pendingId)는 null", JSON.parse(mergeRank(cj(gaugeBase), cj(beginRankMatch(L1, "z", party6, 50)), cj(R1))).pendingId === null);

  // 폴백(null) — 사용자가 고르게 한다
  check("랭크 병합 폴백: 기준 저장본이 없으면 합치지 않는다", mergeRank(null, cj(L1), cj(R1)) === null);
  check("랭크 병합 폴백: 사이에 시즌이 끝났으면 합치지 않는다", mergeRank(cj(masterBase), cj(resetSeason(play(masterBase, "a", true, 10), 99)), cj(R2)) === null);
  check("랭크 병합 폴백: 판 기록만으로 상태가 재현되지 않으면 합치지 않는다", (() => { const bad = { ...L1, state: { ...L1.state, wins: L1.state.wins + 1 } }; return mergeRank(cj(gaugeBase), cj(bad), cj(R1)) === null; })());
  check("랭크 병합 폴백: 한쪽이 기록 상한(50판)을 넘겼으면 합치지 않는다", (() => { let s = masterBase; for (let i = 0; i < 50; i++) s = play(s, "n" + i, i % 3 !== 0, 1000 + i); return mergeRank(cj(masterBase), cj(s), cj(R2)) === null; })());
  check("랭크 병합 폴백: 49판까지는 합친다", (() => { let s = masterBase; for (let i = 0; i < 49; i++) s = play(s, "n" + i, i % 3 !== 0, 1000 + i); return mergeRank(cj(masterBase), cj(s), cj(R2)) !== null; })());

  // ── 프런티어 기록 부분 병합(6.4 F1) ──
  {
    const { finishMatch, beginMatch, settleAbandoned } = await server.ssrLoadModule("/src/lib/battleSeries.ts");
    const fp = (s) => canonical("battleFrontier", s).json;
    const fplay = (s, id, won) => finishMatch(beginMatch(s, id), id, won);
    const Q = ["a", "b", "c", "d", "e"];
    const fbase = fplay(fplay({ ...EMPTY_FRONTIER, queue: Q }, "a", true), "b", false); // 기준: a 승, b 패 — 대기열 [c, d, e]
    const FB = fp(fbase);

    // 두 기기가 서로 다른 상대와 싸웠다 — 한 기기에서 둘 다 한 것과 전적 합계가 같다
    const L = fplay(fbase, "c", true); // 이 기기: c 승
    const R = fplay(fplay(fbase, "c", false), "d", true); // 다른 기기: c 패, d 승
    const m = JSON.parse(mergeFrontier(FB, fp(L), fp(R)));
    check(
      "프런티어 병합: 샘플별 전적은 기준 + 각 기기의 증가분이다",
      JSON.stringify(m.samples) === JSON.stringify({ a: { wins: 1, losses: 0 }, b: { wins: 0, losses: 1 }, c: { wins: 1, losses: 1 }, d: { wins: 1, losses: 0 } }),
    );
    const total = (x) => Object.values(x.samples).reduce((n, v) => n + v.wins + v.losses, 0);
    check("프런티어 병합: 승패 총합이 기준 + 두 기기가 치른 판 수(3판)와 같다", total(m) === total(fbase) + 3);
    check("프런티어 병합: 대기열은 더 많이 진행한 쪽(양쪽이 만난 상대는 둘 다 뺀다)", m.queue.join() === "e");
    check("프런티어 병합: 진행 중 표시는 null, 최고 연승은 큰 값", m.pendingId === null && m.best >= Math.max(L.best, R.best));
    check("프런티어 병합: 결과는 정규형이다(다시 정규화해도 같다)", (() => { const j = mergeFrontier(FB, fp(L), fp(R)); return canonical("battleFrontier", JSON.parse(j)).json === j; })());

    // 판 시각 재생(8.2 I2): 현재 연승을 시각 순으로 다시 계산한다
    const at = (s, id, won, t) => finishMatch(beginMatch(s, id, t - 1), id, won, t);
    const T = (x) => JSON.parse(mergeFrontier(FB, fp(x[0]), fp(x[1])));
    const win3 = at(at(at(fbase, "c", true, 1000), "d", true, 2000), "e", true, 3000); // 기기 A: 3연승(시각 1000~3000)
    const lose1 = at(fbase, "c", false, 4000); // 기기 B: 나중에 1패
    check("프런티어 병합(판 시각): 3연승 뒤 다른 기기의 1패 → 연승 0, 최고 연승은 기준 이후 3 이상", T([win3, lose1]).streak === 0 && T([win3, lose1]).best >= 3);
    const lose0 = at(fbase, "c", false, 500); // 기기 B: 먼저 1패
    check("프런티어 병합(판 시각): 1패 뒤 다른 기기의 3연승 → 연승 3 (순서가 반대면 결과도 반대)", T([win3, lose0]).streak === 3 && T([lose0, win3]).streak === 3);
    check("프런티어 병합(판 시각): 같은 판이 양쪽에 있어도 한 번만 센다", T([win3, win3]).streak === 3);
    check("프런티어 병합(판 시각): 합친 판 기록은 최신 순으로 합쳐진다", T([win3, lose1]).games.filter((g) => g.at < 10000).map((g) => g.at).join() === "4000,3000,2000,1000");
    const old = { ...win3, games: undefined };
    check("프런티어 병합(판 시각): 판 기록이 없는 구형 문서는 큰 연승으로 근사한다", T([old, lose1]).streak === Math.max(old.streak, lose1.streak));
    const flood = Array.from({ length: 50 }, (_, i) => ({ at: 9000 + i, opponentId: "x", won: true }));
    check("프런티어 병합(판 시각): 기준 이후 새 판이 50판 이상이면 재생하지 않고 큰 연승으로 근사한다", T([{ ...fbase, streak: 50, games: flood }, lose1]).streak === 50);
    check("프런티어 이탈 정산: 판 시각은 앱을 다시 연 시각이 아니라 시작한 시각이다", settleAbandoned(beginMatch(fbase, "c", 777)).games[0].at === 777);

    // 합친 뒤에는 그 결과가 새 기준이다 · 한쪽에 새 판이 없어도 된다 · 진행 중 표시만 있는 경우
    const M = mergeFrontier(FB, fp(L), fp(R));
    check("프런티어 병합: 합친 결과를 기준으로 삼으면 더 합칠 것이 없다(멱등)", mergeFrontier(M, M, M) === M);
    // 올리는 사이 이 기기에서 한 판이 더 끝난 경우: 기준을 "합치기 전 이 기기 저장본"으로 옮겨 다시 합치면 이미 합친 몫이 두 번 더해지지 않는다
    const Lx = fplay(L, "d", false); // 이 기기가 합치는 사이 d에게 졌다
    const again = JSON.parse(mergeFrontier(fp(L), fp(Lx), M));
    check("프런티어 병합: 올리는 사이 한 판이 더 끝나도 이미 합친 몫은 두 번 더해지지 않는다", total(again) === total(JSON.parse(M)) + 1 && again.samples.d.wins === 1 && again.samples.d.losses === 1);
    check("프런티어 병합: 기준을 옮기지 않고 다시 합치면 두 번 더해진다(그래서 옮긴다)", total(JSON.parse(mergeFrontier(FB, fp(Lx), M))) > total(JSON.parse(M)) + 1);
    check("프런티어 병합: 한쪽에 새 판이 없어도 합쳐진다", JSON.parse(mergeFrontier(FB, fp(fbase), fp(R))).samples.c.losses === 1);
    check("프런티어 병합: 한쪽이 판을 시작만 한 상태(진행 중 표시)여도 합쳐진다", mergeFrontier(FB, fp(beginMatch(fbase, "c")), fp(R)) !== null);
    check("프런티어 병합: 기준에 없던 샘플도 더해진다", JSON.parse(mergeFrontier(FB, fp(fplay(fbase, "x", true)), fp(fplay(fbase, "y", false)))).samples.x.wins === 1);

    // 추가 설정은 저장본에서 바뀐 쪽을 따른다
    const mine = fp({ ...fbase, includeMine: true });
    check("프런티어 병합: includeMine은 바꾼 쪽을 따른다", JSON.parse(mergeFrontier(FB, mine, FB)).includeMine === true && JSON.parse(mergeFrontier(FB, FB, mine)).includeMine === true);

    // 폴백(null) — 사용자가 고르게 한다
    check("프런티어 병합 폴백: 기준 저장본이 없으면 합치지 않는다", mergeFrontier(null, fp(L), fp(R)) === null);
    check("프런티어 병합 폴백: 한쪽 전적이 기준보다 줄었으면(기록 초기화 등) 합치지 않는다", mergeFrontier(FB, fp({ ...EMPTY_FRONTIER, queue: Q.slice(2) }), fp(R)) === null);
    check("프런티어 병합 폴백: 한쪽 대기열이 기준의 뒷부분이 아니면(새로 섞였으면) 합치지 않는다", mergeFrontier(FB, fp({ ...L, queue: ["z", "c", "d"] }), fp(R)) === null);
    check("프런티어 병합 폴백: 대기열이 다 비어 새로 채워졌으면 합치지 않는다", mergeFrontier(FB, fp({ ...L, queue: ["q", "r", "s", "t", "u"] }), fp(R)) === null);

    // planSync: 양쪽이 다 바뀌었으면 여전히 충돌이고, 병합은 그 충돌을 푸는 단계다
    check("프런티어: 양쪽이 다 바뀌면 충돌(병합 대상)", planSync(fp(L), { json: fp(R), updatedAt: 200 }, { hash: hashOf(FB), remoteUpdatedAt: 100 }, FE) === "conflict");

    // 같은 기준에서 같은 상대에게 같은 결과로 진 두 판은 내용이 똑같다 — 같다고 맞췄다고 보면 한 판이 사라진다
    const lossC = fplay(fbase, "c", false); // 두 기기가 각자 c에게 패
    const sbase = { hash: hashOf(FB), remoteUpdatedAt: 100, snapshot: FB };
    check("프런티어: 두 기기가 같은 결과를 따로 만들었으면(기준 대비 양쪽 변경) 같은 내용이어도 합친다", planSync(fp(lossC), { json: fp(lossC), updatedAt: 200 }, sbase, FE, true) === "conflict");
    check("프런티어: 그 병합은 두 판을 모두 센다(c 패 2회)", JSON.parse(mergeFrontier(FB, fp(lossC), fp(lossC))).samples.c.losses === 2);
    check("프런티어: 이 기기가 받아 온 것(기준과 같음)이면 맞춘 것이다", planSync(FB, { json: FB, updatedAt: 100 }, sbase, FE, true) === "adopt" && planSync(fp(lossC), { json: fp(lossC), updatedAt: 100 }, { ...sbase, hash: hashOf(fp(lossC)) }, FE, true) === "adopt");
    check("프런티어: 기준 저장본이 없으면 같은 내용은 그대로 맞춘 것으로 본다(선택 창을 띄우지 않는다)", planSync(fp(lossC), { json: fp(lossC), updatedAt: 200 }, { hash: hashOf(FB), remoteUpdatedAt: 100 }, FE, true) === "adopt");
    check("목록·랭크는 같은 내용이면 기준과 상관없이 맞춘 것이다(additive 아님)", planSync(fp(lossC), { json: fp(lossC), updatedAt: 200 }, sbase, FE) === "adopt");
  }

  // ── 6.3 A1 AI 학습 기록 ──
  {
    const { emptyOpponentMemory } = await server.ssrLoadModule("/src/lib/battle/ai/opponentMemory.ts");
    const learned = { ...emptyOpponentMemory(), battles: 12, decisions: 40.5, species: { 한카리아스: { seen: 3, lastBattle: 12, moves: { 지진: { actual: 2, pred: 1.5 } } } } };
    const doc = { version: 1, learningEnabled: true, memory: learned };
    const aj = canonical("aiMemoryRank", doc).json;
    check("AI 기록 정규형은 멱등이고 키 순서가 고정이다", canonical("aiMemoryRank", JSON.parse(aj)).json === aj && aj.startsWith('{"version":1,"learningEnabled":true,"memory"'));
    check("AI 기록은 통째 문서이고 배틀타워·랭크 두 이름이다", isObjectDoc("aiMemory") && isObjectDoc("aiMemoryRank"));
    check("틀린 AI 기록은 던진다(bad-remote)", [{ version: 1, memory: learned }, { version: 2, learningEnabled: true, memory: learned }, { version: 1, learningEnabled: true, memory: 1 }, null].every((bad) => { try { canonical("aiMemory", bad); return false; } catch (e) { return e.message === "bad-remote"; } }));
    const AE = emptyJson("aiMemory");
    check("빈 AI 기록 정규형: 학습 켬 + 기록 없음", AE === canonical("aiMemory", { version: 1, learningEnabled: true, memory: emptyOpponentMemory() }).json);
    check("AI 기록: 클라우드에 없고 로컬이 비었으면 아무것도 안 한다 / 학습한 기록은 올린다", planSync(AE, null, null, AE) === "none" && planSync(aj, null, null, AE) === "push");
    check("AI 기록: 같은 내용이면 맞췄다고 본다 / 한쪽만 바뀌면 받거나 올린다", planSync(aj, { json: aj, updatedAt: 5 }, null, AE) === "adopt" && planSync(aj, { json: AE, updatedAt: 5 }, { hash: hashOf(AE), remoteUpdatedAt: 5 }, AE) === "push");
    // 크기: 종 100종 × 기술 40개를 채워도 문서 상한(900000자)의 한참 아래다
    const big = emptyOpponentMemory();
    for (let s = 0; s < 100; s++) big.species["종" + s] = { seen: 3.5, lastBattle: 20, moves: Object.fromEntries(Array.from({ length: 40 }, (_, m) => ["기술" + m, { actual: 1.2345678, pred: 2.3456789 }])) };
    const bigJson = canonical("aiMemoryRank", { version: 1, learningEnabled: true, memory: big }).json;
    check("AI 기록 최대 크기(100종×기술 40개)는 문서 상한 안이다", bigJson.length < 400_000, String(bigJson.length));
  }

  // ── 8.3 C2-b AI 학습 기억 합치기 ── (설계 `8.3-C2b-학습기억합치기설계.md` §3 M-a~M-k)
  {
    const om = await server.ssrLoadModule("/src/lib/battle/ai/opponentMemory.ts");
    const plan = await server.ssrLoadModule("/src/lib/cloudSyncPlan.ts");
    // 시험 한 건이 던져도(구현 전에는 함수가 없다) 다른 시험이 계속 돌게 한다
    const chk = (name, fn) => { let ok = false, detail = ""; try { ok = fn(); } catch (e) { detail = String(e?.message ?? e).slice(0, 80); } check(name, ok === true, detail); };
    const D = 0.99, DR = 0.995;
    const dist = (sw) => ({ moveWeights: new Map([["지진", 0.5], ["칼춤", 0.3], ["방어", 0.2]]), switchProb: sw, switches: sw > 0 ? [{ toIndex: 1, weight: 1 }] : [], megaOf: new Map() });
    const observe = (mem, species, moveId, isStatus, sw = 0.2) => om.observeOpponent(mem, { dist: dist(sw), speciesId: species, statusMoveIds: new Set(["칼춤", "방어"]), action: moveId ? { kind: "move", moveId, isStatus } : { kind: "switch" } });
    // 판 한 번 = 세션 기록(spec: [종, 기술|null, 변화기?]들)을 누적본에 감쇠하며 합친 것
    const play = (mem, spec, d = D) => { const ses = om.emptyOpponentMemory(); for (const [sp, mv, st] of spec) observe(ses, sp, mv, !!st); return om.commitBattle(mem, ses, d); };
    const playAll = (mem, games, d = D) => games.reduce((m, g) => play(m, g, d), mem);
    const wrap = (memory, le = true) => plan.canonical("aiMemory", { version: 1, learningEnabled: le, memory }).json;
    const G = {
      a1: [["한카리아스", "지진", 0], ["한카리아스", "칼춤", 1], ["망나뇽", "지진", 0], ["망나뇽", null]],
      a2: [["한카리아스", "지진", 0], ["한카리아스", "지진", 0], ["메타그로스", "방어", 1]],
      c1: [["망나뇽", "칼춤", 1], ["망나뇽", null], ["잠만보", "지진", 0], ["잠만보", "방어", 1]],
      c2: [["잠만보", null], ["한카리아스", "방어", 1], ["메타그로스", "지진", 0]],
      c3: [["메타그로스", "칼춤", 1], ["망나뇽", "지진", 0]],
    };
    const B0 = playAll(om.emptyOpponentMemory(), [G.a2, G.c1, G.a1]); // 기준: 3판
    const LINEAR = (m) => ({ decisions: m.decisions, switchActual: m.switchActual, switchPred: m.switchPred, statusActual: m.statusActual, statusPred: m.statusPred, species: Object.fromEntries(Object.entries(m.species).map(([id, sp]) => [id, { seen: sp.seen, moves: sp.moves }])) });
    const near = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 : a && b && typeof a === "object" ? [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => near(a[k] ?? 0, b[k] ?? 0)) : a === b);
    // 두 선형 구조의 평균(없는 쪽은 0)
    const mix = (x, y) => (typeof x === "number" || typeof y === "number" ? ((x ?? 0) + (y ?? 0)) / 2 : Object.fromEntries([...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])].map((k) => [k, mix(x?.[k], y?.[k])])));
    const parse = (json) => JSON.parse(json).memory;
    const merge = (B, L, R, d = D) => plan.mergeAiMemory(B === null ? null : wrap(B), wrap(L), wrap(R), d);

    chk("M-a 한쪽이 변하지 않았으면 합친 결과가 변한 쪽과 정확히 같다(전 필드)", () => { const L = playAll(B0, [G.a1, G.a2]); const m = parse(merge(B0, L, B0)); return near(LINEAR(m), LINEAR(L)) && m.battles === L.battles && near(LINEAR(parse(merge(B0, B0, L))), LINEAR(L)); });
    chk("M-b 양쪽이 변했으면 두 순서(L 다음 R, R 다음 L)의 평균과 같다", () => {
      const Ls = [G.a1, G.a2], Rs = [G.c1, G.c2, G.c3];
      const L = playAll(B0, Ls), R = playAll(B0, Rs), m = parse(merge(B0, L, R));
      const lr = playAll(B0, [...Ls, ...Rs]), rl = playAll(B0, [...Rs, ...Ls]);
      return near(LINEAR(m), mix(LINEAR(lr), LINEAR(rl))) && m.battles === B0.battles + Ls.length + Rs.length;
    });
    chk("M-c 선형 보존: 합친 decisions = d^(kL+kR)·B + ½[(1+d^kR)ΔL + (1+d^kL)ΔR]", () => {
      const L = playAll(B0, [G.a1, G.a2]), R = playAll(B0, [G.c1, G.c2, G.c3]), m = parse(merge(B0, L, R));
      const dL = L.decisions - D ** 2 * B0.decisions, dR = R.decisions - D ** 3 * B0.decisions;
      return Math.abs(m.decisions - (D ** 5 * B0.decisions + 0.5 * ((1 + D ** 3) * dL + (1 + D ** 2) * dR))) <= 1e-9;
    });
    chk("M-d 기준이 없거나 한쪽이 기억을 초기화(battles가 기준보다 작음)했거나 JSON이 깨졌으면 null이다", () => {
      const L = playAll(B0, [G.a1]), reset = om.emptyOpponentMemory();
      return merge(null, L, B0) === null && merge(B0, reset, L) === null && merge(B0, L, reset) === null && plan.mergeAiMemory("not json", wrap(L), wrap(B0), D) === null;
    });
    chk("M-e 100종 상한: 한쪽이 종을 밀어내도 증분은 음수가 되지 않고 합친 종은 100개 이하다", () => {
      const ses = om.emptyOpponentMemory();
      for (let i = 0; i < 100; i++) observe(ses, "종" + i, "지진", false);
      const B = om.commitBattle(om.emptyOpponentMemory(), ses, D), L = play(B, [["새종", "지진", 0]]), R = play(B, [["종5", "칼춤", 1]]);
      const m = parse(merge(B, L, R)), vals = Object.values(m.species).flatMap((sp) => [sp.seen, ...Object.values(sp.moves).flatMap((x) => [x.actual, x.pred])]);
      return Object.keys(m.species).length <= 100 && vals.every((v) => v >= 0) && m.species["새종"] !== undefined;
    });
    chk("M-f learningEnabled: 로컬이 바뀌었으면 로컬, 아니면 클라우드 값", () => {
      const L = playAll(B0, [G.a1]), R = playAll(B0, [G.c1]);
      const e = (b, l, r) => JSON.parse(plan.mergeAiMemory(wrap(B0, b), wrap(L, l), wrap(R, r), D)).learningEnabled;
      return e(true, false, true) === false && e(true, true, false) === false && e(true, false, false) === false && e(true, true, true) === true && e(false, true, false) === true;
    });
    chk("M-g 결과가 정규형이고 isOpponentMemory를 통과하며 battles = B + kL + kR", () => { const L = playAll(B0, [G.a1, G.a2]), R = playAll(B0, [G.c1]); const j = merge(B0, L, R); return plan.canonical("aiMemory", JSON.parse(j)).json === j && om.isOpponentMemory(parse(j)) && parse(j).battles === B0.battles + 3; });
    chk("M-h 같은 (B, L, R)을 두 번 합치면 같은 결과다(순수 함수)", () => { const L = playAll(B0, [G.a1]), R = playAll(B0, [G.c1, G.c2]); return merge(B0, L, R) === merge(B0, L, R); });
    chk("M-h2 경합: 올리기 성공 뒤 로컬이 한 판 더 쌓인 경우, 기준을 합치기 전 로컬로 옮기면 ΔL이 두 번 더해지지 않는다", () => {
      const L = play(B0, G.a1), R = play(B0, G.c1), M = parse(merge(B0, L, R));
      const L2 = play(L, G.a2); // 올리는 사이 로컬이 한 판 더
      const shifted = parse(plan.mergeAiMemory(wrap(L), wrap(L2), wrap(M), D)).decisions;
      const naive = parse(plan.mergeAiMemory(wrap(B0), wrap(L2), wrap(M), D)).decisions;
      const orders = [[G.a1, G.a2, G.c1], [G.a1, G.c1, G.a2], [G.a2, G.a1, G.c1], [G.a2, G.c1, G.a1], [G.c1, G.a1, G.a2], [G.c1, G.a2, G.a1]].map((o) => playAll(B0, o).decisions);
      const ideal = orders.reduce((x, y) => x + y, 0) / orders.length;
      return Math.abs(shifted - ideal) <= 0.12 * ideal && Math.abs(naive - ideal) > Math.abs(shifted - ideal);
    });
    chk("M-i 모드별 감쇠: decayFor('aiMemory') = 0.99, decayFor('aiMemoryRank') = 0.995", () => plan.decayFor("aiMemory") === 0.99 && plan.decayFor("aiMemoryRank") === 0.995 && om.MEMORY_DECAY_PER_BATTLE === 0.99 && om.RANK_MEMORY_DECAY_PER_BATTLE === 0.995);
    chk("M-i2 랭크 모드(0.995)로 쌓은 기억은 0.995로 합쳐야 맞는다(0.99로 합치면 어긋난다)", () => {
      const Br = playAll(om.emptyOpponentMemory(), [G.a2, G.c1], DR), L = playAll(Br, [G.a1], DR), R = playAll(Br, [G.c2], DR);
      const ok = parse(plan.mergeAiMemory(wrap(Br), wrap(L), wrap(R), DR)), bad = parse(plan.mergeAiMemory(wrap(Br), wrap(L), wrap(R), D));
      const ideal = (playAll(Br, [G.a1, G.c2], DR).decisions + playAll(Br, [G.c2, G.a1], DR).decisions) / 2;
      return Math.abs(ok.decisions - ideal) <= 1e-9 && Math.abs(bad.decisions - ideal) > 1e-9;
    });
    chk("M-j 기준 저장본: 20만 자 초과면 저장하지 않고 같은 이름의 예전 항목도 지운다, 해시가 다르면 쓰지 않는다, 다른 이름은 그대로", () => {
      const small = wrap(B0), big = "x".repeat(plan.AI_BASE_MAX_CHARS + 1);
      const a = plan.nextAiBases({ "u|aiMemoryRank": { remoteUpdatedAt: 1, json: "other" } }, "u|aiMemory", small, 7);
      const b = plan.nextAiBases(a, "u|aiMemory", big, 8);
      return plan.AI_BASE_MAX_CHARS === 200_000 && a["u|aiMemory"].json === small && a["u|aiMemory"].remoteUpdatedAt === 7 && b["u|aiMemory"] === undefined && b["u|aiMemoryRank"].json === "other"
        && plan.aiBaseOf(a, "u|aiMemory", plan.hashOf(small)) === small && plan.aiBaseOf(a, "u|aiMemory", plan.hashOf("다른 내용")) === null && plan.aiBaseOf(b, "u|aiMemory", plan.hashOf(small)) === null;
    });
    // M-k는 localStorage를 흉내 내서 storage.ts의 commitAiSession을 직접 부른다
    {
      const mem = new Map();
      globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
      let ok = false, detail = "";
      try {
        const st = await server.ssrLoadModule("/src/lib/storage.ts");
        const stale = st.loadAiMemory("rank"); // 배틀 시작 때 화면이 들고 있던 상태(비어 있음)
        const synced = { version: 1, learningEnabled: true, memory: playAll(om.emptyOpponentMemory(), [G.a1, G.c1], DR) };
        st.saveAiMemory("rank", synced); // 동기화가 합쳐 들어온 기억
        const ses = om.emptyOpponentMemory();
        observe(ses, "한카리아스", "지진", false);
        const next = st.commitAiSession("rank", ses, DR);
        ok = !!next && next.memory.battles === synced.memory.battles + 1 && st.loadAiMemory("rank").memory.battles === synced.memory.battles + 1 && stale.memory.battles === 0 && st.commitAiSession("rank", om.emptyOpponentMemory(), DR) === null;
      } catch (e) { detail = String(e?.message ?? e).slice(0, 80); }
      delete globalThis.localStorage;
      check("M-k 커밋은 상태가 아니라 저장소의 최신값 위에 쌓인다(배틀 중 동기화로 합쳐 들어온 학습이 살아남는다), 빈 세션은 null", ok, detail);
    }
  }

  console.log(failed ? `\n${failed}/${total}개 실패` : `\n${total}개 통과`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
