import { type Move } from "@/types/move";
import { abilityOf, activeWeather, type BattleFighterState, type BattleState } from "../state";

/**
 * 이번 턴 이 기술이 사용 조건 때문에 실패하는지 — 실전 엔진 preHitEffects 섹션 0의 게이트를 결정 시점 정보로
 * 옮긴 것. 기습(상대가 이번 턴 고를 기술에 달림)만 결정 시점에 알 수 없어서 제외한다.
 * 엔진은 runTurn에서 turnNumber를 +1한 state로 기술을 처리하므로, 거대해머 잠금은 turnNumber + 1과 비교한다.
 */
export function isUsageBlocked(state: BattleState, fighter: BattleFighterState, move: Move, opponent: BattleFighterState): boolean {
  switch (move.usageCondition) {
    case "first-turn-only":
      if (fighter.hasActedSinceSwitchIn) return true;
      break;
    case "field-required":
      if (!state.field) return true;
      break;
    case "weather-required":
      if (activeWeather(state) !== move.requiresWeather) return true;
      break;
    case "sleep-only":
      if (fighter.status.condition !== "sleep") return true;
      break;
    case "all-other-moves-used": {
      const others = Object.keys(fighter.remainingPp).filter((id) => id !== move.id);
      if (!others.every((id) => fighter.usedMoveIds?.[id])) return true;
      break;
    }
  }
  if (move.spitUpPower && (fighter.stockpileCount ?? 0) === 0) return true;
  if (move.addsStockpile && (fighter.stockpileCount ?? 0) >= 3) return true;
  if (
    move.cannotUseConsecutively &&
    fighter.consecutiveLockMoveId === move.id &&
    fighter.consecutiveLockUntilTurn === state.turnNumber + 1
  ) {
    return true;
  }
  if (move.selfFaints && (abilityOf(fighter)?.preventsSelfFaintMoves || abilityOf(opponent)?.preventsSelfFaintMoves)) return true;
  return false;
}

/** 등장 첫 턴에만 쓸 수 있는 1회용 기술(속이기·만나자마자) — 대면을 끝까지 이어가는 계산에서는 반복 사용할 수 없다 */
export function isOneShotMove(move: Move): boolean {
  return move.usageCondition === "first-turn-only";
}
