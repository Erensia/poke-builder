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
  const survives: number[] = [1];
  const outcomes = hitOutcomes(crit);
  // dist[s] = 정수 합계 s(퍼센트 단위)일 확률
  let dist = new Map<number, number>([[0, 1]]);
  for (let n = 1; n <= MAX_HITS_TRACKED; n++) {
    const next = new Map<number, number>();
    for (const [sum, p] of dist) {
      for (const [dmg, q] of outcomes) {
        const s = sum + dmg;
        next.set(s, (next.get(s) ?? 0) + p * q);
      }
    }
    let alive = 0;
    const stillAlive = new Map<number, number>();
    for (const [s, p] of next) {
      // battlePower.rollsAtLeast와 같은 부동소수점 경계 보정(1e-9)
      if (s / 100 + 1e-9 < rhoStar) {
        alive += p;
        stillAlive.set(s, p);
      }
    }
    survives.push(alive);
    if (alive < 1e-12) break;
    dist = stillAlive;
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
