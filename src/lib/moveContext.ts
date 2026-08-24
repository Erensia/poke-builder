import type { Ability } from "../types/ability";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { WeatherKind } from "../types/weather";
import { resolveAbilityOffense, resolveAbilityDefense, resolveStabMultiplier } from "./abilityModifiers";
import { getEffectiveness } from "./typeEffectiveness";

/**
 * 기술 하나가 공격측→방어측으로 나갈 때 항상 필요한 배율/실효 기술을 한 번에 계산한다.
 * evaluateSlotMatchup(1턴 스냅샷 판정)과 battleSimulator의 resolveAction(다중 턴 엔진)이
 * 둘 다 "특성 배율 + 타입 변경 + 자속 + 상대 타입 상성"을 똑같이 구해야 해서, 이 계산을
 * 한 곳으로 모아 양쪽이 재사용하게 만들었다 — Phase 1.5 문서에 적어뒀던 "evaluateSlotMatchup을
 * 재사용 가능하게 설계"를 실제로 지키는 지점.
 */
export interface MoveContext {
  /** 특성으로 타입이 바뀌었으면(페어리스킨 등) 그 타입이 반영된 기술. 안 바뀌었으면 원본과 동일 */
  effectiveMove: Move;
  /** 공격측 특성이 이 기술에 주는 배율 (테크니션/모래의힘/메가런처 등) */
  abilityOffenseMultiplier: number;
  /** 방어측 특성이 이 기술을 받을 때 주는 배율 (두꺼운지방 등) */
  abilityDefenseMultiplier: number;
  /** 자속보정 배율. 기본 1.5, 적응력이면 2.0 */
  stabMultiplier: number;
  /** 상대 타입 상성 배율 (0/0.25/0.5/1/2/4). 기술에 타입이 없으면(필드기 등) 1 */
  typeEffectiveness: number;
}

export function resolveMoveContext(
  attackerAbility: Ability | undefined,
  move: Move,
  defenderTypes: PokemonType[],
  defenderAbility: Ability | undefined,
  weather?: WeatherKind,
): MoveContext {
  const abilityOffense = resolveAbilityOffense(attackerAbility, move, weather);
  const effectiveMove = abilityOffense.overrideMoveType ? { ...move, type: abilityOffense.overrideMoveType } : move;
  const abilityDefenseMultiplier = resolveAbilityDefense(defenderAbility, effectiveMove);
  const stabMultiplier = resolveStabMultiplier(attackerAbility);

  // 배짱처럼 특정 타입의 면역만 무시하는 특성. 방어측이 2타입이면 면역을 준 타입 쪽 배율만
  // 1로 무시되고, 다른 타입의 반감/약점 배율은 그대로 곱해진다(getEffectiveness에 위임 —
  // 예: 고스트/독에게 격투 → 0.5배, 고스트/악에게 격투 → 2배. 전체를 1배로 뭉개면 안 됨).
  const bypassImmunity = !!(effectiveMove.type && attackerAbility?.bypassesImmunityForTypes?.includes(effectiveMove.type));
  const typeEffectiveness = effectiveMove.type
    ? getEffectiveness(effectiveMove.type, defenderTypes, { bypassImmunity })
    : 1;

  return {
    effectiveMove,
    abilityOffenseMultiplier: abilityOffense.multiplier,
    abilityDefenseMultiplier,
    stabMultiplier,
    typeEffectiveness,
  };
}
