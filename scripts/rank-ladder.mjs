/**
 * 랭크 AI 사다리 측정(5.2 C2 / 5.1 A4 재현) — 인접 단계끼리 h2h 승률을 재서 단조 증가인지 본다.
 * 단계 N = src/lib/battle/ai/rankProfile.ts의 RANK_AI_PROFILES[N](battle-ai-sim.mjs의 "rank:N" 파라미터), 파티는 샘플 풀(POOL=samples).
 *
 *   node scripts/rank-ladder.mjs [시드 수=200] [--rungs 0,1,2,3,6] [--chunk 25] [--jobs N]
 *
 * 시드 1개 = 2판(파티 좌우 교대)이라 200시드 = 쌍당 400판(5.1 A4와 같다). 시드 조각(--chunk)을 병렬로 돌려 합산한다 — 각 판은 시드로만 정해지므로
 * 조각의 합은 한 번에 돌린 결과와 같다. 기본 단계 0,1,2,3,6 = 몬스터·슈퍼·하이퍼·마스터볼 4·마스터볼 1(앱 AI). 승률은 무승부 제외.
 * 학습 단계(3~5)의 λ는 LEARN=1 + 대전 간 누적이 있어야 차이가 나는데 이 러너는 학습 없이 잰다 — 3과 6의 차이는 상대 모델 대 앱 AI(탐색)뿐이다.
 * 합격선(5.0): 단조 증가 + 양 끝 격차가 큼, 엄격 기준은 인접 55~65%. 프로세스당 약 500MB — 회사 PC(RAM 8GB)에서는 --jobs 1~2로 스모크만, 측정은 집 PC.
 * 측정 중에는 src/를 바꾸지 않는다(프로세스가 모듈을 읽는다). 스모크: node scripts/rank-ladder.mjs 2 --rungs 0,1,2 --chunk 2 --jobs 1 (약 10초, 표본이 작아 승률은 의미 없음).
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const seeds = Number(args.find((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--")) ?? 200);
const rungs = opt("rungs", "0,1,2,3,6").split(",").map(Number);
const chunk = Number(opt("chunk", 25));
const concurrency = Number(opt("jobs", availableParallelism()));
const sim = fileURLToPath(new URL("./battle-ai-sim.mjs", import.meta.url));

const queue = [];
for (let pair = 1; pair < rungs.length; pair++) {
  for (let from = 1; from <= seeds; from += chunk) queue.push({ pair, from, count: Math.min(chunk, seeds - from + 1) });
}
const total = queue.length;
const sums = rungs.slice(1).map(() => ({ aWins: 0, bWins: 0, other: 0 }));
const started = Date.now();
let done = 0;

const run = ({ pair, from, count }) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, POOL: "samples", SEED_FROM: String(from) };
    const child = spawn(process.execPath, [sim, "h2h", String(count), `rank:${rungs[pair]}`, `rank:${rungs[pair - 1]}`], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      if (code !== 0 || !line) return reject(new Error(`단계 ${rungs[pair]} 대 ${rungs[pair - 1]} 시드 ${from}: exit ${code}\n${err}`));
      const { res } = JSON.parse(line);
      for (const k of Object.keys(sums[pair - 1])) sums[pair - 1][k] += res[k];
      console.error(`[${++done}/${total}] P${rungs[pair]} 대 P${rungs[pair - 1]} 시드 ${from}~${from + count - 1} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      resolve();
    });
  });

await Promise.all(
  Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (queue.length > 0) await run(queue.shift());
  }),
);

console.log(`시드 ${seeds}/쌍 (${seeds * 2}판) · 단계 ${rungs.join(",")} · 샘플 풀 · ${((Date.now() - started) / 60000).toFixed(1)}분`);
const rates = sums.map((s) => s.aWins / (s.aWins + s.bWins));
sums.forEach((s, i) => {
  const rate = rates[i];
  const mark = rate < 0.5 ? "역전" : rate < 0.55 ? "55% 미만" : rate > 0.65 ? "65% 초과" : "합격";
  console.log(`P${rungs[i + 1]} 대 P${rungs[i]}  ${s.aWins}:${s.bWins}${s.other ? ` (무 ${s.other})` : ""}  ${(100 * rate).toFixed(1)}%  ${mark}`);
});
if (seeds < 100) console.log(`※ 쌍당 ${seeds * 2}판은 표본이 작아 승률의 오차가 크다(400판 ±5%p) — 동작 확인용`);
console.log(rates.every((r) => r > 0.5) ? "단조 증가: 예(모든 인접 승률 > 50%)" : "단조 증가: 아니오 — 역전된 인접 단계가 있다");
