import type { Ability, AbilityModifierCondition } from "../types/ability";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { WeatherKind } from "../types/weather";

function conditionMatches(
  condition: AbilityModifierCondition | undefined,
  move: Move,
  weather?: WeatherKind,
  attackerHpFraction = 1,
  defenderHpIsFull = true,
  defenderHasStatusCondition = false,
): boolean {
  if (!condition) return true;
  if (condition.movePowerAtMost !== undefined) {
    if (move.power === null || move.power > condition.movePowerAtMost) return false;
  }
  if (condition.moveTypeIn !== undefined) {
    if (!move.type || !condition.moveTypeIn.includes(move.type)) return false;
  }
  if (condition.moveClassificationIn !== undefined) {
    const tags = move.classification ?? [];
    if (!condition.moveClassificationIn.some((t) => tags.includes(t))) return false;
  }
  if (condition.moveCategoryIn !== undefined) {
    if (!move.category || !condition.moveCategoryIn.includes(move.category)) return false;
  }
  if (condition.weatherIs !== undefined) {
    if (weather !== condition.weatherIs) return false;
  }
  if (condition.makesContact !== undefined) {
    if ((move.makesContact ?? false) !== condition.makesContact) return false;
  }
  if (condition.attackerHpAtMostFraction !== undefined) {
    if (attackerHpFraction > condition.attackerHpAtMostFraction) return false;
  }
  if (condition.defenderHpIsFull !== undefined) {
    if (condition.defenderHpIsFull !== defenderHpIsFull) return false;
  }
  if (condition.defenderHasStatusCondition !== undefined) {
    if (condition.defenderHasStatusCondition !== defenderHasStatusCondition) return false;
  }
  return true;
}

export interface AbilityOffenseResult {
  multiplier: number;
  /** 조건에 걸린 조정으로 기술의 유효 타입이 바뀌면 채워짐 (페어리스킨) */
  overrideMoveType?: PokemonType;
}

/**
 * 공격측 특성이 이 기술에 주는 배율과 타입 변경(있다면)을 계산한다.
 * attackerHpFraction(현재HP/최대HP)은 맹화·급류·심록·벌레의알림처럼 HP 1/3 이하 조건이 있는
 * 특성에만 쓰인다 — 안 넘기면 1(풀피)로 간주해서 그 조건은 항상 실패한다.
 */
export function resolveAbilityOffense(
  ability: Ability | undefined,
  move: Move,
  weather?: WeatherKind,
  attackerHpFraction = 1,
): AbilityOffenseResult {
  const result: AbilityOffenseResult = { multiplier: 1 };
  if (!ability?.modifiers) return result;

  for (const modifier of ability.modifiers) {
    if (modifier.scope !== "offense") continue;
    if (!conditionMatches(modifier.condition, move, weather, attackerHpFraction)) continue;
    result.multiplier *= modifier.multiplier;
    if (modifier.overrideMoveType) result.overrideMoveType = modifier.overrideMoveType;
  }
  return result;
}

/**
 * 방어측 특성이 (이 기술로 맞을 때) 주는 배율을 계산한다. 두꺼운지방처럼 내구력에 곱해서 쓴다.
 * defenderHpIsFull(멀티스케일용)은 안 넘기면 true(풀피)로 간주한다 — 매치업 페이지는 "현재 HP"
 * 개념이 없는 1턴 스냅샷이라 항상 풀피 취급, 배틀 시뮬레이터만 실제 HP를 넘겨준다.
 */
export function resolveAbilityDefense(
  ability: Ability | undefined,
  move: Move,
  defenderHpIsFull = true,
  defenderHasStatusCondition = false,
): number {
  if (!ability?.modifiers) return 1;
  let multiplier = 1;
  for (const modifier of ability.modifiers) {
    if (modifier.scope !== "defense") continue;
    if (!conditionMatches(modifier.condition, move, undefined, 1, defenderHpIsFull, defenderHasStatusCondition)) continue;
    multiplier *= modifier.multiplier;
  }
  return multiplier;
}

/** 자속보정 배율. 적응력이면 2.0, 그 외에는 표준 1.5 */
export function resolveStabMultiplier(ability: Ability | undefined): number {
  return ability?.stabOverride ?? 1.5;
}

/**
 * 짖궂은마음: 사용자가 이 특성을 가졌고 쓰려는 기술이 변화기(status)면 우선도가 이 값만큼
 * 오른다. 필드(getFieldAdjustedPriority)와 같은 "델타"만 반환하는 함수라 호출부가
 * move.priority(또는 이미 필드로 조정된 값)에 더해서 쓴다.
 */
export function getAbilityPriorityBoost(move: Move, ability: Ability | undefined): number {
  if (ability?.statusMovePriorityBoost && move.category === "status") return ability.statusMovePriorityBoost;
  return 0;
}
