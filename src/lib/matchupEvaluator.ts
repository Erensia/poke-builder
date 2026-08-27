import type { AbilityPoints } from "../types/party";
import type { PokemonGender } from "../types/pokemon";
import type { Move } from "../types/move";
import type { WeatherKind } from "../types/weather";
import { getPokemon, getAbility, getItem } from "./data";
import { getBerryDefenseResult, getItemOffenseMultiplier } from "./itemEffects";
import { getEffectiveForm, getEffectiveAbilityId, type FormSource } from "./pokemonForm";
import { computeRealStats } from "./statCalculator";
import { applyMoveStatChanges } from "./statStages";
import { resolveMoveContext } from "./moveContext";
import { resolveEffectiveDefenderAbility } from "./abilityModifiers";
import { NEUTRAL_STAGES, type StatStages } from "../types/battleStats";
import {
  computeOffensePower,
  computeBulkPower,
  evaluateMatchup,
  type MatchupVerdict,
} from "./battlePower";

export interface SlotMatchupOptions {
  /** 이번 턴 전까지 누적된 공격측 랭크 상태. 기본은 전부 0랭크 */
  attackerStages?: StatStages;
  /** 이번 턴 전까지 누적된 방어측 랭크 상태. 기본은 전부 0랭크 */
  defenderStages?: StatStages;
  /** 이 기술 자체가 이번 턴에 주는 랭크 변화까지 반영할지 (기본 true) */
  applyMoveOwnStatChanges?: boolean;
  /**
   * 트리플악셀처럼 다단히트 기술일 때 몇 타까지 맞은 걸로 계산할지 (1부터 시작).
   * move.multiHitPowers가 있을 때만 의미가 있고, 해당 타수까지의 위력을 합산해서 쓴다.
   */
  multiHitCount?: number;
  /** 현재 날씨. 모래의힘처럼 날씨 조건부 특성 판정에 쓴다 */
  weather?: WeatherKind;
  /**
   * 직접 지정하면 특성에서 자동으로 구한 배율 대신 이 값을 그대로 쓴다.
   * (특성이 아직 구조화 안 됐거나, 임의로 배율을 실험해보고 싶을 때)
   */
  abilityMultiplier?: number;
  itemMultiplier?: number;
  weatherMultiplier?: number;
  bulkMultiplier?: number;
}

/** evaluateSlotMatchup이 실제로 필요로 하는 최소 형태. PartySlot과 MatchupSlot 둘 다 만족한다 */
export interface EvaluatorSlot extends FormSource {
  pokemonId: string;
  ability: string | null;
  nature: string | null;
  points: AbilityPoints;
  /**
   * 헤롱헤롱류 판정에만 쓰는 성별(getEffectiveGender). 매치업 페이지(evaluateSlotMatchup)는
   * 1턴 스냅샷이라 이 필드를 아예 참조하지 않고, createFighterState(배틀 시뮬레이터)만 읽는다 —
   * 그래도 이 인터페이스에 선언해둬야 구조적 타이핑상 slot.gender에 접근할 수 있다.
   */
  gender?: PokemonGender;
}

export interface SlotMatchupResult {
  /** 상대 타입 상성까지 반영된 최종 결정력. 판정(verdict)은 이 값 기준 */
  offensePower: number;
  /** 상대 타입 상성을 곱하기 전의 결정력 (자속/랭크/특성/도구/날씨는 반영됨) */
  rawOffensePower: number;
  bulkPower: number;
  verdict: MatchupVerdict;
}

/**
 * 파티 슬롯 두 개(공격측/방어측)와 기술 하나로 결정력·내구력·판정을 한번에 계산한다.
 * 실수치 계산, 메가폼, 타입 상성, 랭크 상태, 특성 배율(테크니션/적응력/모래의힘/두꺼운지방/
 * 메가런처/페어리스킨)까지 전부 엮는 조립 함수.
 * status 기술이거나 포켓몬을 찾을 수 없으면 null.
 */
export function evaluateSlotMatchup(
  attackerSlot: EvaluatorSlot,
  move: Move,
  defenderSlot: EvaluatorSlot,
  options: SlotMatchupOptions = {},
): SlotMatchupResult | null {
  const attackerPokemon = getPokemon(attackerSlot.pokemonId);
  const defenderPokemon = getPokemon(defenderSlot.pokemonId);
  if (!attackerPokemon || !defenderPokemon) return null;
  if (move.power === null || move.category === "status" || move.category === null) return null;

  const {
    attackerStages: baseAttackerStages = NEUTRAL_STAGES,
    defenderStages: baseDefenderStages = NEUTRAL_STAGES,
    applyMoveOwnStatChanges = true,
    weather,
    abilityMultiplier: manualAbilityMultiplier,
    itemMultiplier,
    weatherMultiplier,
    bulkMultiplier: manualBulkMultiplier,
    multiHitCount,
  } = options;

  const attackerForm = getEffectiveForm(attackerPokemon, attackerSlot);
  const defenderForm = getEffectiveForm(defenderPokemon, defenderSlot);
  const attackerEffectiveAbilityId = getEffectiveAbilityId(attackerForm, attackerSlot.ability);
  const defenderEffectiveAbilityId = getEffectiveAbilityId(defenderForm, defenderSlot.ability);
  const attackerAbility = attackerEffectiveAbilityId ? getAbility(attackerEffectiveAbilityId) : undefined;
  const rawDefenderAbility = defenderEffectiveAbilityId ? getAbility(defenderEffectiveAbilityId) : undefined;
  // 틀깨기: 매치업 페이지(1턴 스냅샷)도 배틀 시뮬레이터와 동일하게 반영한다.
  const defenderAbility = resolveEffectiveDefenderAbility(attackerAbility, rawDefenderAbility);

  const attackerRealStats = computeRealStats(
    attackerForm.baseStats,
    attackerSlot.points,
    attackerSlot.nature,
  );
  const defenderRealStats = computeRealStats(
    defenderForm.baseStats,
    defenderSlot.points,
    defenderSlot.nature,
  );

  // 이 기술 자체가 주는 랭크 변화(예: 칼춤을 쓴 다음 그 위력으로 계산하고 싶을 때)까지 반영
  const attackerStages = applyMoveOwnStatChanges
    ? applyMoveStatChanges(baseAttackerStages, move, "self", { userTypes: attackerForm.types })
    : baseAttackerStages;
  const defenderStages = applyMoveOwnStatChanges
    ? applyMoveStatChanges(baseDefenderStages, move, "opponent", { userTypes: attackerForm.types })
    : baseDefenderStages;

  // 지닌 도구: 직접 지정한 배율이 없으면 실제 장착한 도구에서 자동으로 구한다. defenderItem은
  // resolveMoveContext의 검은철구(땅타입 면역 무시) 판정에도 필요해서 여기서 먼저 구해둔다.
  const attackerItem = attackerSlot.item ? getItem(attackerSlot.item) : undefined;
  const defenderItem = defenderSlot.item ? getItem(defenderSlot.item) : undefined;

  // 특성 배율(공격측 테크니션/모래의힘/메가런처/페어리스킨, 방어측 두꺼운지방 등) + 타입 변경 +
  // 자속 + 상대 타입 상성을 한 번에 계산 — battleSimulator의 resolveAction과 공유하는 로직
  const {
    effectiveMove,
    abilityOffenseMultiplier,
    abilityDefenseMultiplier: abilityDefense,
    stabMultiplier,
    typeEffectiveness,
  } = resolveMoveContext(attackerAbility, move, defenderForm.types, defenderAbility, weather, defenderItem);

  // 트리플악셀처럼 다단히트 기술이면, 특성/타입 조건 판정은 원래 기술(1타 위력) 기준으로 이미
  // 끝났으니 여기서만 선택한 타수까지의 위력을 합산해서 결정력 계산에 쓸 위력으로 바꿔치기한다.
  const effectiveMoveWithHits =
    move.multiHitPowers && multiHitCount
      ? {
          ...effectiveMove,
          power: move.multiHitPowers.slice(0, multiHitCount).reduce((sum, p) => sum + p, 0),
        }
      : effectiveMove;

  // 메트로놈(연속 사용 보너스)은 매치업 화면이 여러 턴 이력이 없는 1턴 스냅샷이라 스트릭=1(보너스 없음)로 고정.
  const autoItemMultiplier = getItemOffenseMultiplier(attackerItem, effectiveMove, typeEffectiveness, 1);
  const berryResult = getBerryDefenseResult(defenderItem, effectiveMove.type, typeEffectiveness, false);

  // 상대 타입 상성을 곱하기 전의 결정력. offensePower는 여기에 typeEffectiveness만 곱한 값이라
  // 매번 다시 계산하는 대신 이 값에 typeEffectiveness를 곱해서 구한다.
  const rawOffensePower = computeOffensePower(attackerRealStats, attackerForm.types, effectiveMoveWithHits, {
    abilityMultiplier: manualAbilityMultiplier ?? abilityOffenseMultiplier,
    itemMultiplier: itemMultiplier ?? autoItemMultiplier,
    weatherMultiplier,
    attackerStages,
    stabMultiplier,
  });
  if (rawOffensePower === null) return null;
  const offensePower = rawOffensePower * typeEffectiveness;

  const bulkPower = computeBulkPower(defenderRealStats, move.category, {
    defenderStages,
    bulkMultiplier: manualBulkMultiplier ?? abilityDefense * berryResult.bulkMultiplier,
  });

  return {
    offensePower,
    rawOffensePower,
    bulkPower,
    verdict: evaluateMatchup(offensePower, bulkPower),
  };
}
