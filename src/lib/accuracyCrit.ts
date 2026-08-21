import {
  isAccuracyEvasionKey,
  NEUTRAL_CRIT_STAGE,
  type AccuracyEvasionKey,
  type AccuracyEvasionStages,
  type CritStage,
} from "../types/battleStats";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";

function clampAccuracyStage(stage: number): number {
  return Math.max(-6, Math.min(6, stage));
}

function clampCritStage(stage: number): CritStage {
  return Math.max(0, Math.min(3, Math.round(stage))) as CritStage;
}

/**
 * 명중률/회피율 랭크 배율. 사용자 확인 공식 그대로:
 * s = 공격측 명중 랭크 − 방어측 회피 랭크 (−6~+6로 클램프)
 * s ≥ 0: (3+s)/3   s < 0: 3/(3+|s|)
 *
 * accuracyStage와 evasionStage는 서로 다른 포켓몬(공격측/방어측)의 값이라는 점에 주의 —
 * 각 포켓몬은 자기 자신의 명중 랭크(accuracy)와 회피 랭크(evasion)를 AccuracyEvasionStages로
 * 각각 들고 있고, 이 함수는 공격측의 accuracy와 방어측의 evasion을 한 쌍으로 받아 계산한다.
 */
export function computeAccuracyMultiplier(accuracyStage: number, evasionStage: number): number {
  const s = clampAccuracyStage(accuracyStage - evasionStage);
  return s >= 0 ? (3 + s) / 3 : 3 / (3 + Math.abs(s));
}

/**
 * 기술의 최종 적중 확률(0~1). 필중기(accuracy=null)는 null을 그대로 반환한다.
 * attackerAccuracyStage는 공격측의 accuracyStages.accuracy, defenderEvasionStage는
 * 방어측의 accuracyStages.evasion을 넘겨준다.
 * extraMultiplier는 반짝가루(0.9)·모래숨기(0.8) 같이 랭크와 별개로 곱하는 특성/도구 배율.
 */
export function computeHitChance(
  baseAccuracy: number | null,
  attackerAccuracyStage: number,
  defenderEvasionStage: number,
  extraMultiplier = 1,
): number | null {
  if (baseAccuracy === null) return null;
  const chance =
    (baseAccuracy / 100) * computeAccuracyMultiplier(attackerAccuracyStage, defenderEvasionStage) * extraMultiplier;
  return Math.max(0, Math.min(1, chance));
}

/**
 * 급소율 단계별 확률표. 급소율은 -6~+6 랭크가 아니라 0~3의 별도 카운터로,
 * 3단계에서 100%(필중 급소)에 도달한다. (사용자 확인)
 */
const CRIT_CHANCE_TABLE: Record<CritStage, number> = {
  0: 1 / 16,
  1: 1 / 8,
  2: 1 / 2,
  3: 1,
};

export function critChance(stage: CritStage = NEUTRAL_CRIT_STAGE): number {
  return CRIT_CHANCE_TABLE[clampCritStage(stage)];
}

export interface ApplyStatusStagesOptions {
  /** 조건부 효과(저주 등) 판정에 쓸, 기술을 사용한 쪽의 실제 타입 */
  userTypes?: PokemonType[];
  /** 확률부여 효과를 포함할지. 기본 true(적중한다고 가정) */
  includeChanceBased?: boolean;
}

/** move.statChanges 중 target에 해당하는 accuracy/evasion 항목만 골라 적용한다 */
export function applyMoveAccuracyEvasionChanges(
  stages: AccuracyEvasionStages,
  move: Move,
  target: "self" | "opponent",
  options: ApplyStatusStagesOptions = {},
): AccuracyEvasionStages {
  if (!move.statChanges) return stages;
  const { userTypes, includeChanceBased = true } = options;

  let next = stages;
  for (const effect of move.statChanges) {
    if (effect.target !== target) continue;
    if (!isAccuracyEvasionKey(effect.stat)) continue;
    if (effect.chance !== undefined && !includeChanceBased) continue;
    if (effect.userIsType !== undefined && (!userTypes || !userTypes.includes(effect.userIsType))) continue;
    if (effect.userIsNotType !== undefined && (!userTypes || userTypes.includes(effect.userIsNotType))) continue;

    const key: AccuracyEvasionKey = effect.stat;
    const value = effect.setTo !== undefined ? effect.setTo : next[key] + (effect.delta ?? 0);
    next = { ...next, [key]: clampAccuracyStage(value) };
  }
  return next;
}

/** move.statChanges 중 target에 해당하는 critStage 항목만 골라 적용한다 (안개제거 등은 0으로 재설정) */
export function applyMoveCritStageChanges(
  stage: CritStage,
  move: Move,
  target: "self" | "opponent",
  options: ApplyStatusStagesOptions = {},
): CritStage {
  if (!move.statChanges) return stage;
  const { userTypes, includeChanceBased = true } = options;

  let next = stage;
  for (const effect of move.statChanges) {
    if (effect.target !== target) continue;
    if (effect.stat !== "critStage") continue;
    if (effect.chance !== undefined && !includeChanceBased) continue;
    if (effect.userIsType !== undefined && (!userTypes || !userTypes.includes(effect.userIsType))) continue;
    if (effect.userIsNotType !== undefined && (!userTypes || userTypes.includes(effect.userIsNotType))) continue;

    next = clampCritStage(effect.setTo !== undefined ? effect.setTo : next + (effect.delta ?? 0));
  }
  return next;
}
