/**
 * 샘플 파티 강도 등급 측정(ver.5.0 R3 S1, 5.1 A2에서 증분화) — 샘플 파티 전부를 서로 전수 대전(라운드로빈)시켜 승률 순으로 하/중/상 등급을 매긴다.
 * 대전은 battle-ai-sim.mjs의 partyvs 모드(양쪽 같은 AI, 시드당 파티 좌우 교대 2판)를 쌍 조각으로 나눠 CPU 코어 수만큼 병렬로 돌린다.
 *
 *   node scripts/rank-party-tiers.mjs [쌍당 시드 수=10] [--params '<결정 파라미터 JSON>'] [--jobs N] [--write] [--all] [--new id,id] [--fresh]
 *
 * 쌍별 결과는 scripts/sample-party-pairs.json에 쌓인다(파티 id 쌍 → [앞 id 승, 뒤 id 승, 무, a편 승]). 다시 돌리면 표에 없는 쌍만 재므로
 * 샘플을 하나 추가했을 때는 새 파티 × 기존 파티 쌍만 측정하고(37개면 36쌍), 중단돼도 이어서 돈다(조각이 끝날 때마다 저장).
 * 표의 시드 수·AI 파라미터가 다르면 거부한다(섞이면 비교가 안 된다) — 처음부터 다시 재려면 --all. 지워진 파티의 쌍은 집계에서만 빠진다.
 * 쌍당 시드 수 10 = 20판. 파티당 상대 36개 × 20판 = 720판이라 파티별 승률 95% 신뢰구간이 약 ±4%p. 실측: 12코어(병렬 시 판당 약 4.6초)에서 시드 1(쌍당 2판, 1190판)이 약 12분 → 시드 10은 약 2시간.
 * --params 기본 {}(탐색·상대 모델 끈 기본 AI) — 탐색 켠 앱 AI는 10배 이상 느려 전수에는 쓰지 않는다. ponytail: 등급은 이 AI 기준이라 앱 AI에서의 순서와 같다는 보장은 없다 — 합격선 판정(S2) 때 상·하등급 몇 쌍만 앱 AI로 확인.
 * --write면 src/data/samplePartyTiers.json({ 파티 id: "하"|"중"|"상"|"최상" })을 프리셋 순서로 쓴다(최상은 따로 정한 표시를 유지).
 * 등급 규칙(5.2 C4, 히스테리시스): 승률 순 위 1/3 상·아래 1/3 하(순수 3등분)가 기본이되, 이미 등급이 있는 파티는 승률이 이전 등급 구간에서 경계로부터
 * ±2SE(판수로 계산한 표준오차의 2배, 파티당 약 880판이면 ≈3.4%p) 안이면 이전 등급을 유지한다 — 샘플이 늘 때 오차 안의 파티 등급이 흔들리지 않게 한다.
 * 갓 추가한 파티(임시 "중")는 --new id,id로 알려야 이전 등급이 없는 것으로 보고 순수 3등분을 따른다. --fresh면 모든 파티를 순수 3등분한다.
 * 출력: 진행은 stderr, 파티별 승률 표는 stdout.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const tablePath = fileURLToPath(new URL("./sample-party-pairs.json", import.meta.url));
const parties = JSON.parse(readFileSync(presetsPath, "utf8"));
const keyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

let table = { seeds, params, pairs: {} };
if (existsSync(tablePath) && !args.includes("--all")) {
  table = JSON.parse(readFileSync(tablePath, "utf8"));
  if (table.seeds !== seeds || table.params !== params) throw new Error(`저장된 표는 시드 ${table.seeds}·AI ${table.params} 기준이다 — 같은 값으로 돌리거나 --all로 처음부터 다시 잰다`);
}
// 쌍마다 한 줄 — 새 쌍이 추가돼도 diff가 그 줄들만 바뀐다
const save = () =>
  writeFileSync(tablePath, `{"seeds":${table.seeds},"params":${JSON.stringify(table.params)},"pairs":{\n${Object.keys(table.pairs).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(table.pairs[k])}`).join(",\n")}\n}}\n`);

const run = (pairs) =>
  new Promise((resolve, reject) => {
    let out = "";
    const p = spawn("node", [sim, "partyvs", String(seeds), params], { env: { ...process.env, PAIRS: pairs.join(",") }, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").pop()).pairs) : reject(new Error(`조각 실패 code=${code}`))));
  });

const missing = [];
for (let i = 0; i < parties.length; i++) for (let j = i + 1; j < parties.length; j++) if (!table.pairs[keyOf(parties[i].id, parties[j].id)]) missing.push(`${i}-${j}`);
console.error(`측정할 쌍 ${missing.length}개 (전체 ${(parties.length * (parties.length - 1)) / 2}쌍, 저장된 표 ${Object.keys(table.pairs).length}쌍)`);

// 작은 조각을 일꾼이 하나씩 가져가고 끝날 때마다 저장 — 중간에 죽어도 이어서 돌린다
const CHUNK = 20;
const queue = [];
for (let k = 0; k < missing.length; k += CHUNK) queue.push(missing.slice(k, k + CHUNK));
const worker = async () => {
  while (queue.length) {
    const chunk = queue.shift();
    for (const [pair, r] of Object.entries(await run(chunk))) {
      const [a, b] = pair.split("-").map((x) => parties[Number(x)].id);
      table.pairs[keyOf(a, b)] = a < b ? [r.pWins, r.qWins, r.other, r.aSideWins] : [r.qWins, r.pWins, r.other, r.aSideWins];
    }
    save();
    console.error(`조각 완료 (${chunk.length}쌍) · 남은 조각 ${queue.length}`);
  }
};
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));

const tally = parties.map(() => ({ w: 0, l: 0, o: 0 }));
let aSide = 0, games = 0;
for (let i = 0; i < parties.length; i++) {
  for (let j = i + 1; j < parties.length; j++) {
    const [first, second, other, a] = table.pairs[keyOf(parties[i].id, parties[j].id)];
    const [wi, wj] = parties[i].id < parties[j].id ? [first, second] : [second, first];
    tally[i].w += wi; tally[i].l += wj; tally[j].w += wj; tally[j].l += wi;
    tally[i].o += other; tally[j].o += other;
    aSide += a; games += wi + wj + other;
  }
}
const rows = parties
  .map((p, i) => ({ id: p.id, name: p.name, rate: tally[i].w / (tally[i].w + tally[i].l), games: tally[i].w + tally[i].l + tally[i].o }))
  .sort((a, b) => b.rate - a.rate);
const prev = JSON.parse(readFileSync(tiersPath, "utf8"));
const fresh = args.includes("--fresh");
const isNew = new Set(opt("new", "").split(",").filter(Boolean));
const cut = (k) => (k < rows.length / 3 ? "상" : k < (rows.length * 2) / 3 ? "중" : "하");
const edge = (k) => (rows[k - 1].rate + rows[k].rate) / 2; // k번째 순위 앞뒤 승률의 중간 = 등급 경계
const b1 = edge(Math.ceil(rows.length / 3)), b2 = edge(Math.ceil((2 * rows.length) / 3));
const margin = 2 * Math.sqrt(0.25 / (rows.reduce((s, r) => s + r.games, 0) / rows.length));
const held = (r) => {
  const p = prev[r.id] === "최상" ? "상" : prev[r.id];
  const range = { 상: [b1 - margin, Infinity], 중: [b2 - margin, b1 + margin], 하: [-Infinity, b2 + margin] }[p];
  return !fresh && !isNew.has(r.id) && range && r.rate >= range[0] && r.rate < range[1] ? p : null;
};
rows.forEach((r, k) => ((r.pure = cut(k)), (r.tier = held(r) ?? r.pure)));
console.log(`시드 ${table.seeds}/쌍 · AI ${table.params} · a편 승 ${((100 * aSide) / games).toFixed(1)}% (${games}판) · 경계 ${(100 * b1).toFixed(1)}%/${(100 * b2).toFixed(1)}% · 마진 ±${(100 * margin).toFixed(1)}%p${fresh ? " (--fresh: 순수 3등분)" : ""}`);
for (const r of rows) console.log(`${r.tier} ${(100 * r.rate).toFixed(1).padStart(5)}%  ${r.id}  ${r.name}${r.tier !== r.pure ? `  (유지 — 순수 3등분이면 ${r.pure})` : ""}`);
if (args.includes("--write")) {
  // "최상"(챔피언 전용, 상등급 내부 라운드로빈으로 따로 정함 — 5.0)은 측정 결과가 여전히 상이면 그대로 둔다
  const tierOf = Object.fromEntries(rows.map((r) => [r.id, prev[r.id] === "최상" && r.tier === "상" ? "최상" : r.tier]));
  writeFileSync(tiersPath, JSON.stringify(Object.fromEntries(parties.map((p) => [p.id, tierOf[p.id]])), null, 2) + "\n");
  console.error(`${tiersPath} 저장`);
}
