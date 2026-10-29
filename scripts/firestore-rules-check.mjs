// firestore.rules 검증(6.0 K1) — Firestore 에뮬레이터에서 본인·타인·비로그인·잘못된 모양을 시도해 규칙이 막는지 본다.
// 실행: `npm run test:rules` (Java 21 이상 필요. 에뮬레이터를 띄우고 이 파일을 실행한다 — package.json 참고)
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, runTransaction, setDoc } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-poke",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
});

const me = env.authenticatedContext("alice").firestore();
const other = env.authenticatedContext("bob").firestore();
const anon = env.unauthenticatedContext().firestore();
const path = (uid, name) => `users/${uid}/lists/${name}`;
const good = { json: "[]", updatedAt: 1730000000000, version: 1 };

const cases = [
  ["본인: 쓰기·읽기·삭제 허용", async () => {
    await assertSucceeds(setDoc(doc(me, path("alice", "slotPresets")), good));
    await assertSucceeds(setDoc(doc(me, path("alice", "partyPresets")), good));
    await assertSucceeds(getDoc(doc(me, path("alice", "slotPresets"))));
    await assertSucceeds(deleteDoc(doc(me, path("alice", "slotPresets"))));
  }],
  ["본인: 앱이 쓰는 방식(트랜잭션으로 읽고 쓰기) 허용, 타인은 거부", async () => {
    const d = doc(me, path("alice", "partyPresets"));
    await assertSucceeds(runTransaction(me, async (tx) => (await tx.get(d), tx.set(d, good))));
    await assertSucceeds(runTransaction(me, async (tx) => (await tx.get(d), tx.set(d, { ...good, updatedAt: good.updatedAt + 1 }))));
    const theirs = doc(other, path("alice", "partyPresets"));
    await assertFails(runTransaction(other, async (tx) => (await tx.get(theirs), tx.set(theirs, good))));
  }],
  ["타인: 읽기·쓰기·삭제 거부", async () => {
    await assertFails(getDoc(doc(other, path("alice", "slotPresets"))));
    await assertFails(setDoc(doc(other, path("alice", "slotPresets")), good));
    await assertFails(deleteDoc(doc(other, path("alice", "partyPresets"))));
  }],
  ["비로그인: 읽기·쓰기 거부", async () => {
    await assertFails(getDoc(doc(anon, path("alice", "slotPresets"))));
    await assertFails(setDoc(doc(anon, path("alice", "slotPresets")), good));
  }],
  ["허용 목록 밖 이름 거부", () => assertFails(setDoc(doc(me, path("alice", "battleVideos")), good))],
  ["users/{uid}/lists 밖 경로 거부", async () => {
    await assertFails(setDoc(doc(me, "users/alice/other/slotPresets"), good));
    await assertFails(setDoc(doc(me, "misc/x"), good));
  }],
  ["필드 모양 검사: 추가·누락·형식 오류 거부", async () => {
    const d = doc(me, path("alice", "slotPresets"));
    await assertFails(setDoc(d, { ...good, extra: 1 }));
    await assertFails(setDoc(d, { json: "[]", updatedAt: 1 }));
    await assertFails(setDoc(d, { ...good, json: [] }));
    await assertFails(setDoc(d, { ...good, updatedAt: "now" }));
    await assertFails(setDoc(d, { ...good, version: 2 }));
  }],
  ["크기 상한: 900000자 허용, 초과 거부", async () => {
    const d = doc(me, path("alice", "partyPresets"));
    await assertSucceeds(setDoc(d, { ...good, json: "a".repeat(900000) }));
    await assertFails(setDoc(d, { ...good, json: "a".repeat(900001) }));
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    await env.clearFirestore();
    await run();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n  ${e.message.split("\n")[0]}`);
  }
}
await env.cleanup();
console.log(failed ? `\n${failed}개 실패` : `\n${cases.length}개 통과`);
process.exit(failed ? 1 : 0);
