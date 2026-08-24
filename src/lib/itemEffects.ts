import type { Item } from "../types/item";
import type { Move } from "../types/move";
import type { StatusCondition } from "../types/status";

/** 메트로놈: 연속 같은 기술 스트릭에 따른 위력 배율. streak=1(첫 사용)이면 아직 보너스 없음(1배) */
function consecutiveSameMoveMultiplier(item: Item | undefined, streak: number): number {
  if (!item?.consecutiveSameMoveMultiplier || streak <= 1) return 1;
  const { perStreak, max } = item.consecutiveSameMoveMultiplier;
  return Math.min(max, 1 + perStreak * (streak - 1));
}

/**
 * 공격측이 지닌 도구가 이번 기술에 주는 위력 배율. 실크스카프류(타입 일치)·힘의머리띠/박식안경
 * (분류 일치)·생명의구슬(전체)·달인의띠(효과가 굉장했을 때)·메트로놈(연속 사용)을 전부 곱해서 반환한다
 * — 한 도구가 동시에 여러 조건에 해당하는 경우는 없어서 곱해도 안전하다.
 */
export function getItemOffenseMultiplier(
  item: Item | undefined,
  move: Move,
  typeEffectiveness: number,
  sameMoveStreak: number,
): number {
  if (!item) return 1;
  let multiplier = 1;
  if (item.moveTypeMultiplier && move.type === item.moveTypeMultiplier.type) {
    multiplier *= item.moveTypeMultiplier.multiplier;
  }
  if (item.moveCategoryMultiplier && move.category === item.moveCategoryMultiplier.category) {
    multiplier *= item.moveCategoryMultiplier.multiplier;
  }
  if (item.powerMultiplier) {
    multiplier *= item.powerMultiplier;
  }
  if (item.superEffectiveMultiplier && typeEffectiveness >= 2) {
    multiplier *= item.superEffectiveMultiplier;
  }
  multiplier *= consecutiveSameMoveMultiplier(item, sameMoveStreak);
  return multiplier;
}

/**
 * 방어측이 지닌 나무열매(카리열매 등 18종)가 이번 피격에 주는 방어 배율. 타입이 일치하고
 * 상성이 2배 이상("효과가 굉장하다")이며 아직 안 쓴 상태일 때만 데미지를 반감시킨다.
 * bulkMultiplier는 데미지 공식에서 나누는 값이라, 데미지를 반으로 줄이려면 2를 반환해야 한다.
 * 실제로 소모됐는지는 consumed로 알려준다 — 호출부가 BattleFighterState.itemConsumed를 갱신해야 한다.
 */
/**
 * 명중률 전용 배율 배선 — 랭크(accuracyStages)와 별개로 곱하는 특성/도구 배율 중 도구 쪽.
 * 광각렌즈(공격측, 항상)·포커스렌즈(공격측, 이번 턴 상대보다 늦게 움직일 때만)·반짝가루(방어측,
 * 상대가 자신에게 쓰는 기술 한정)를 전부 곱해서 반환한다 — 한 포켓몬이 이 셋을 동시에 지닐 순
 * 없지만(도구는 1개), 공격측 도구와 방어측 도구가 같은 판정에 동시에 걸리는 경우는 있어서 곱한다.
 */
export function getItemAccuracyMultiplier(
  attackerItem: Item | undefined,
  defenderItem: Item | undefined,
  attackerMovesSecond: boolean,
): number {
  let multiplier = 1;
  if (attackerItem?.accuracyMultiplier) {
    multiplier *= attackerItem.accuracyMultiplier;
  }
  if (attackerItem?.accuracyMultiplierWhenMovingSecond && attackerMovesSecond) {
    multiplier *= attackerItem.accuracyMultiplierWhenMovingSecond;
  }
  if (defenderItem?.opponentAccuracyMultiplier) {
    multiplier *= defenderItem.opponentAccuracyMultiplier;
  }
  return multiplier;
}

/** 큰뿌리(Item.drainHealMultiplier)가 없으면 1배 그대로 */
export function getDrainHealMultiplier(item: Item | undefined): number {
  return item?.drainHealMultiplier ?? 1;
}

/**
 * 리샘열매 등 7종 — 대상이 이 도구가 커버하는 주 상태이상에 걸리는 "그 순간" 치료하고 소모된다.
 * 이미 소모됐거나, 상태이상이 없거나, 이 도구가 커버하는 상태이상이 아니면 아무 일도 없다.
 */
export function getStatusCureBerryResult(
  item: Item | undefined,
  status: StatusCondition | null,
  alreadyConsumed: boolean,
): boolean {
  if (alreadyConsumed || !status || !item?.curesStatusOnInflict) return false;
  return item.curesStatusOnInflict.includes(status);
}

/** 시몬열매 — 혼란에 걸리는 순간 치료하고 소모된다 */
export function getConfusionCureBerryResult(item: Item | undefined, alreadyConsumed: boolean): boolean {
  return !alreadyConsumed && !!item?.curesConfusionOnInflict;
}

/**
 * 자뭉열매(1/4 회복)·오랭열매(고정 10 회복) — 체력이 최대 HP 1/2 이하가 되면 1회 자동 발동한다.
 * 두 도구 다 healsBelowHalfHp* 계열 필드 중 하나만 갖고 있어서 겹칠 일은 없다.
 */
export function getHpThresholdBerryHeal(
  item: Item | undefined,
  currentHp: number,
  maxHp: number,
  alreadyConsumed: boolean,
): number {
  if (alreadyConsumed || currentHp <= 0 || currentHp > maxHp / 2) return 0;
  if (item?.healsBelowHalfHpDenominator) return Math.floor(maxHp / item.healsBelowHalfHpDenominator);
  if (item?.healsBelowHalfHpFlat) return item.healsBelowHalfHpFlat;
  return 0;
}

export function getBerryDefenseResult(
  item: Item | undefined,
  moveType: string | null,
  typeEffectiveness: number,
  alreadyConsumed: boolean,
): { bulkMultiplier: number; consumed: boolean } {
  if (!item?.resistsSuperEffectiveType || alreadyConsumed) return { bulkMultiplier: 1, consumed: false };
  if (moveType !== item.resistsSuperEffectiveType || typeEffectiveness < 2) {
    return { bulkMultiplier: 1, consumed: false };
  }
  return { bulkMultiplier: 2, consumed: true };
}
