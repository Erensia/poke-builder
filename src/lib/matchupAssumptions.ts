import { getAbility } from "./data";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost } from "./statusConditions";
import type { MatchupSlot } from "../types/matchup";
import type { Move } from "../types/move";

/**
 * 매치업 카드의 가정 토글(공격 슬롯의 상태이상·HP 비율·이전 턴 조건·급소·자속보정, 방어 슬롯의 상태이상·HP 가득)을
 * evaluateSlotMatchup의 계산 옵션으로 바꾼다(ver.1.9). 화상 물리 반감(근성·객기 예외)은 배틀 AI처럼 추가 공격 배율로 넘긴다 —
 * 근성류 상승은 위력 단계, 화상 ×0.5는 최종 단계로 따로(2.4 B3 — 정수 데미지 공식의 단계 구분). move가 없으면 두 배율은 1.
 */
export function assumedMatchupOptions(attacker: MatchupSlot, defender: MatchupSlot, move?: Move) {
  const status = attacker.statusAssumed ?? null;
  return {
    attackerStatus: status,
    defenderStatus: defender.statusAssumed ?? null,
    defenderHasStatusCondition: !!defender.statusAssumed,
    attackerHpFraction: (attacker.hpPercent ?? 100) / 100,
    abilityHpFraction: attacker.pinchAssumed ? 1 / 3 : 1,
    attackerMovesLast: !!attacker.movesLastAssumed,
    attackerTookDamageThisTurn: !!attacker.tookDamageAssumed,
    attackerMoveFailedLastTurn: !!attacker.moveFailedAssumed,
    attackerStatLoweredThisTurn: !!attacker.statLoweredAssumed,
    defenderDamagedThisTurn: !!attacker.targetDamagedAssumed,
    defenderMinimized: !!attacker.targetMinimizedAssumed,
    critical: !!attacker.critAssumed,
    attackerTypeToMoveType: !!attacker.typeShiftAssumed,
    defenderHpIsFull: defender.fullHpAssumed ?? true,
    extraOffenseMultiplier: move ? statusedAttackBoost(status, move.category, attacker.ability ? getAbility(attacker.ability)?.physicalAttackMultiplierWhenStatused : undefined) : 1,
    finalOffenseMultiplier: move ? burnDamageMultiplier(status, move.category, ignoresBurnAttackPenalty(attacker.ability ?? undefined, move.id)) : 1,
  };
}
