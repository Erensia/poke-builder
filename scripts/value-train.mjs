/**
 * 가치 함수 정확도 게이트(6.3 G4 방향 A Stage 1) — value-collect.mjs가 모은 자기대전 state로 "이 state의 내 편이 이길 확률"을 학습하고,
 * 지금 잎 평가(대면표 값 하나)만 쓴 예측과 비교한다. 학습/검증은 판 단위로 나눈다(같은 판의 state가 양쪽에 섞이지 않게).
 *
 *   node scripts/value-train.mjs <데이터 폴더> [--write <가중치.json>] [--test-mod 5]
 *
 * 합격선(설계 §6 단계 2): 검증 로그 손실이 잎 평가 단독 대비 3% 이상 줄어야 한다. 시간 초과(timeout)·무승부 판은 뺀다.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error("데이터 폴더 필요");
const opt = (name, fb) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fb; };
const testMod = Number(opt("test-mod", 5));
const writeTo = opt("write", null);

// ── 데이터 읽기 ──
const rows = []; // { x: number[], y, battle, turn }
let names = null;
let skipped = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
  for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
    const b = JSON.parse(line);
    if (b.w !== "a" && b.w !== "b") { skipped++; continue; }
    for (const r of b.rows) {
      rows.push({ x: r.a, y: b.w === "a" ? 1 : 0, battle: b.s, turn: r.t });
      rows.push({ x: r.b, y: b.w === "b" ? 1 : 0, battle: b.s, turn: r.t });
    }
  }
}
const BASE = ["leaf", "hpDiff", "aliveDiff", "myAlive", "oppAlive", "myActiveHp", "oppActiveHp", "myBenchHp", "oppBenchHp", "speedAhead", "myAtkStage", "myDefStage", "mySpeStage", "oppAtkStage", "oppDefStage", "oppSpeStage", "myStatus", "oppStatus", "myHazards", "oppHazards", "myScreens", "oppScreens", "myTailwind", "oppTailwind", "turn"];
// Stage 1b 수집 데이터는 뒤에 쌍 표 27개·슬롯 HP 6개·활성 원핫 6개가 더 붙는다
const extraNames = rows[0].x.length > BASE.length
  ? [...[0, 1, 2].flatMap((i) => [0, 1, 2].flatMap((j) => ["myRate", "oppRate", "first"].map((k) => `pair${i}${j}_${k}`))), ...["my", "opp"].flatMap((s) => [0, 1, 2].map((i) => `${s}Hp${i}`)), ...["my", "opp"].flatMap((s) => [0, 1, 2].map((i) => `${s}Act${i}`))]
  : [];
const FEATURES = [...BASE, ...extraNames];
names = FEATURES;
const train = rows.filter((r) => r.battle % testMod !== 0);
const test = rows.filter((r) => r.battle % testMod === 0);
console.log(`샘플 ${rows.length} (학습 ${train.length} / 검증 ${test.length}), 제외된 판(시간 초과·무승부) ${skipped}`);

// ── 로지스틱 회귀(L2, 뉴턴법) ──
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
function solve(A, b) { // 가우스 소거
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const m = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= m * A[i][c];
      b[r] -= m * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
function fit(set, cols, l2 = 1) {
  // 특징 표준화 후 학습 → 원래 척도 가중치로 환산
  const d = cols.length + 1;
  const mean = cols.map((c) => set.reduce((s, r) => s + r.x[c], 0) / set.length);
  const std = cols.map((c, k) => Math.sqrt(set.reduce((s, r) => s + (r.x[c] - mean[k]) ** 2, 0) / set.length) || 1);
  const phi = (r) => [1, ...cols.map((c, k) => (r.x[c] - mean[k]) / std[k])];
  const w = new Array(d).fill(0);
  for (let iter = 0; iter < 25; iter++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const r of set) {
      const f = phi(r);
      const p = sigmoid(f.reduce((s, v, i) => s + v * w[i], 0));
      for (let i = 0; i < d; i++) {
        g[i] += (p - r.y) * f[i];
        for (let j = 0; j <= i; j++) H[i][j] += p * (1 - p) * f[i] * f[j];
      }
    }
    for (let i = 1; i < d; i++) { g[i] += l2 * w[i]; H[i][i] += l2; }
    for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) H[i][j] = H[j][i];
    const step = solve(H.map((row) => [...row]), g);
    let norm = 0;
    for (let i = 0; i < d; i++) { w[i] -= step[i]; norm += Math.abs(step[i]); }
    if (norm < 1e-6) break;
  }
  const raw = [w[0] - cols.reduce((s, _, k) => s + (w[k + 1] * mean[k]) / std[k], 0), ...cols.map((_, k) => w[k + 1] / std[k])];
  return { cols, w: raw, predict: (r) => sigmoid(raw[0] + cols.reduce((s, c, k) => s + raw[k + 1] * r.x[c], 0)) };
}

// ── 평가 ──
function metrics(model, set) {
  let ll = 0, ok = 0;
  const scored = set.map((r) => ({ p: model.predict(r), y: r.y }));
  for (const { p, y } of scored) {
    ll -= y * Math.log(Math.max(p, 1e-12)) + (1 - y) * Math.log(Math.max(1 - p, 1e-12));
    if ((p >= 0.5) === (y === 1)) ok++;
  }
  scored.sort((a, b) => a.p - b.p);
  let rankSum = 0, pos = 0;
  scored.forEach((s, i) => { if (s.y === 1) { rankSum += i + 1; pos++; } });
  const neg = scored.length - pos;
  return { logloss: ll / set.length, acc: ok / set.length, auc: (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) };
}
const fmt = (m) => `로그손실 ${m.logloss.toFixed(4)} · 정확도 ${(m.acc * 100).toFixed(1)}% · AUC ${m.auc.toFixed(4)}`;
const idx = (n) => FEATURES.indexOf(n);
const base = (() => { const p = train.reduce((s, r) => s + r.y, 0) / train.length; return { predict: () => p }; })();
const leafOnly = fit(train, [idx("leaf")]);
const hpOnly = fit(train, ["hpDiff", "aliveDiff"].map(idx));
const simple = fit(train, ["leaf", "hpDiff", "aliveDiff"].map(idx));
const base25 = BASE.map((_, i) => i);
const all = fit(train, base25);
const noLeaf = fit(train, base25.filter((i) => i !== idx("leaf")));

console.log("\n검증 세트:");
const results = { "상수(기준)": base, "잎 평가 단독": leafOnly, "HP차+마릿수차만": hpOnly, "잎+HP차+마릿수차": simple, "특징 25개 전부": all, "잎 평가 뺀 24개": noLeaf };
const m = {};
for (const [name, model] of Object.entries(results)) { m[name] = metrics(model, test); console.log(`  ${name.padEnd(16)} ${fmt(m[name])}`); }
// 공정한 기준은 "잎+HP차+마릿수차"다: 오라클의 후보 값 = (판세 F 변화) + 잎이라, 잎 단독은 현재 판세를 뺀 불공정한 기준이다
const gainOf = (a, b) => (1 - m[a].logloss / m[b].logloss) * 100;
const fair = gainOf("특징 25개 전부", "잎+HP차+마릿수차");
console.log(`\n로그 손실 개선: 전부 대 잎 단독 ${gainOf("특징 25개 전부", "잎 평가 단독").toFixed(2)}% · 전부 대 (잎+HP차+마릿수차) ${fair.toFixed(2)}% · 잎의 기여 ${gainOf("잎+HP차+마릿수차", "HP차+마릿수차만").toFixed(2)}%`);
console.log(`게이트(공정 비교 3% 이상): ${fair >= 3 ? "통과" : "미달"}`);

// ── Stage 1b: 쌍 표까지 먹인 선형 모델과 작은 신경망(2층) ──
function trainMLP(set, cols, { hidden = 24, epochs = 60, lr = 0.003, l2 = 1e-4, batch = 256, seed = 7 } = {}) {
  let s = seed >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
  const randn = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const d = cols.length;
  const mean = cols.map((c) => set.reduce((a, r) => a + r.x[c], 0) / set.length);
  const std = cols.map((c, k) => Math.sqrt(set.reduce((a, r) => a + (r.x[c] - mean[k]) ** 2, 0) / set.length) || 1);
  const prep = (r) => cols.map((c, k) => (r.x[c] - mean[k]) / std[k]);
  // 검증 일부(학습 판의 10%)로 조기 종료 — 검증 세트(test)는 건드리지 않는다
  const battles = [...new Set(set.map((r) => r.battle))];
  const holdOut = new Set(battles.filter((_, i) => i % 10 === 0));
  const fitRows = set.filter((r) => !holdOut.has(r.battle)).map((r) => ({ f: prep(r), y: r.y }));
  const dev = set.filter((r) => holdOut.has(r.battle)).map((r) => ({ f: prep(r), y: r.y }));
  const W1 = Array.from({ length: hidden }, () => Array.from({ length: d }, () => randn() * Math.sqrt(1 / d)));
  const b1 = new Array(hidden).fill(0);
  const W2 = Array.from({ length: hidden }, () => randn() * Math.sqrt(1 / hidden));
  let b2 = 0;
  const params = [...W1.flat(), ...b1, ...W2, b2];
  const m = new Float64Array(params.length), v = new Float64Array(params.length);
  const pack = () => [...W1.flat(), ...b1, ...W2, b2];
  const unpack = (p) => { let k = 0; for (let h = 0; h < hidden; h++) for (let i = 0; i < d; i++) W1[h][i] = p[k++]; for (let h = 0; h < hidden; h++) b1[h] = p[k++]; for (let h = 0; h < hidden; h++) W2[h] = p[k++]; b2 = p[k]; };
  const forward = (f) => {
    const a = new Array(hidden);
    let z = b2;
    for (let h = 0; h < hidden; h++) { let u = b1[h]; const w = W1[h]; for (let i = 0; i < d; i++) u += w[i] * f[i]; a[h] = Math.tanh(u); z += W2[h] * a[h]; }
    return { a, p: sigmoid(z) };
  };
  const devLoss = () => dev.reduce((acc, r) => { const { p } = forward(r.f); return acc - (r.y * Math.log(Math.max(p, 1e-12)) + (1 - r.y) * Math.log(Math.max(1 - p, 1e-12))); }, 0) / dev.length;
  let best = { loss: Infinity, p: pack(), epoch: 0 };
  let step = 0;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    for (let i = fitRows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [fitRows[i], fitRows[j]] = [fitRows[j], fitRows[i]]; }
    for (let start = 0; start < fitRows.length; start += batch) {
      const g = new Float64Array(params.length);
      const end = Math.min(fitRows.length, start + batch);
      for (let n = start; n < end; n++) {
        const { f, y } = fitRows[n];
        const { a, p } = forward(f);
        const dz = p - y;
        let k = 0;
        for (let h = 0; h < hidden; h++) { const dh = dz * W2[h] * (1 - a[h] * a[h]); for (let i = 0; i < d; i++) g[k++] += dh * f[i]; }
        for (let h = 0; h < hidden; h++) g[k++] += dz * W2[h] * (1 - a[h] * a[h]);
        for (let h = 0; h < hidden; h++) g[k++] += dz * a[h];
        g[k] += dz;
      }
      const cur = pack();
      step++;
      for (let k = 0; k < cur.length; k++) {
        const grad = g[k] / (end - start) + (k < hidden * d || (k >= hidden * d + hidden && k < hidden * d + hidden + hidden) ? l2 * cur[k] : 0);
        m[k] = 0.9 * m[k] + 0.1 * grad;
        v[k] = 0.999 * v[k] + 0.001 * grad * grad;
        cur[k] -= (lr * (m[k] / (1 - 0.9 ** step))) / (Math.sqrt(v[k] / (1 - 0.999 ** step)) + 1e-8);
      }
      unpack(cur);
    }
    const loss = devLoss();
    if (loss < best.loss - 1e-5) best = { loss, p: pack(), epoch };
    else if (epoch - best.epoch >= 8) break;
  }
  unpack(best.p);
  return { epoch: best.epoch, predict: (r) => forward(cols.map((c, k) => (r.x[c] - mean[k]) / std[k])).p };
}
if (FEATURES.length > BASE.length) {
  console.log("\n── Stage 1b (쌍 표·슬롯 HP·활성 위치 추가) ──");
  const full = FEATURES.map((_, i) => i);
  const linear = fit(train, full);
  const ml = m["잎+HP차+마릿수차"];
  const mLin = metrics(linear, test);
  console.log(`  선형 ${full.length}개        ${fmt(mLin)}`);
  let bestNet = null;
  for (const hidden of [16, 32]) {
    const net = trainMLP(train, full, { hidden });
    const mm = metrics(net, test);
    console.log(`  신경망 ${full.length}→${hidden}→1 (조기 종료 ${net.epoch}회)  ${fmt(mm)}`);
    if (!bestNet || mm.logloss < bestNet.mm.logloss) bestNet = { net, mm, hidden };
  }
  const pct = (a) => ((1 - a.logloss / ml.logloss) * 100).toFixed(2);
  console.log(`\n  공정 기준(잎+HP차+마릿수차 ${ml.logloss.toFixed(4)}) 대비 로그손실 개선: 선형 ${pct(mLin)}% · 신경망 ${pct(bestNet.mm)}%`);
  console.log(`  Stage 1b 게이트(3% 이상): ${Math.max(Number(pct(mLin)), Number(pct(bestNet.mm))) >= 3 ? "통과" : "미달"}`);
  for (const [label, lo, hi] of [["턴 0~5", 0, 5], ["턴 6~15", 6, 15], ["턴 16~", 16, 999]]) {
    const sub = test.filter((r) => r.turn >= lo && r.turn <= hi);
    if (sub.length) console.log(`    ${label.padEnd(8)} 공정 기준 ${metrics(simple, sub).logloss.toFixed(4)} → 신경망 ${metrics(bestNet.net, sub).logloss.toFixed(4)}`);
  }
}

// 학습 곡선: 학습 데이터를 늘리면 검증 손실이 얼마나 줄어드는가(판 단위로 앞에서부터 자른다) — 데이터를 더 모을 가치가 있는지 본다
console.log("\n학습 데이터 양에 따른 검증 로그손실(같은 검증 세트):");
const battleIds = [...new Set(train.map((r) => r.battle))].sort((a, b) => a - b);
for (const frac of [0.1, 0.25, 0.5, 1]) {
  const keep = new Set(battleIds.slice(0, Math.ceil(battleIds.length * frac)));
  const sub = train.filter((r) => keep.has(r.battle));
  const fairModel = fit(sub, ["leaf", "hpDiff", "aliveDiff"].map(idx));
  const allModel = fit(sub, FEATURES.map((_, i) => i));
  console.log(`  ${String(Math.round(frac * 100)).padStart(3)}% (${String(keep.size).padStart(4)}판, ${String(sub.length).padStart(6)}샘플)  잎+HP차+마릿수차 ${metrics(fairModel, test).logloss.toFixed(4)} · 전부 ${metrics(allModel, test).logloss.toFixed(4)}`);
}

console.log("\n국면별(특징 전부 vs 잎 단독, 로그손실):");
for (const [label, lo, hi] of [["턴 0~5", 0, 5], ["턴 6~15", 6, 15], ["턴 16~", 16, 999]]) {
  const sub = test.filter((r) => r.turn >= lo && r.turn <= hi);
  if (!sub.length) continue;
  console.log(`  ${label.padEnd(8)} n=${String(sub.length).padStart(6)}  잎 ${metrics(leafOnly, sub).logloss.toFixed(4)} → 전부 ${metrics(all, sub).logloss.toFixed(4)}`);
}
console.log("\n특징 가중치(원래 척도):");
FEATURES.forEach((n, i) => console.log(`  ${n.padEnd(12)} ${all.w[i + 1].toFixed(4)}`));
console.log(`  절편        ${all.w[0].toFixed(4)}`);
if (writeTo) { writeFileSync(writeTo, JSON.stringify({ features: FEATURES, intercept: all.w[0], weights: all.w.slice(1) }, null, 1)); console.log(`\n가중치 저장: ${writeTo}`); }
