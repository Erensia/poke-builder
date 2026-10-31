/**
 * 가치 함수 학습 데이터 수집(6.3 G4 방향 A Stage 1) — 앱 AI 자기대전의 매 턴 state 특징 + 최종 승패를 JSONL 조각으로 모은다.
 * 각 조각은 `battle-ai-sim.mjs collect`(OUT=<파일>)가 쓰고, 학습은 scripts/value-train.mjs.
 *
 *   node scripts/value-collect.mjs [판 수=2400] [--out <폴더>] [--chunk 25] [--jobs N]
 *
 * 파티는 POOL=samples(샘플 파티 3마리 무작위, 사다리와 같다). 병렬 12개 기준 한 판 약 6초(단독) — Windows 하이브리드 CPU에서 CPU가
 * 25% 안팎이면 scripts/win-unthrottle.ps1을 따로 실행한다.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const battles = /^\d+$/.test(args[0] ?? "") ? Number(args[0]) : 2400;
const chunk = Number(opt("chunk", 25));
const jobs = Number(opt("jobs", availableParallelism()));
const out = opt("out", join(tmpdir(), "value-data"));
const seedOffset = Number(process.env.SEED_OFFSET ?? 0);
const sim = fileURLToPath(new URL("./battle-ai-sim.mjs", import.meta.url));
mkdirSync(out, { recursive: true });

const queue = Array.from({ length: Math.ceil(battles / chunk) }, (_, k) => ({ from: seedOffset + 1 + k * chunk, count: Math.min(chunk, battles - k * chunk) }));
const total = queue.length;
let done = 0;
const started = Date.now();

const run = ({ from, count }) =>
  new Promise((resolve, reject) => {
    const file = join(out, `part-${String(from).padStart(6, "0")}.jsonl`);
    const child = spawn(process.execPath, [sim, "collect", String(count)], { env: { ...process.env, POOL: "samples", SEED_FROM: String(from), OUT: file } });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`시드 ${from}: exit ${code}\n${err}`));
      console.error(`[${++done}/${total}] 시드 ${from}~${from + count - 1} (${((Date.now() - started) / 60000).toFixed(1)}분)`);
      resolve();
    });
  });

await Promise.all(Array.from({ length: Math.min(jobs, total) }, async () => { while (queue.length > 0) await run(queue.shift()); }));
console.log(`수집 완료: ${battles}판 → ${out} (${((Date.now() - started) / 60000).toFixed(1)}분)`);
