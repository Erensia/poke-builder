import {
  PARALYSIS_ACTION_FAIL_CHANCE,
  computeStatusEndOfTurnDamage,
  expectedStatusBlockedTurns,
} from "@/lib/statusConditions";
import { abilityOf, type BattleFighterState } from "../state";

/**
 * 상태이상 지속 데미지가 매 턴 현재 HP의 몇 비율을 깎는지(engine-extension §1-2, finishTurn과 같은 규칙).
 * 포이즌힐이면 음수(회복), 매직가드면 0, 내열이면 화상 데미지 절반.
 */
export function residualDamageFraction(fighter: BattleFighterState, hp = fighter.currentHp): number {
  const condition = fighter.status.condition;
  if (!condition || hp <= 0) return 0;
  const ability = abilityOf(fighter);
  const poisoned = condition === "poison" || condition === "badly-poisoned";
  if (poisoned && ability?.healsFromPoisonEachTurnDenominator) {
    return -Math.floor(fighter.maxHp / ability.healsFromPoisonEachTurnDenominator) / hp;
  }
  if (ability?.negatesIndirectDamage) return 0;
  const raw = computeStatusEndOfTurnDamage(fighter.status, fighter.maxHp);
  const damage = condition === "burn" && ability?.halvesBurnDamage ? Math.floor(raw / 2) : raw;
  return damage / hp;
}

/** 마비로 매 턴 행동할 확률(잠듦·얼음은 blockedTurns로 따로 셈) */
export function actionFactor(fighter: BattleFighterState): number {
  return fighter.status.condition === "paralysis" ? 1 - PARALYSIS_ACTION_FAIL_CHANCE : 1;
}

/** 잠듦·얼음으로 앞으로 막힐 기대 턴 수 */
export function blockedTurns(fighter: BattleFighterState): number {
  return expectedStatusBlockedTurns(fighter.status, fighter.effectiveAbilityId === "일찍기상");
}

/**
 * "공격측이 매 턴 target 현재 HP의 attackRate 비율을 깎는다" + target 자신의 지속 데미지 → 기대 처치 턴 수.
 * 잠듦/얼음으로 막히는 턴은 앞에 더한다(그 동안의 지속 데미지는 무시하는 근사).
 */
export function turnsToKo(attackRate: number, attacker: BattleFighterState, target: BattleFighterState, targetHp?: number): number {
  const rate = attackRate * actionFactor(attacker) + residualDamageFraction(target, targetHp);
  if (rate <= 0) return Infinity;
  return Math.max(1, blockedTurns(attacker) + 1 / rate);
}
