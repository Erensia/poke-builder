import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { type Move } from "@/types/move";
import { computeHitChance } from "@/lib/accuracyCrit";
import { getItemAccuracyMultiplier } from "@/lib/itemEffects";
import { activeWeather, type BattleFighterState, type BattleState } from "./state";

export interface BattleHitChanceInput {
  state: BattleState;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  /** 타입/분류 변경까지 반영된 실효 기술 */
  move: Move;
  /** 의욕 판정에 쓸 분류. 생략하면 move.category (실전 엔진은 변경 전 원래 기술의 분류를 넘긴다) */
  hustleCategory?: Move["category"];
  attackerAbility: Ability | undefined;
  /** 틀깨기 반영 후의 방어측 특성 */
  defenderAbility: Ability | undefined;
  attackerItem: Item | undefined;
  defenderItem: Item | undefined;
  attackerMovesSecond: boolean;
}

/**
 * 실전 명중 확률(0~1). 반드시 명중하면 null. 실전 엔진(preHitEffects)과 배틀 AI가 같은 계산을 쓴다.
 *  - 배율: 반짝가루(방어측 0.9)·광각렌즈(1.1)·포커스렌즈(후공 시 1.2)·모래숨기/눈숨기(날씨 조건부 0.8)·
 *    복안(1.3)·의욕(물리 0.8)을 전부 한 배율로 곱한다.
 *  - 날카로운눈: 상대 회피율 상승분만 무시(마이너스 회피율은 존중). 성스러운칼류는 회피율을 완전히 0으로.
 *  - 노가드(어느 한쪽)·플라잉프레스 vs 작아지기 사용 이력: 필중.
 */
export function computeBattleHitChance(input: BattleHitChanceInput): number | null {
  const { state, attacker, defender, move, attackerAbility, defenderAbility, attackerItem, defenderItem, attackerMovesSecond } =
    input;
  const hustleCategory = input.hustleCategory === undefined ? move.category : input.hustleCategory;
  const weatherAccuracyBoost = defenderAbility?.weatherOpponentAccuracyMultiplier;
  const hustleAccuracyMultiplier =
    hustleCategory === "physical" && attackerAbility?.hustlePhysicalAccuracyMultiplier !== undefined
      ? attackerAbility.hustlePhysicalAccuracyMultiplier
      : 1;
  const abilityAccuracyMultiplier =
    (weatherAccuracyBoost && weatherAccuracyBoost.weather === activeWeather(state) ? weatherAccuracyBoost.multiplier : 1) *
    (attackerAbility?.userAccuracyMultiplier ?? 1) *
    hustleAccuracyMultiplier;
  const accuracyExtraMultiplier =
    getItemAccuracyMultiplier(attackerItem, defenderItem, attackerMovesSecond) * abilityAccuracyMultiplier;
  const effectiveDefenderEvasion = attackerAbility?.ignoresOpponentEvasionBoost
    ? Math.min(defender.accuracyStages.evasion, 0)
    : move.ignoresDefenderStatStagesInDamage
      ? 0
      : defender.accuracyStages.evasion;
  const minimizeBonusActive = !!(move.bonusVsMinimize && defender.usedMoveIds?.["작아지기"]);
  if (attackerAbility?.alwaysHits || defenderAbility?.alwaysHits || minimizeBonusActive) return null;
  return computeHitChance(move.accuracy, attacker.accuracyStages.accuracy, effectiveDefenderEvasion, accuracyExtraMultiplier);
}
