import { DAMAGE_ROLL_MIN_PERCENT, DAMAGE_ROLL_STEP_COUNT, integerHitDamage, type DamageParts } from "@/lib/damageFormula";
import type { HitsEstimate, WorstCase } from "./types";

/**
 * 배틀 AI 처치 타수 — 난수표·엔진과 같은 정수 데미지 공식(2.5 D4-b). 한 번 쓴 기술의 총 데미지를 "합계 → 확률" 분포로 만들고
 * (타마다 독립 난수·급소, 랜덤 타수는 타수 분포로 섞는다) 상대 현재 HP를 넘길 때까지의 사용 횟수를 센다.
 */

/** 이 횟수를 넘겨도 못 죽이면 "사실상 못 죽이는" 것으로 보고 평균 데미지로 남은 횟수를 근사한다 */
const MAX_USES_TRACKED = 60;

type Dist = Map<number, number>;

export interface KillModel {
  /** 첫 사용 조각 — 반감 열매(첫 타)·직전 실패 보너스가 들어 있다 */
  first: DamageParts;
  /** 두 번째 사용부터의 조각(열매·보너스 없음) */
  rest: DamageParts;
  /** 급소 가정 조각(랭크·벽 무시 반영). critChance가 0이면 없어도 된다 */
  firstCrit?: DamageParts;
  restCrit?: DamageParts;
  /** 타마다 급소 확률 */
  critChance: number;
  /** 방어측이 이 기술에서 읽는 방어 실능 */
  defenseStat: number;
  /** 한 번 쓸 때의 타수 분포 [타수, 확률] — 고정 타수는 [[n, 1]] */
  hitCounts: readonly (readonly [number, number])[];
}

/** 2~5회 기술은 2·3회 35%, 4·5회 15%(엔진 rollMultiHitCount와 같은 분포), 그 외 범위는 균등 */
export function hitCountDistribution(minHits: number, maxHits: number): [number, number][] {
  if (minHits === 2 && maxHits === 5) return [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]];
  const n = maxHits - minHits + 1;
  return Array.from({ length: n }, (_, i): [number, number] => [minHits + i, 1 / n]);
}

function convolve(a: Dist, b: Dist): Dist {
  const out: Dist = new Map();
  for (const [x, p] of a) for (const [y, q] of b) out.set(x + y, (out.get(x + y) ?? 0) + p * q);
  return out;
}

/** 한 타의 데미지 분포: 난수 16가지 × (급소면 급소 조각) */
function hitDist(
  parts: DamageParts,
  crit: DamageParts | undefined,
  critChance: number,
  hitIndex: number,
  isFirstUse: boolean,
  defenseStat: number,
): Dist {
  const out: Dist = new Map();
  const power = parts.hitPowers[hitIndex];
  const p = crit ? critChance : 0;
  const add = (damage: number, w: number) => out.set(damage, (out.get(damage) ?? 0) + w);
  for (let k = 0; k < DAMAGE_ROLL_STEP_COUNT; k++) {
    const roll = (DAMAGE_ROLL_MIN_PERCENT + k) / 100;
    const first = isFirstUse && hitIndex === 0;
    if (p < 1) add(integerHitDamage(parts, power, defenseStat, roll, first, parts.firstHitFinalMultiplier ?? 1), (1 - p) / DAMAGE_ROLL_STEP_COUNT);
    if (p > 0) add(integerHitDamage(crit!, crit!.hitPowers[hitIndex], defenseStat, roll, first, crit!.firstHitFinalMultiplier ?? 1), p / DAMAGE_ROLL_STEP_COUNT);
  }
  return out;
}

/**
 * 모델 하나에서 같은 분포를 여러 번 만들지 않게 메모한다(기대 횟수·worst_case·평균 데미지가 같은 첫/이후 사용 분포를 공유 — 3.0 P1).
 * 급소 조각이 없으면 급소 확률은 결과에 영향이 없고, 타수가 하나뿐이면 minHitsOnly도 결과가 같아서 키에서 정규화한다.
 */
const distMemo = new WeakMap<KillModel, Map<string, Dist>>();

function singleUseDist(model: KillModel, isFirstUse: boolean, critChance: number, minHitsOnly: boolean): Dist {
  const hasCrit = !!(isFirstUse ? model.firstCrit : model.restCrit);
  const minOnly = minHitsOnly && model.hitCounts.length > 1;
  const key = `${isFirstUse ? 1 : 0}|${hasCrit ? critChance : 0}|${minOnly ? 1 : 0}`;
  let perModel = distMemo.get(model);
  if (!perModel) distMemo.set(model, (perModel = new Map()));
  let dist = perModel.get(key);
  if (!dist) perModel.set(key, (dist = buildSingleUseDist(model, isFirstUse, critChance, minOnly)));
  return dist;
}

/** 기술을 한 번 쓴 총 데미지 분포. minHitsOnly면 가장 적게 맞는 타수만(하드 오버라이드용 보수적 판정) */
function buildSingleUseDist(model: KillModel, isFirstUse: boolean, critChance: number, minHitsOnly: boolean): Dist {
  const parts = isFirstUse ? model.first : model.rest;
  const crit = isFirstUse ? model.firstCrit : model.restCrit;
  const counts = minHitsOnly ? [[Math.min(...model.hitCounts.map(([n]) => n)), 1] as const] : model.hitCounts;
  const maxCount = Math.min(parts.hitPowers.length, Math.max(...counts.map(([n]) => n)));
  const mixed: Dist = new Map();
  let prefix: Dist = new Map([[0, 1]]);
  for (let i = 0; i < maxCount; i++) {
    prefix = convolve(prefix, hitDist(parts, crit, critChance, i, isFirstUse, model.defenseStat));
    const weight = counts.filter(([n]) => Math.min(n, parts.hitPowers.length) === i + 1).reduce((s, [, p]) => s + p, 0);
    if (weight > 0) for (const [sum, p] of prefix) mixed.set(sum, (mixed.get(sum) ?? 0) + p * weight);
  }
  return mixed;
}

function mean(dist: Dist): number {
  let m = 0;
  for (const [d, p] of dist) m += d * p;
  return m;
}

/** 한 번 쓸 때 평균 데미지(첫 사용, 급소·랜덤 타수 평균). 현재 HP와 무관한 절대량 */
export function meanUseDamage(model: KillModel): number {
  return mean(singleUseDist(model, true, model.critChance, false));
}

/** 분포를 [데미지, 확률] 배열로 푼 것 — Map을 매번 순회하지 않게 분포마다 한 번만 만든다(삽입 순서 그대로: 부동소수 누적 순서 유지) */
const entriesMemo = new WeakMap<Dist, { ds: number[]; qs: number[]; min: number }>();

function entriesOf(dist: Dist) {
  let e = entriesMemo.get(dist);
  if (!e) {
    const ds = [...dist.keys()];
    entriesMemo.set(dist, (e = { ds, qs: [...dist.values()], min: Math.min(...ds) }));
  }
  return e;
}

/**
 * 기대 사용 횟수 E[N] = Σ_{n≥0} P(N>n): 합계가 HP 미만인 상태의 확률을 사용 횟수마다 밀어 나간다.
 * 살아 있는 합계는 n회 뒤 최소 n×(한 번 최소 데미지) 이상이라, 앞쪽 0 구간(lo 미만)은 훑지 않는다.
 */
function expectedUses(model: KillModel, hp: number): number {
  const first = singleUseDist(model, true, model.critChance, false);
  const rest = singleUseDist(model, false, model.critChance, false);
  let alive = new Float64Array(hp);
  let next = new Float64Array(hp);
  alive[0] = 1;
  let lo = 0;
  let total = 1; // P(N > 0)
  let dist = first;
  let massLeft = 1;
  for (let n = 1; n <= MAX_USES_TRACKED && massLeft >= 1e-12; n++) {
    const { ds, qs, min } = entriesOf(dist);
    next.fill(0);
    massLeft = 0;
    for (let s = lo; s < hp; s++) {
      const a = alive[s];
      if (a === 0) continue;
      for (let j = 0; j < ds.length; j++) {
        const t = s + ds[j];
        if (t < hp) {
          next[t] += a * qs[j];
          massLeft += a * qs[j];
        }
      }
    }
    total += massLeft;
    [alive, next] = [next, alive];
    lo += min;
    dist = rest;
  }
  if (massLeft >= 1e-12) total += Math.max(0, hp / mean(rest) - MAX_USES_TRACKED);
  return Math.max(1, total);
}

function atLeast(dist: Dist, hp: number): number {
  let s = 0;
  for (const [d, p] of dist) if (d >= hp) s += p;
  return s;
}

/** 하드 오버라이드용 worst_case — 가장 적게 맞는 타수로 1·2번에 잡히는지. 급소는 critChance가 1(반드시 급소)일 때만 넣는다 */
function worstCaseOf(model: KillModel, hp: number): WorstCase {
  const certainCrit = model.critChance >= 1 ? 1 : 0;
  const first = singleUseDist(model, true, certainCrit, true);
  const p1 = atLeast(first, hp);
  if (p1 > 0) return p1 > 1 - 1e-9 ? { count: 1, certainty: "guaranteed", probability: 1 } : { count: 1, certainty: "random", probability: p1 };
  const p2 = atLeast(convolve(first, singleUseDist(model, false, certainCrit, true)), hp);
  if (p2 > 0) return p2 > 1 - 1e-9 ? { count: 2, certainty: "guaranteed", probability: 1 } : { count: 2, certainty: "random", probability: p2 };
  return { count: 3, certainty: "random", probability: 0 };
}

/**
 * 모델 → 기대 "턴 수"와 worst_case. 타입 무효(상성 0)면 Infinity·3타 이상.
 * 명중률 p: 한 방을 넣으려면 평균 1/p턴이 필요하므로(기하분포) 기대 턴 수 = E[N] / p.
 * worst_case는 데미지 롤 확정성만 나타낸다 — 명중률 게이트는 하드 오버라이드가 accuracy == 1.0으로 따로 건다.
 */
export function estimateKills(model: KillModel | null, hp: number, accuracy = 1): HitsEstimate {
  if (!model || model.first.typeEffectiveness === 0) {
    return { expected: Infinity, worstCase: { count: 3, certainty: "random", probability: 0 } };
  }
  const targetHp = Math.max(1, Math.round(hp));
  return {
    expected: accuracy <= 0 ? Infinity : expectedUses(model, targetHp) / accuracy,
    worstCase: worstCaseOf(model, targetHp),
  };
}
