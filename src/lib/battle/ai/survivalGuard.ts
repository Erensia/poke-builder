import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { type BattleFighterState } from "../state";
import type { MoveHitEstimate } from "./moveDamage";

/**
 * 생존 보장 후처리(engine-extension §3-0) + 탈(§3-2-2). 기대 타수·worst_case를 보정해서, 하드
 * 오버라이드가 "실제로는 버티는 상대"에게 발동하지 않게 한다.
 *  - 탈(미파손): 첫 타가 무효 — 한 타 더 필요
 *  - 옹골참(특성)·기합의띠(도구, 미소모): 풀피에서 1타에 죽을 공격이면 1HP로 버팀 → 최소 2타(확정)
 *  - 기합의머리띠: 1타에 죽을 공격이면 10%(도구 수치) 확률로 버팀
 * defenderAbility는 틀깨기 반영 후의 값(틀깨기면 옹골참·탈 무시).
 */
export function applySurvivalGuard(
  estimate: MoveHitEstimate,
  defender: BattleFighterState,
  defenderAbility: Ability | undefined,
  defenderItem: Item | undefined,
  defenderHp: number,
): MoveHitEstimate {
  if (!Number.isFinite(estimate.rawHits)) return estimate;
  let { rawHits } = estimate;
  let worstCase = { ...estimate.worstCase };

  if (defenderAbility?.negatesFirstHitThenRecoils && !defender.disguiseBroken) {
    rawHits += 1;
    worstCase = { ...worstCase, count: Math.min(worstCase.count + 1, 3), probability: worstCase.count + 1 > 3 ? 0 : worstCase.probability };
  }

  const atFullHp = defenderHp === defender.maxHp;
  const sturdyLike =
    atFullHp &&
    (!!defenderAbility?.survivesLethalAtFullHp || (!!defenderItem?.survivesLethalAtFullHpOnce && !defender.itemConsumed));
  if (sturdyLike && worstCase.count === 1) {
    rawHits = Math.max(rawHits, 2);
    worstCase = { count: 2, certainty: "guaranteed", probability: 1 };
  } else if (defenderItem?.survivesLethalChance && worstCase.count === 1) {
    const pSurvive = defenderItem.survivesLethalChance / 100;
    rawHits += pSurvive * worstCase.probability;
    worstCase = { ...worstCase, certainty: "random", probability: worstCase.probability * (1 - pSurvive) };
  }

  return {
    ...estimate,
    rawHits,
    expected: estimate.accuracy > 0 ? rawHits / estimate.accuracy : Infinity,
    worstCase,
  };
}
