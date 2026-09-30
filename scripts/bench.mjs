/**
 * 배틀 AI 벤치 실행기(ver.1.9) — AI 튜닝·정확도 수정 판정용 표준 벤치 5종을 시드 구간 조각으로 나눠 CPU 코어 수만큼 병렬로 돌리고
 * 합산한다. 각 판은 시드로만 정해지므로(battle-ai-sim.mjs SEED_FROM) 조각의 합은 한 번에 돌린 결과와 판 단위로 같다.
 *
 *   npm run bench -- toggle '<끔 파라미터 JSON>' [옵션]     켬(기본값 또는 --on) / 끔 비교
 *   npm run bench -- compare <이전 체크아웃 경로> [옵션]   이 체크아웃 AI / 이전 AI 비교(h2h는 OPP_ROOT)
 *
 * 표준 5종: 그리디 800(켬·끔), STATUS=1 그리디 400(켬·끔), STATUS=1 h2h 200(켬 대 끔). 판 수는 "좌우 교대 한 쌍" 단위(× 2판).
 * 스타일 봇(ver.2.0 1-A, --style N으로 켬 — 기본 0): 교체형·변화기형·무작위 섞음 봇 상대 각 N(켬·끔, STATUS=1).
 * ver.2.0 3단계: --h2h-plain N(일반 파티 h2h, 기본 0) · --seed-offset N(모든 종류의 시드를 N만큼 뒤로 — 스크리닝과 다른 파티로 재확인).
 * 옵션: --root <체크아웃>(벤치할 코드, 기본 이 리포) · --on '<JSON>' · --greedy N · --status N · --h2h N · --style N · --chunk N(조각당 시드 수,
 *       기본 50) · --jobs N(동시 실행 수, 기본 CPU 코어 수)
 * 출력: 진행 상황은 stderr, 마지막에 종류별 합산 JSON 한 줄씩 stdout.
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const [kind, target, ...rest] = process.argv.slice(2);
if (kind !== "toggle" && kind !== "compare") {
  console.error("사용법: npm run bench -- toggle '<끔 JSON>' [옵션] | compare <이전 체크아웃 경로> [옵션]");
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const simPath = fileURLToPath(new URL("./battle-ai-sim.mjs", import.meta.url));
const root = opt("root", fileURLToPath(new URL("..", import.meta.url)));
const onParams = opt("on", "{}");
const offParams = kind === "toggle" ? target : "{}";
const baseRoot = kind === "compare" ? target : undefined;
const sizes = {
  greedy: Number(opt("greedy", 800)),
  status: Number(opt("status", 400)),
  h2h: Number(opt("h2h", 200)),
  style: Number(opt("style", 0)),
  h2hPlain: Number(opt("h2h-plain", 0)),
};
const seedOffset = Number(opt("seed-offset", 0));
const chunk = Number(opt("chunk", 50));
const concurrency = Number(opt("jobs", availableParallelism()));

/** 벤치 종류: 라벨, 시뮬레이터 모드·인자, 환경변수, 판 수 */
const kinds = [
  { label: "h2h", mode: "h2h", size: sizes.h2h, args: [onParams, offParams], env: { STATUS: "1", ...(baseRoot && { OPP_ROOT: baseRoot }) } },
  { label: "h2h:plain", mode: "h2h", size: sizes.h2hPlain, args: [onParams, offParams], env: { ...(baseRoot && { OPP_ROOT: baseRoot }) } },
  { label: "status:on", mode: "greedy", size: sizes.status, args: [onParams], env: { STATUS: "1" } },
  { label: "status:off", mode: "greedy", size: sizes.status, args: [offParams], env: { STATUS: "1", ...(baseRoot && { SIM_ROOT: baseRoot }) } },
  { label: "greedy:on", mode: "greedy", size: sizes.greedy, args: [onParams], env: {} },
  { label: "greedy:off", mode: "greedy", size: sizes.greedy, args: [offParams], env: { ...(baseRoot && { SIM_ROOT: baseRoot }) } },
  ...["switcher", "setup", "noisy"].flatMap((style) => [
    { label: `style:${style}:on`, mode: "style", size: sizes.style, args: [onParams], env: { STATUS: "1", STYLE: style } },
    { label: `style:${style}:off`, mode: "style", size: sizes.style, args: [offParams], env: { STATUS: "1", STYLE: style, ...(baseRoot && { SIM_ROOT: baseRoot }) } },
  ]),
];

// 조각: 무거운 종류(h2h → STATUS → 일반)부터 큐에 넣어 끝부분에 코어가 노는 시간을 줄인다
const jobs = [];
for (const k of kinds) {
  for (let from = 1; from <= k.size; from += chunk) jobs.push({ kind: k, from, count: Math.min(chunk, k.size - from + 1) });
}

const results = new Map(kinds.map((k) => [k.label, []]));
const started = Date.now();
let done = 0;

function runJob(job) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, SIM_ROOT: root, ...job.kind.env, SEED_FROM: String(job.from + seedOffset) };
    const child = spawn(process.execPath, [simPath, job.kind.mode, String(job.count), ...job.kind.args], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      if (code !== 0 || !line) return reject(new Error(`${job.kind.label} ${job.from}: exit ${code}\n${err}`));
      results.get(job.kind.label).push(JSON.parse(line));
      done++;
      const sec = ((Date.now() - started) / 1000).toFixed(0);
      console.error(`[${done}/${jobs.length}] ${job.kind.label} 시드 ${job.from}~${job.from + job.count - 1} (${sec}s)`);
      resolve();
    });
  });
}

/** 숫자 필드는 더하고(중첩 객체 포함) 나머지는 처음 값 유지 */
function merge(a, b) {
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  }
  return a ?? b;
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (queue.length > 0) await runJob(queue.shift());
  }),
);

// 판 수 0으로 뺀 종류(--greedy 0 등)는 결과가 없다
for (const k of kinds.filter((kind) => kind.size > 0)) {
  const merged = results.get(k.label).reduce(merge);
  console.log(JSON.stringify({ bench: k.label, ...merged }));
}
console.error(`총 ${((Date.now() - started) / 60000).toFixed(1)}분 · 조각 ${jobs.length}개 · 동시 ${concurrency}개`);
