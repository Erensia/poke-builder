import type { Item } from "../types/item";
import type { Move } from "../types/move";

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
