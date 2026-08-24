import {
  NO_VOLATILE_CONDITIONS,
  type VolatileCondition,
  type VolatileConditionState,
} from "../types/status";

/** 혼란 지속 턴수: 1~4턴 랜덤 (사용자 확인) */
export function rollConfusionDuration(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 4);
}

/** 혼란: 매 행동 판정마다 이 확률로 자멸(물리 40위력 자가타격) */
export const CONFUSION_SELF_HIT_CHANCE = 1 / 3;

/** 혼란 자멸 데미지 계산에 쓰는 위력. 타입 상성·자속 없이 물리 공식 그대로 자기 자신에게 적용한다 */
export const CONFUSION_SELF_HIT_POWER = 40;

/**
 * 졸음(하품) 지속 턴수: 고정 2. 건 시점의 턴 종료에서 2→1로 한 번 소모되고(아직 무산),
 * 그 다음 턴 종료에서 1→0이 되는 시점에 실제로 잠듦을 시도한다 — "맞은 다음 턴 종료" 규칙.
 */
const DROWSY_DURATION = 2;

/** 풀죽음/반동은 고정 1턴만 지속 (사용자 확인) */
function defaultDuration(volatile: VolatileCondition, random: () => number): number {
  if (volatile === "confusion") return rollConfusionDuration(random);
  if (volatile === "drowsy") return DROWSY_DURATION;
  return 1;
}

/** 새 행동방해 효과를 건다. 이미 같은 효과가 걸려 있으면 지속 턴수를 새로 굴려 덮어쓴다 */
export function inflictVolatile(
  state: VolatileConditionState,
  volatile: VolatileCondition,
  random: () => number = Math.random,
): VolatileConditionState {
  return { active: { ...state.active, [volatile]: { turnsRemaining: defaultDuration(volatile, random) } } };
}

export function hasVolatile(state: VolatileConditionState, volatile: VolatileCondition): boolean {
  return state.active[volatile] !== undefined;
}

/** 판정에 썼으니 남은 턴수를 1 줄인다. 0 이하가 되면 그 효과를 제거한다 */
export function consumeVolatileTurn(
  state: VolatileConditionState,
  volatile: VolatileCondition,
): VolatileConditionState {
  const entry = state.active[volatile];
  if (!entry) return state;

  const active = { ...state.active };
  if (entry.turnsRemaining <= 1) {
    delete active[volatile];
  } else {
    active[volatile] = { turnsRemaining: entry.turnsRemaining - 1 };
  }
  return { active };
}

export function clearAllVolatiles(): VolatileConditionState {
  return { ...NO_VOLATILE_CONDITIONS, active: {} };
}
