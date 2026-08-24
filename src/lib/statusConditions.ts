import { NO_STATUS_CONDITION, type StatusCondition, type StatusConditionState } from "../types/status";
import type { MoveCategory } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";

/** 마비: 매번 12.5% 확률로 행동 불가 (챔피언스는 본가 25%에서 하향) */
export const PARALYSIS_ACTION_FAIL_CHANCE = 0.125;

/** 잠듦 해제 확률 스케줄: 1턴째 0%(반드시 잠듦 유지), 2턴째 33%. 3턴째부터는 100% 강제 해제 */
const SLEEP_WAKE_CHANCE_BY_TURN: Record<number, number> = { 1: 0, 2: 1 / 3 };

/** 얼음 해제 확률: 매턴 25%. 3턴째부터는 100% 강제 해제 */
const FREEZE_THAW_CHANCE = 0.25;

/** 맹독 데미지가 늘어나는 상한 — n/16에서 n은 최대 15까지만 (그 이상은 15/16으로 고정) */
const BADLY_POISONED_MAX_TURNS = 15;

/**
 * 타입에 따른 상태이상 면역 (사용자 확인): 전기=마비, 독/강철=독·맹독, 불꽃=화상, 얼음=얼음 면역.
 * 쾌청 날씨의 얼음 면역(타입이 아니라 날씨 조건)은 별도 — battleSimulator.ts의 inflictsStatus 처리에서
 * state.weather === "쾌청"이면 얼음을 걸지 않도록 따로 분기한다(이 함수는 타입 기준 면역만 다룸).
 */
export function isImmuneToStatus(status: StatusCondition, defenderTypes: PokemonType[]): boolean {
  if (status === "paralysis" && defenderTypes.includes("전기")) return true;
  if ((status === "poison" || status === "badly-poisoned") && (defenderTypes.includes("독") || defenderTypes.includes("강철"))) {
    return true;
  }
  if (status === "burn" && defenderTypes.includes("불꽃")) return true;
  if (status === "freeze" && defenderTypes.includes("얼음")) return true;
  return false;
}

export function inflictStatus(state: StatusConditionState, status: StatusCondition): StatusConditionState {
  // 이미 상태이상이 있으면 중첩되지 않는다 (사용자 확인 자료)
  if (state.condition) return state;
  return { condition: status, turnsElapsed: 1 };
}

export function cureStatus(): StatusConditionState {
  return { ...NO_STATUS_CONDITION };
}

/**
 * 맹독의 매턴 증가 카운터만 여기서 늘린다(턴 종료 시 호출). 잠듦/얼음의 해제 판정 카운터는
 * checkStatusActionBlock 쪽에서 판정할 때마다 자체적으로 늘리므로 여기서 건드리지 않는다 —
 * 안 그러면 잠듦/얼음 턴 카운트가 두 번 늘어난다.
 */
export function advanceStatusTurn(state: StatusConditionState): StatusConditionState {
  if (state.condition !== "badly-poisoned") return state;
  return { ...state, turnsElapsed: state.turnsElapsed + 1 };
}

/**
 * 턴 종료 시 상태이상으로 받는 고정 데미지. 화상 1/16, 독 1/8, 맹독은 걸린 턴수(n)에 비례해
 * n/16씩 누적 증가하되 최대 15/16에서 클램프된다 — 전부 최대 HP 기준, 소수점은 버림.
 * 잠듦/얼음/마비는 매턴 데미지가 없다.
 */
export function computeStatusEndOfTurnDamage(state: StatusConditionState, maxHp: number): number {
  switch (state.condition) {
    case "burn":
      return Math.floor(maxHp / 16);
    case "poison":
      return Math.floor(maxHp / 8);
    case "badly-poisoned":
      return Math.floor((maxHp * Math.min(BADLY_POISONED_MAX_TURNS, state.turnsElapsed)) / 16);
    default:
      return 0;
  }
}

/**
 * 근성 특성이거나 객기 기술이면 화상의 물리 공격력 감소 효과를 무시한다 (사용자 확인).
 * 본가처럼 근성이 상태이상일 때 공격력 자체를 오히려 올려주는지는 미확인이라, "감소를 무시"하는
 * 것까지만 반영하고 별도 상승 배율은 걸지 않는다.
 */
export function ignoresBurnAttackPenalty(attackerAbilityId: string | undefined, moveId: string): boolean {
  return attackerAbilityId === "근성" || moveId === "객기";
}

/** 화상은 물리 공격력을 0.5배로 낮춘다 — 근성/객기면 예외(ignoresBurnAttackPenalty) */
export function computeStatusAttackMultiplier(
  condition: StatusCondition | null,
  moveCategory: MoveCategory | null,
  ignorePenalty = false,
): number {
  if (ignorePenalty) return 1;
  return condition === "burn" && moveCategory === "physical" ? 0.5 : 1;
}

/** 마비는 스피드를 0.5배로 낮춘다 */
export function computeStatusSpeedMultiplier(condition: StatusCondition | null): number {
  return condition === "paralysis" ? 0.5 : 1;
}

export interface StatusActionCheckResult {
  /** 이번 턴 행동이 막혔는지 */
  blocked: boolean;
  /** 잠듦/얼음이 이번 판정에서 풀렸거나 해제 카운터가 늘어났으면 갱신된 상태. 그 외엔 입력과 동일 */
  nextState: StatusConditionState;
}

/**
 * 이번 턴 행동이 주 상태이상 때문에 막히는지 판정한다.
 *  - 마비: 매번 12.5% 확률로 막힘 (turnsElapsed 사용 안 함)
 *  - 잠듦: 1턴째 0%→2턴째 33%→3턴째 100% 스케줄로 해제 판정. 안 풀리면 turnsElapsed를 늘려서 반환
 *  - 얼음: 매턴 25%, 3턴째부터 100%로 동일한 방식
 *  - 그 외(화상/독/맹독/없음): 절대 막지 않음
 */
export function checkStatusActionBlock(
  state: StatusConditionState,
  random: () => number = Math.random,
): StatusActionCheckResult {
  if (state.condition === "paralysis") {
    return { blocked: random() < PARALYSIS_ACTION_FAIL_CHANCE, nextState: state };
  }

  if (state.condition === "sleep") {
    const wakeChance = state.turnsElapsed >= 3 ? 1 : (SLEEP_WAKE_CHANCE_BY_TURN[state.turnsElapsed] ?? 0);
    if (random() < wakeChance) return { blocked: false, nextState: cureStatus() };
    return { blocked: true, nextState: { ...state, turnsElapsed: state.turnsElapsed + 1 } };
  }

  if (state.condition === "freeze") {
    const thawChance = state.turnsElapsed >= 3 ? 1 : FREEZE_THAW_CHANCE;
    if (random() < thawChance) return { blocked: false, nextState: cureStatus() };
    return { blocked: true, nextState: { ...state, turnsElapsed: state.turnsElapsed + 1 } };
  }

  return { blocked: false, nextState: state };
}
