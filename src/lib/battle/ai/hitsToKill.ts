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
 * P(N > n) 열: 난수 롤(85~100, 각 1/16)이 독립일 때 n번 때려도 아직 안 죽었을 확률을
 * n = 0, 1, 2, ... 순으로 낸다(합계 정수 DP라 정확 — 급소 롤만 퍼센트 반올림). N = 처치까지 필요한 타수.
 */
function survivalProbabilities(rhoStar: number, crit?: CritModel): number[] {
  // 결과는 "살아 있는 합계"의 경계(정수 퍼센트 L — 합계 s가 살아 있음 ⇔ s < L)와 한 타 결과 분포(급소 확률·반올림한 급소 롤)에만
  // 달렸다. 같은 조합은 캐시해서 다시 쓴다(계산 값은 그대로 — 판단 1회에 같은 대면을 수백 번 다시 계산하던 비용, ver.1.9 벤치 속도).
  const p = crit && crit.chance > 0 ? Math.min(1, crit.chance) : 0;
  let key = String(aliveLimit(rhoStar));
  if (p > 0) {
    key += `|${p}`;
    for (let k = 0; k < DAMAGE_ROLL_STEPS; k++) key += `,${Math.round((ROLL_MIN_PERCENT + k) * crit!.scale)}`;
  }
  const cached = survivalCache.get(key);
  if (cached) return cached;
  const survives = computeSurvival(rhoStar, hitOutcomes(crit));
  if (survivalCache.size >= SURVIVAL_CACHE_LIMIT) survivalCache.clear();
  survivalCache.set(key, survives);
  return survives;
}

const SURVIVAL_CACHE_LIMIT = 50000;
const survivalCache = new Map<string, number[]>();

/** 합계 s(정수 퍼센트)가 살아 있는(s/100 + 1e-9 < rhoStar) 가장 작은 경계 L — 살아 있음 ⇔ s < L */
function aliveLimit(rhoStar: number): number {
  let limit = Math.max(0, Math.ceil((rhoStar - 1e-9) * 100));
  while (limit > 0 && !((limit - 1) / 100 + 1e-9 < rhoStar)) limit--;
  while (limit / 100 + 1e-9 < rhoStar) limit++;
  return limit;
}

function computeSurvival(rhoStar: number, outcomes: [number, number][]): number[] {
  const survives: number[] = [1];
  // dist[s] = 정수 합계 s(퍼센트 단위)이면서 아직 살아 있을(s < limit) 확률 — 배열 두 개를 번갈아 쓴다(Map 대비 할당·GC 없음).
  // 한 타 데미지가 [minDmg, maxDmg]라 n타 뒤 도달 가능한 합계는 [n·minDmg, n·maxDmg] 구간뿐이다.
  const limit = aliveLimit(rhoStar);
  if (limit <= 0) return [1, 0];
  let dist = new Float64Array(limit);
  let next = new Float64Array(limit);
  dist[0] = 1;
  let lo = 0;
  let hi = 0;
  const minDmg = Math.min(...outcomes.map(([d]) => d));
  const maxDmg = Math.max(...outcomes.map(([d]) => d));
  for (let n = 1; n <= MAX_HITS_TRACKED; n++) {
    const nextLo = lo + minDmg;
    const nextHi = Math.min(limit - 1, hi + maxDmg);
    if (nextLo > nextHi) {
      survives.push(0);
      break;
    }
    next.fill(0, nextLo, nextHi + 1);
    for (let sum = lo; sum <= hi; sum++) {
      const p = dist[sum];
      if (p === 0) continue;
      for (const [dmg, q] of outcomes) {
        const t = sum + dmg;
        if (t < limit) next[t] += p * q;
      }
    }
    let alive = 0;
    for (let t = nextLo; t <= nextHi; t++) alive += next[t];
    survives.push(alive);
    if (alive < 1e-12) break;
    [dist, next] = [next, dist];
    lo = nextLo;
    hi = nextHi;
  }
  return survives;
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

/** survivalProbabilities 열의 합 = E[N] (MAX_HITS_TRACKED 안에 안 끝나면 평균 롤로 남은 타수를 근사) */
function expectedFromSurvival(survives: number[], rhoStar: number): number {
  let total = survives.reduce((sum, p) => sum + p, 0);
  if (survives[survives.length - 1] >= 1e-12) {
    total += rhoStar / 0.925 - MAX_HITS_TRACKED;
  }
  return total;
}

/**
 * firstHitScale(≠ 1): 첫 타만 데미지가 그 배율인 경우(반감 열매 — 첫 타에 소모 ×½, ver.1.9 6-1 · 분함의발구르기 직전 실패 ×2). bulkPower는 열매 없는 값.
 * 첫 타 결과(난수 16가지 × 급소 여부)마다 남은 HP를 채우는 나머지 타수의 분포를 따로 구해 평균한다.
 * crit: 매 타 급소 확률·배율(ver.1.9 6-2).
 */
export function expectedHits(offensePower: number, bulkPower: number, hpFraction = 1, firstHitScale = 1, crit?: CritModel): number {
  if (offensePower <= 0) return Infinity;
  const rhoStar = minKillingRoll(offensePower, bulkPower * hpFraction);
  if (firstHitScale === 1) return Math.max(1, expectedFromSurvival(survivalProbabilities(rhoStar, crit), rhoStar));
  let total = 0;
  for (const [dmg, q] of hitOutcomes(crit)) {
    const residual = rhoStar - (firstHitScale * dmg) / 100;
    // 첫 타로 쓰러짐(battlePower.rollsAtLeast와 같은 경계 보정)이면 1타, 아니면 1 + 나머지 타수
    total += q * (residual <= 1e-9 ? 1 : 1 + expectedFromSurvival(survivalProbabilities(residual, crit), residual));
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
