import { abilityOf, type BattleFighterState, type BattleState } from "./state";
import { effectiveHeldItem } from "./turnOrderInputs";

/**
 * 트랙 M4: 이 포켓몬이 지금 "땅에 있는지"(본가 접지 판정). 땅 기술 면역·설치물·필드 효과(위력 보정·회복·상태이상 면역·
 * 우선도 차단)가 모두 이 판정을 쓴다.
 *  - 땅에 붙잡힘: 중력 중 · 떨어뜨리기에 맞음 · 검은철구
 *  - 공중: 비행 타입 · 부유(땅 면역 특성) · 풍선 · 전자부유
 */
export function isGrounded(state: BattleState, fighter: BattleFighterState): boolean {
  const item = effectiveHeldItem(fighter, state);
  if (state.gravityTurnsRemaining !== undefined || fighter.smackedDown || item?.groundsHolder) return true;
  if (fighter.types.includes("비행")) return false;
  if (abilityOf(fighter)?.grantsImmunityToTypes?.includes("땅")) return false;
  if (item?.grantsGroundImmunity) return false;
  if ((fighter.magnetRiseTurnsRemaining ?? 0) > 0) return false;
  return true;
}
