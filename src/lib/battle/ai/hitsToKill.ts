import {
  BULK_BASELINE_DIVISOR,
  DAMAGE_ROLL_STEPS,
  GUARANTEED_SURVIVE_2HIT_DIVISOR,
  evaluateMatchupChance,
} from "@/lib/battlePower";
import type { HitsEstimate, WorstCase } from "./types";

const ROLL_MIN_PERCENT = 85;
/** 이 타수를 넘겨도 못 죽이면 "사실상 못 죽이는" 것으로 보고 근사로 마무리한다 */
const MAX_HITS_TRACKED = 60;

/**
 * 상대 현재 HP를 정확히 채우는 최소 격파 난수 rho* (battlePower.minKillingRoll과 같은 관계식).
 * 한 방 데미지 = 상대 현재 HP × rho / rho*.
 */
function minKillingRoll(offensePower: number, bulkPower: number): number {
  return (bulkPower * BULK_BASELINE_DIVISOR) / (GUARANTEED_SURVIVE_2HIT_DIVISOR * offensePower);
}

/**
 * 급소(ver.1.9 6-2): 매 타 chance 확률로 데미지가 scale배(급소 결정력/내구력 비 — 랭크·벽 무시·×1.5 포함). 없으면 급소 없음.
 */
export interface CritModel {
  chance: number;
  scale: number;
}

/** 한 타의 데미지 결과(퍼센트 단위 정수 — 급소 롤은 반올림)와 확률 */
function hitOutcomes(crit?: CritModel): [number, number][] {
  const p = crit && crit.chance > 0 ? Math.min(1, crit.chance) : 0;
  const out: [number, number][] = [];
  for (let k = 0; k < DAMAGE_ROLL_STEPS; k++) {
    const roll = ROLL_MIN_PERCENT + k;
    if (p < 1) out.push([roll, (1 - p) / DAMAGE_ROLL_STEPS]);
    if (p > 0) out.push([Math.round(roll * crit!.scale), p / DAMAGE_ROLL_STEPS]);
  }
  return out;
}

/**
 * 처치 타수 분포 요약(ver.1.9 벤치 속도): 한 타 결과 분포(급소 확률·반올림한 급소 롤)마다 "살아 있는 합계 경계" L(정수 퍼센트 —
 * 합계 s가 살아 있음 ⇔ s < L)별로 Σ P(N > n)(total)과 마지막 P(N > n)(last)를 한 번의 DP로 전부 낸다.
 * 합계는 늘기만 하므로 경계 L의 DP 값은 더 큰 경계의 DP에서 s < L 부분과 같다 — 경계마다 따로 DP를 돌리던 것과 덧셈 순서까지 같아
 * 결과가 비트 단위로 같다(P(N > n) = 합계 오름차순 누적). N = 처치까지 필요한 타수.
 */
interface SurvivalTable {
  total: Float64Array;
  last: Float64Array;
}

const TABLE_CACHE_LIMIT = 2000;
const tableCache = new Map<string, SurvivalTable>();

function distributionKey(crit?: CritModel): string {
  const p = crit && crit.chance > 0 ? Math.min(1, crit.chance) : 0;
  if (p === 0) return "";
  let key = String(p);
  for (let k = 0; k < DAMAGE_ROLL_STEPS; k++) key += `,${Math.round((ROLL_MIN_PERCENT + k) * crit!.scale)}`;
  return key;
}

/** 경계 L의 { Σ P(N > n), 마지막 P(N > n) } — 표를 필요한 크기까지 늘려 가며 캐시한다 */
function survivalSummary(rhoStar: number, crit?: CritModel): { total: number; last: number } {
  const outcomes = hitOutcomes(crit);
  const maxDmg = Math.max(...outcomes.map(([d]) => d));
  // MAX_HITS_TRACKED 타의 최대 합계보다 큰 경계는 전부 같은 결과(모든 합계가 살아 있음)
  const capLimit = MAX_HITS_TRACKED * maxDmg + 1;
  const limit = Math.min(aliveLimit(rhoStar), capLimit);
  const key = distributionKey(crit);
  let table = tableCache.get(key);
  if (!table || table.total.length <= limit) {
    const size = Math.min(capLimit + 1, Math.max(limit + 1, (table?.total.length ?? 0) * 2, 512));
    table = buildSurvivalTable(outcomes, size);
    if (tableCache.size >= TABLE_CACHE_LIMIT) tableCache.clear();
    tableCache.set(key, table);
  }
  return { total: table.total[limit], last: table.last[limit] };
}

/** 경계 0 ~ size−1 전부의 요약 — 합계 배열 두 개를 번갈아 쓰고, 경계마다 합계 오름차순 누적으로 P(N > n)을 낸다 */
function buildSurvivalTable(outcomes: [number, number][], size: number): SurvivalTable {
  const total = new Float64Array(size).fill(1);
  const last = new Float64Array(size);
  const done = new Uint8Array(size);
  done[0] = 1; // 경계 0: 첫 타에 반드시 쓰러짐 → P(N > 0) = 1, P(N > 1) = 0
  let remaining = size - 1;
  const minDmg = Math.min(...outcomes.map(([d]) => d));
  const maxDmg = Math.max(...outcomes.map(([d]) => d));
  // 경계 L은 합계 L − 1까지만 본다 → 합계 배열은 size − 1칸
  const top = size - 2;
  let dist = new Float64Array(Math.max(1, size - 1));
  let next = new Float64Array(Math.max(1, size - 1));
  dist[0] = 1;
  let lo = 0;
  let hi = 0;
  for (let n = 1; n <= MAX_HITS_TRACKED && remaining > 0; n++) {
    const nextLo = lo + minDmg;
    const nextHi = Math.min(top, hi + maxDmg);
    if (nextLo <= nextHi) {
      next.fill(0, nextLo, nextHi + 1);
      addOneHit(dist, next, lo, hi, top, outcomes);
    }
    // 경계 L의 P(N > n) = Σ_{t = nextLo}^{L−1} next[t](오름차순) — 도달 못 하는 칸은 0이라 더해도 값이 같다
    let run = 0;
    for (let limit = 1; limit < size; limit++) {
      const t = limit - 1;
      if (nextLo <= nextHi && t >= nextLo && t <= nextHi) run += next[t];
      if (done[limit]) continue;
      total[limit] += run;
      last[limit] = run;
      if (run < 1e-12) {
        done[limit] = 1;
        remaining--;
      }
    }
    if (nextLo > nextHi) break;
    [dist, next] = [next, dist];
    lo = nextLo;
    hi = nextHi;
  }
  return { total, last };
}

/** 한 타 더: 합계 lo~hi의 확률을 결과 분포대로 next에 더한다(합계 오름차순 · 결과 순 — 덧셈 순서 고정) */
function addOneHit(dist: Float64Array, next: Float64Array, lo: number, hi: number, top: number, outcomes: [number, number][]): void {
  for (let sum = lo; sum <= hi; sum++) {
    const p = dist[sum];
    if (p === 0) continue;
    for (const [dmg, q] of outcomes) {
      const t = sum + dmg;
      if (t <= top) next[t] += p * q;
    }
  }
}

/** 합계 s(정수 퍼센트)가 살아 있는(s/100 + 1e-9 < rhoStar) 가장 작은 경계 L — 살아 있음 ⇔ s < L */
function aliveLimit(rhoStar: number): number {
  let limit = Math.max(0, Math.ceil((rhoStar - 1e-9) * 100));
  while (limit > 0 && !((limit - 1) / 100 + 1e-9 < rhoStar)) limit--;
  while (limit / 100 + 1e-9 < rhoStar) limit++;
  return limit;
}

/**
 * 기대 타수 E[N] = Σ_{n≥0} P(N>n). 결정력이 0이면 Infinity.
 * hpFraction은 방어측 현재 HP 비율(0~1] — 내구력이 HP에 비례하므로 bulk에 그대로 곱하면 남은 HP 기준이 된다.
 */
/**
 * 한 번 맞혔을 때 평균 데미지(방어측 최대 HP 대비) — 난수 평균 0.925 기준. 현재 HP와 무관한 절대량이라, "현재 HP 대비
 * 타수"로는 알 수 없는 양(대타 HP를 깨는 턴 수 등)에 쓴다.
 */
export function meanDamageFraction(offensePower: number, bulkPower: number): number {
  if (offensePower <= 0) return 0;
  return 0.925 / minKillingRoll(offensePower, bulkPower);
}

/** E[N] = Σ P(N > n) (MAX_HITS_TRACKED 안에 안 끝나면 평균 롤로 남은 타수를 근사) */
function expectedFromSurvival(rhoStar: number, crit?: CritModel): number {
  const { total, last } = survivalSummary(rhoStar, crit);
  return last >= 1e-12 ? total + (rhoStar / 0.925 - MAX_HITS_TRACKED) : total;
}

/**
 * firstHitScale(≠ 1): 첫 타만 데미지가 그 배율인 경우(반감 열매 — 첫 타에 소모 ×½, ver.1.9 6-1 · 분함의발구르기 직전 실패 ×2). bulkPower는 열매 없는 값.
 * 첫 타 결과(난수 16가지 × 급소 여부)마다 남은 HP를 채우는 나머지 타수의 분포를 따로 구해 평균한다.
 * crit: 매 타 급소 확률·배율(ver.1.9 6-2).
 */
export function expectedHits(offensePower: number, bulkPower: number, hpFraction = 1, firstHitScale = 1, crit?: CritModel): number {
  if (offensePower <= 0) return Infinity;
  const rhoStar = minKillingRoll(offensePower, bulkPower * hpFraction);
  if (firstHitScale === 1) return Math.max(1, expectedFromSurvival(rhoStar, crit));
  let total = 0;
  for (const [dmg, q] of hitOutcomes(crit)) {
    const residual = rhoStar - (firstHitScale * dmg) / 100;
    // 첫 타로 쓰러짐(battlePower.rollsAtLeast와 같은 경계 보정)이면 1타, 아니면 1 + 나머지 타수
    total += q * (residual <= 1e-9 ? 1 : 1 + expectedFromSurvival(residual, crit));
  }
  return Math.max(1, total);
}

/** 5단계 판정(evaluateMatchupChance)을 worst_case 구조로 옮긴다. */
export function worstCaseFromMatchup(offensePower: number, bulkPower: number, hpFraction = 1): WorstCase {
  if (offensePower <= 0) return { count: 3, certainty: "random", probability: 0 };
  const chance = evaluateMatchupChance(offensePower, bulkPower * hpFraction);
  switch (chance.verdict) {
    case "guaranteed-1hit":
      return { count: 1, certainty: "guaranteed", probability: 1 };
    case "random-1hit":
      return { count: 1, certainty: "random", probability: chance.koChance ?? 0 };
    case "guaranteed-2hit":
      return { count: 2, certainty: "guaranteed", probability: 1 };
    case "random-2hit":
      return { count: 2, certainty: "random", probability: chance.koChance ?? 0 };
    case "needs-3hit-plus":
      return { count: 3, certainty: "random", probability: 0 };
  }
}

/**
 * 결정력·내구력 → 기대 "턴 수"와 worst_case.
 * 명중률 p: 한 방을 넣으려면 평균 1/p턴이 필요하므로(기하분포) 기대 턴 수 = E[N] / p.
 * worst_case는 데미지 롤 확정성만 나타낸다 — 명중률 게이트는 하드 오버라이드가 accuracy == 1.0으로 따로 건다.
 */
export function estimateHits(
  offensePower: number,
  bulkPower: number,
  options: { hpFraction?: number; accuracy?: number; firstHitScale?: number; crit?: CritModel } = {},
): HitsEstimate {
  const { hpFraction = 1, accuracy = 1, firstHitScale = 1, crit } = options;
  const hits = expectedHits(offensePower, bulkPower, hpFraction, firstHitScale, crit);
  // worst_case(1·2타 확정성, 하드 오버라이드용)는 급소를 빼고 보수적으로: 첫 타가 약하면(열매) 그 배율을 모든 타에, 첫 타가 세면
  // (직전 실패 2배) 한 방 판정만 그 배율
  const scaled = worstCaseFromMatchup(offensePower * firstHitScale, bulkPower, hpFraction);
  const worstCase = firstHitScale > 1 && scaled.count > 1 ? worstCaseFromMatchup(offensePower, bulkPower, hpFraction) : scaled;
  return {
    expected: accuracy <= 0 ? Infinity : hits / accuracy,
    worstCase,
  };
}
