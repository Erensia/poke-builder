import { NEUTRAL_STAGES, type BattleStatKey, type StatStages } from "../types/battleStats";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";

export { NEUTRAL_STAGES };

function clampStage(stage: number): number {
  return Math.max(-6, Math.min(6, stage));
}

/** 상대 기준(delta)만큼 랭크를 올리거나 내린다. -6~+6으로 자동 클램프 */
export function applyStageDelta(stages: StatStages, stat: BattleStatKey, delta: number): StatStages {
  return { ...stages, [stat]: clampStage(stages[stat] + delta) };
}

/** 랭크를 절댓값으로 설정한다 (예: 배북 → 공격 +6 고정) */
export function setStage(stages: StatStages, stat: BattleStatKey, value: number): StatStages {
  return { ...stages, [stat]: clampStage(value) };
}

/** 모든 랭크를 초기화한다 (흑안개, 교체 등) */
export function resetStages(): StatStages {
  return { ...NEUTRAL_STAGES };
}

export interface ApplyMoveStatChangesOptions {
  /** 조건부 효과(저주 등) 판정에 쓸, 기술을 사용한 쪽의 실제 타입 */
  userTypes?: PokemonType[];
  /** 확률부여 효과(아이언테일 등)를 포함할지. 기본 true(적중한다고 가정) */
  includeChanceBased?: boolean;
}

/**
 * move.statChanges 중 target(자신/상대)에 해당하는 항목만 골라 stages에 적용한다.
 * userIsType / userIsNotType 조건이 있으면 options.userTypes로 판정하고,
 * userTypes를 안 주면 조건부 항목은 스킵한다(안전한 기본값).
 */
export function applyMoveStatChanges(
  stages: StatStages,
  move: Move,
  target: "self" | "opponent",
  options: ApplyMoveStatChangesOptions = {},
): StatStages {
  if (!move.statChanges) return stages;
  const { userTypes, includeChanceBased = true } = options;

  let next = stages;
  for (const effect of move.statChanges) {
    if (effect.target !== target) continue;
    if (effect.chance !== undefined && !includeChanceBased) continue;

    if (effect.userIsType !== undefined) {
      if (!userTypes || !userTypes.includes(effect.userIsType)) continue;
    }
    if (effect.userIsNotType !== undefined) {
      if (!userTypes || userTypes.includes(effect.userIsNotType)) continue;
    }

    next =
      effect.setTo !== undefined
        ? setStage(next, effect.stat, effect.setTo)
        : applyStageDelta(next, effect.stat, effect.delta ?? 0);
  }
  return next;
}
