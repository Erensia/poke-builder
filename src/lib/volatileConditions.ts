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

/** 헤롱헤롱(매혹): 걸려있는 동안 매 행동 판정마다 이 확률로 그 턴 행동을 통째로 못 한다(본가 고정 50%) */
export const ATTRACT_ACTION_BLOCK_CHANCE = 0.5;

/**
 * 졸음(하품)·희망사항 지속 턴수: 고정 2. 건 시점의 턴 종료에서 2→1로 한 번 소모되고(아직 무산),
 * 그 다음 턴 종료에서 1→0이 되는 시점에 실제로 잠듦/회복을 시도한다 — "맞은/쓴 다음 턴 종료" 규칙.
 */
const DROWSY_DURATION = 2;
const WISH_DURATION = 2;

/** 도발 지속 턴수(사용자 확인 — 효과 텍스트에 명시) */
const TAUNT_DURATION = 3;
/** 사슬묶기 지속 턴수(본가 기준값 — 이 프로젝트 효과 텍스트엔 정확한 수치가 없어 그대로 사용) */
const DISABLE_DURATION = 4;
/** 앙코르 지속 턴수(본가 기준값 — 위와 동일한 이유) */
const ENCORE_DURATION = 3;

/**
 * 뿌리박기·아쿠아링·씨뿌리기는 턴 카운터로 소모되지 않고 배틀이 끝날 때까지 유지된다(교체가
 * 없는 1v1이라 "교체 시 해제"도 해당 없음) — consumeVolatileTurn을 아예 호출하지 않으므로
 * 이 값 자체는 의미 없지만, hasVolatile 판정용으로 유효한 엔트리는 있어야 해서 큰 값을 넣는다.
 */
const PERSISTENT_UNTIL_BATTLE_END = 999;

/** 풀죽음/반동은 고정 1턴만 지속 (사용자 확인) */
function defaultDuration(volatile: VolatileCondition, random: () => number): number {
  if (volatile === "confusion") return rollConfusionDuration(random);
  if (volatile === "drowsy") return DROWSY_DURATION;
  if (volatile === "wish") return WISH_DURATION;
  if (
    volatile === "ingrain" ||
    volatile === "aquaRing" ||
    volatile === "leechSeed" ||
    volatile === "attract" ||
    volatile === "saltCure"
  ) {
    return PERSISTENT_UNTIL_BATTLE_END;
  }
  if (volatile === "taunt") return TAUNT_DURATION;
  if (volatile === "disable") return DISABLE_DURATION;
  if (volatile === "encore") return ENCORE_DURATION;
  if (volatile === "bound") return 4 + Math.floor(random() * 2); // 4~5턴
  if (volatile === "syrupCoat") return 3; // 시럽봄: 3턴 동안 매 턴 스피드 -1
  return 1;
}

/**
 * 새 행동방해 효과를 건다. 이미 같은 효과가 걸려 있으면 지속 턴수를 새로 굴려 덮어쓴다.
 * moveId는 사슬묶기(막힌 기술)·앙코르(강제된 기술)에서만 쓰인다 — 그 외 volatile은 무시된다.
 */
export function inflictVolatile(
  state: VolatileConditionState,
  volatile: VolatileCondition,
  random: () => number = Math.random,
  moveId?: string,
): VolatileConditionState {
  return {
    active: { ...state.active, [volatile]: { turnsRemaining: defaultDuration(volatile, random), moveId } },
  };
}

export function hasVolatile(state: VolatileConditionState, volatile: VolatileCondition): boolean {
  return state.active[volatile] !== undefined;
}

/**
 * 판정에 썼으니 남은 턴수를 1 줄인다. 0 이하가 되면 그 효과를 제거한다.
 * moveId(사슬묶기/앙코르)는 턴수와 무관한 값이라 갱신 시에도 그대로 들고 다닌다.
 */
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
    active[volatile] = { turnsRemaining: entry.turnsRemaining - 1, moveId: entry.moveId };
  }
  return { active };
}

export function clearAllVolatiles(): VolatileConditionState {
  return { ...NO_VOLATILE_CONDITIONS, active: {} };
}
