/**
 * 챔피언스 5대 주 상태이상(Major Status). 한 포켓몬은 이 중 하나만 가질 수 있다(중첩 없음, 사용자 확인).
 * 맹독은 독의 변종이라 일반 독과도 배타적 — 결국 이 6개 값 중 최대 하나만 걸린다.
 * 화상/독/맹독/마비는 치료(도구/기술)하기 전까지 무한 지속, 잠듦/얼음만 매턴 자체 해제 판정이 있다.
 */
export type StatusCondition = "burn" | "poison" | "badly-poisoned" | "paralysis" | "freeze" | "sleep";

/** 기술이 상대(또는 자신)에게 주 상태이상을 걸 때 쓰는 정보 */
export interface StatusInflictEffect {
  status: StatusCondition;
  /** 확률(%). 생략하면 100% 확정(독가스 등 상태이상 전용기) */
  chance?: number;
}

/** 배틀 중 한 포켓몬이 실제로 걸려있는 주 상태이상. condition이 null이면 없음 */
export interface StatusConditionState {
  condition: StatusCondition | null;
  /**
   * 상태에 따라 의미가 다르다:
   *  - 맹독: 지금까지 지난 턴 수(1턴째=1). 매턴 데미지 n/16(최대 15/16 클램프) 계산에 쓰고,
   *    턴 종료 시 advanceStatusTurn으로 늘어난다.
   *  - 잠듦/얼음: "지금이 몇 번째 해제 판정인지". checkStatusActionBlock이 판정할 때마다
   *    자체적으로 늘려서 잠듦(1턴째 0%→2턴째 33%→3턴째 100%)·얼음(매턴 25%, 3턴째 100%)
   *    스케줄을 구현한다. advanceStatusTurn과는 별개 카운터다.
   *  - 화상/독/마비: 사용하지 않음(항상 0)
   */
  turnsElapsed: number;
}

export const NO_STATUS_CONDITION: StatusConditionState = { condition: null, turnsElapsed: 0 };

/**
 * 행동방해류(Volatile Condition). 주 상태이상과는 별도 축이라 동시에 여러 개, 주 상태이상과도
 * 동시에 걸릴 수 있다(예: 마비 + 혼란 동시 보유).
 *  - flinch(풀죽음): 상대 기술의 부가효과로 걸림. 이번 턴 한정 행동 불가, 1턴 지나면 자동 소멸
 *  - recharge(반동): 기가임팩트류 기술을 쓴 다음 턴 행동 불가. 자기 자신에게 스스로 거는 효과
 *  - confusion(혼란): 1~4턴 지속(사용자 확인). 매 행동 판정마다 33% 확률로 자멸
 *    (물리 40위력으로 자기 자신을 타격, 타입 상성·자속 없음)
 *  - drowsy(졸음): 하품 전용. 건 시점엔 아무 일도 없고, 2턴 카운터가 0이 되는 시점(=하품을
 *    맞은 다음 턴 종료)에 잠듦을 시도한다 — 그 시점에 이미 다른 상태이상이거나 타입/필드로
 *    잠듦 면역이면 무산된다. flinch/recharge처럼 행동을 막는 효과가 아니라 턴 종료 처리 전용.
 */
export type VolatileCondition = "flinch" | "recharge" | "confusion" | "drowsy";

/** 기술이 상대(또는 자신)에게 행동방해 효과를 걸 때 쓰는 정보 */
export interface VolatileInflictEffect {
  volatile: VolatileCondition;
  target: "self" | "opponent";
  /** 확률(%). 생략하면 100% 확정 */
  chance?: number;
}

export interface VolatileConditionEntry {
  /** 이번 판정 이후 몇 턴 더 남았는지. 0 이하가 되면 제거된다 */
  turnsRemaining: number;
}

/** 배틀 중 한 포켓몬이 실제로 걸려있는 행동방해 효과들. 여러 개가 동시에 active일 수 있다 */
export interface VolatileConditionState {
  active: Partial<Record<VolatileCondition, VolatileConditionEntry>>;
}

export const NO_VOLATILE_CONDITIONS: VolatileConditionState = { active: {} };
