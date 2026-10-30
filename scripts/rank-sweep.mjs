/**
 * 랭크 AI 후보 파라미터 스윕(6.3 A2) — 후보마다 기준 단계(--vs, 기본 rank:6 = 앱 AI)와 직접 대전해 승률·로짓 강도를 잰다.
 * 단계 사이 간격을 맞출 때 "이 후보는 앱 AI보다 얼마나 약한가"를 한 번에 본다(사다리 rank-ladder.mjs는 이웃끼리만 잰다).
 *
 *   node scripts/rank-sweep.mjs [시드 수=200] [--vs rank:6] [--chunk 25] [--jobs N] 이름=JSON|rank:N ...
 *   예) node scripts/rank-sweep.mjs 200 r.8='{"mistake":{"rate":0.8,"margin":1e9}}' rank:2
 *
 * 승률은 무승부 제외, 강도 = ln(승률/(1-승률))(기준 대비 로짓, 0이면 같은 강도). POOL=samples(사다리와 같다), SELECT=1이면 선출 포함.
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const optValues = new Set(["--vs", "--chunk", "--jobs"].map((f) => args.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1));
const rest = args.filter((a, i) => !a.startsWith("--") && !optValues.has(i));
const seeds = /^\d+$/.test(rest[0] ?? "") ? Number(rest.shift()) : 200;
const vs = opt("vs", "rank:6");
const chunk = Number(opt("chunk", 25));
const concurrency = Number(opt("jobs", availableParallelism()));
const sim = fileURLToPath(new URL("./battle-ai-sim.mjs", import.meta.url));
const cands = rest.map((a) => {
  const eq = a.indexOf("=");
  return eq > 0 && !a.startsWith("rank:") ? { name: a.slice(0, eq), param: a.slice(eq + 1) } : { name: a, param: a };
});

const sums = Object.fromEntries(cands.map((c) => [c.name, { aWins: 0, bWins: 0, other: 0 }]));
const queue = cands.flatMap((c) => Array.from({ length: Math.ceil(seeds / chunk) }, (_, k) => ({ c, from: 1 + k * chunk, count: Math.min(chunk, seeds - k * chunk) })));
const total = queue.length;
let done = 0;

const run = ({ c, from, count }) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, POOL: process.env.POOL ?? "samples", SEED_FROM: String(from) };
    const child = spawn(process.execPath, [sim, "h2h", String(count), c.param, vs], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      if (code !== 0 || !line) return reject(new Error(`${c.name} 시드 ${from}: exit ${code}\n${err}`));
      const { res } = JSON.parse(line);
      for (const k of Object.keys(sums[c.name])) sums[c.name][k] += res[k];
      console.error(`[${++done}/${total}] ${c.name} 시드 ${from}~${from + count - 1}`);
      resolve();
    });
  });

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, async () => { while (queue.length > 0) await run(queue.shift()); }));

console.log(`시드 ${seeds}/후보 (${seeds * 2}판) · 기준 ${vs}${process.env.SELECT === "1" ? " · 선출 포함" : ""}`);
for (const c of cands) {
  const { aWins, bWins, other } = sums[c.name];
  const rate = aWins / (aWins + bWins);
  const logit = Math.log(rate / (1 - rate));
  console.log(`${c.name.padEnd(12)} ${aWins}:${bWins}${other ? ` (무 ${other})` : ""}  승률 ${(rate * 100).toFixed(1)}%  강도 ${logit.toFixed(2)}`);
}
