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
  /**
   * 잠자기(Move.restSleep)로 걸린 잠듦이면 true. 일반 잠듦은 checkStatusActionBlock의 확률
   * 스케줄(1턴째 0%→2턴째 33%→3턴째 100%)을 따르지만, 잠자기는 "정확히 2턴간 무조건 잠들고
   * 3턴째 무조건 깬다"는 본가 고유 규칙이라 이 값이 true면 2턴째 해제 확률도 0%로 강제한다.
   */
  isRestSleep?: boolean;
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
 *  - wish(희망사항): 건 시점엔 아무 일도 없고, drowsy와 같은 2턴 카운터가 0이 되는 시점(=쓴
 *    다음 턴 종료)에 자신의 최대 HP 절반을 회복한다. 1v1이라 "그 자리에 있는 포켓몬"이 항상
 *    사용자 자신이라 교체 시나리오는 고려하지 않는다.
 *  - ingrain(뿌리박기)/aquaRing(아쿠아링): 걸려있는 동안 매 턴 종료 시 최대 HP 1/16을 회복한다.
 *    턴 카운터로 소모되지 않고(교체가 없는 1v1이라 배틀이 끝날 때까지 유지), 큰뿌리를 지녔으면
 *    회복량이 1.3배가 된다(itemEffects.getDrainHealMultiplier).
 *  - leechSeed(씨뿌리기): 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃고, 상대가 그만큼(+큰뿌리
 *    소지 시 1.3배) 회복한다. ingrain/aquaRing과 마찬가지로 턴 카운터 없이 배틀 끝까지 유지.
 *  - taunt(도발): 3턴 동안 변화기(카테고리 status)를 선택할 수 없다. 매 턴 이 포켓몬이 행동을
 *    시도하는 시점(resolveAction)에 지속 턴수가 1씩 줄어든다.
 *  - disable(사슬묶기): 4턴 동안 걸린 시점의 "상대가 바로 직전에 쓴 기술" 하나만 선택할 수
 *    없다(VolatileConditionEntry.moveId에 그 기술 id를 저장). 사용자 제공 자료에 정확한
 *    지속시간이 없어 본가 기준값(4턴)을 그대로 썼다.
 *  - encore(앙코르): 3턴 동안 걸린 시점의 "상대가 바로 직전에 쓴 기술"만 강제로 반복해야 한다
 *    (disable과 정반대 방향 — moveId에 강제할 기술 id를 저장). 지속시간도 본가 기준값(3턴).
 *  - bound(속박): 조이기·엉겨붙기·집게덫 등에 맞으면 4~5턴 지속. 매 턴 종료 시 최대 HP 1/8을
 *    잃고, 턴 종료마다 카운터가 1씩 줄어 0에서 자동 해제된다(매직가드면 데미지 면제). 교체가
 *    없어 "빠져나올 수 없음" 부분은 무의미해 지속 데미지만 반영한다.
 *  - attract(헤롱헤롱): ingrain/aquaRing/leechSeed와 같은 "배틀 끝까지 유지"형 — 1v1이라 교체로
 *    해제될 일이 없다. 걸려있는 동안 매 행동 판정마다 50% 확률로 그 턴 행동을 통째로 못 한다
 *    (마비와 같은 확률 축이지만 별도 상태이상이 아니라 volatile — 본가에서도 주 상태이상과는
 *    별개 슬롯이라 마비 등과 동시에 걸릴 수 있다). resolveAction에서 이성 관계 판정
 *    (getEffectiveGender)까지 확인한 뒤에만 걸린다.
 */
export type VolatileCondition =
  | "flinch"
  | "recharge"
  | "confusion"
  | "drowsy"
  | "wish"
  | "ingrain"
  | "aquaRing"
  | "leechSeed"
  | "taunt"
  | "disable"
  | "encore"
  | "attract"
  | "bound";

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
  /** 사슬묶기(막힌 기술)·앙코르(강제된 기술) 전용 — 대상 기술 id. 그 외 volatile은 사용하지 않는다 */
  moveId?: string;
}

/** 배틀 중 한 포켓몬이 실제로 걸려있는 행동방해 효과들. 여러 개가 동시에 active일 수 있다 */
export interface VolatileConditionState {
  active: Partial<Record<VolatileCondition, VolatileConditionEntry>>;
}

export const NO_VOLATILE_CONDITIONS: VolatileConditionState = { active: {} };
