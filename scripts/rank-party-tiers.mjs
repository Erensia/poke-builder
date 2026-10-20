/**
 * 샘플 파티 강도 등급 측정(ver.5.0 R3 S1) — 샘플 파티 전부를 서로 전수 대전(라운드로빈)시켜 승률 순으로 하/중/상 등급을 매긴다.
 * 대전은 battle-ai-sim.mjs의 partyvs 모드(양쪽 같은 AI, 시드당 파티 좌우 교대 2판)를 쌍 조각으로 나눠 CPU 코어 수만큼 병렬로 돌린다.
 *
 *   node scripts/rank-party-tiers.mjs [쌍당 시드 수=10] [--params '<결정 파라미터 JSON>'] [--jobs N] [--write]
 *
 * 쌍당 시드 수 10 = 20판. 파티당 상대 34개 × 20판 = 680판이라 파티별 승률 95% 신뢰구간이 약 ±4%p. 실측: 12코어(병렬 시 판당 약 4.6초)에서 시드 1(쌍당 2판, 1190판)이 약 12분 → 시드 10은 약 2시간, 시드 5는 약 1시간(±6%p).
 * --params 기본 {}(탐색·상대 모델 끈 기본 AI) — 탐색 켠 앱 AI는 10배 이상 느려 전수에는 쓰지 않는다. ponytail: 등급은 이 AI 기준이라 앱 AI에서의 순서와 같다는 보장은 없다 — 합격선 판정(S2) 때 상·하등급 몇 쌍만 앱 AI로 확인.
 * --write면 src/data/samplePartyTiers.json({ 파티 id: "하"|"중"|"상" })을 쓴다 — 승률 순으로 위 1/3 상, 아래 1/3 하. 경계 근처 파티는 승률 차가 오차 안이니 표를 보고 판단한다.
 * 출력: 진행은 stderr, 파티별 승률 표는 stdout.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);
const params = opt("params", "{}");
const jobs = Number(opt("jobs", availableParallelism()));
const sim = fileURLToPath(new URL("./battle-ai-sim.mjs", import.meta.url));
const presetsPath = fileURLToPath(new URL("../src/data/samplePartyPresets.json", import.meta.url));
const tiersPath = fileURLToPath(new URL("../src/data/samplePartyTiers.json", import.meta.url));
const parties = JSON.parse(readFileSync(presetsPath, "utf8"));

// 쌍을 조각에 번갈아 나눠 조각마다 걸리는 시간을 비슷하게
const chunks = Array.from({ length: jobs }, () => []);
let n = 0;
for (let i = 0; i < parties.length; i++) for (let j = i + 1; j < parties.length; j++) chunks[n++ % jobs].push(`${i}-${j}`);

const run = (pairs) =>
  new Promise((resolve, reject) => {
    let out = "";
    const p = spawn("node", [sim, "partyvs", String(seeds), params], { env: { ...process.env, PAIRS: pairs.join(",") }, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").pop()).pairs) : reject(new Error(`조각 실패 code=${code}`))));
  });

const results = Object.assign({}, ...(await Promise.all(chunks.filter((c) => c.length).map((c) => run(c).then((r) => (console.error(`조각 완료 (${c.length}쌍)`), r))))));

const tally = parties.map(() => ({ w: 0, l: 0, o: 0 }));
let aSide = 0, games = 0;
for (const [pair, r] of Object.entries(results)) {
  const [i, j] = pair.split("-").map(Number);
  tally[i].w += r.pWins; tally[i].l += r.qWins; tally[j].w += r.qWins; tally[j].l += r.pWins;
  tally[i].o += r.other; tally[j].o += r.other;
  aSide += r.aSideWins; games += r.pWins + r.qWins + r.other;
}
const rows = parties
  .map((p, i) => ({ id: p.id, name: p.name, rate: tally[i].w / (tally[i].w + tally[i].l), games: tally[i].w + tally[i].l + tally[i].o }))
  .sort((a, b) => b.rate - a.rate);
const cut = (k) => (k < rows.length / 3 ? "상" : k < (rows.length * 2) / 3 ? "중" : "하");
rows.forEach((r, k) => (r.tier = cut(k)));
console.log(`시드 ${seeds}/쌍 · AI ${params} · a편 승 ${((100 * aSide) / games).toFixed(1)}% (${games}판)`);
for (const r of rows) console.log(`${r.tier} ${(100 * r.rate).toFixed(1).padStart(5)}%  ${r.id}  ${r.name}`);
if (args.includes("--write")) {
  writeFileSync(tiersPath, JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r.tier])), null, 2) + "\n");
  console.error(`${tiersPath} 저장`);
}
