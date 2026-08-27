import type { AbilityPoints } from "../types/party";
import type { PokemonGender } from "../types/pokemon";
import type { Move } from "../types/move";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { getPokemon, getAbility, getItem } from "./data";
import { getBerryDefenseResult, getItemOffenseMultiplier, getItemSpeedMultiplier } from "./itemEffects";
import { getEffectiveForm, getEffectiveAbilityId, type FormSource } from "./pokemonForm";
import { computeRealStats } from "./statCalculator";
import { applyMoveStatChanges } from "./statStages";
import { getWeatherDamageMultiplier } from "./weatherEffects";
import { applyFieldPulse, getFieldPowerMultiplier, getFieldDamageMultiplier } from "./fieldEffects";
import { resolveMoveContext } from "./moveContext";
import { resolveEffectiveDefenderAbility } from "./abilityModifiers";
import { NEUTRAL_STAGES, type StatStages } from "../types/battleStats";
import {
  computeOffensePower,
  computeBulkPower,
  computeEffectiveSpeed,
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
  /**
   * 현재 날씨. 모래의힘처럼 날씨 조건부 특성 판정에 쓰고, 날씨 데미지 배율(비=물 1.5배,
   * 쾌청=불꽃 1.5배·물 0.5배 등)도 자동으로 반영한다.
   */
  weather?: WeatherKind;
  /**
   * 현재 필드. 그래스/사이코/일렉트릭필드의 해당 타입 1.3배, 미스트필드의 드래곤 0.5배,
   * 대지의파동(필드 타입/위력 변경)·미스트버스트류(필드 위력 배가)까지 반영한다.
   */
  field?: FieldKind;
  /**
   * 직접 지정하면 특성에서 자동으로 구한 배율 대신 이 값을 그대로 쓴다.
   * (특성이 아직 구조화 안 됐거나, 임의로 배율을 실험해보고 싶을 때)
   */
  abilityMultiplier?: number;
  itemMultiplier?: number;
  weatherMultiplier?: number;
  fieldMultiplier?: number;
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
    field,
    abilityMultiplier: manualAbilityMultiplier,
    itemMultiplier,
    weatherMultiplier: manualWeatherMultiplier,
    fieldMultiplier: manualFieldMultiplier,
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

  // 필드 조건부 타입/위력 변경(대지의파동=fieldPulse, 미스트버스트·와이드포스·라이징볼트=
  // powerMultiplierInField)을 특성 배율 계산보다 먼저 반영한다 — 타입이 바뀐 상태여야 아래
  // resolveMoveContext의 상성 계산에도 바뀐 타입이 들어간다(battleSimulator와 같은 순서).
  const fieldPulse = applyFieldPulse(move, field);
  const fieldPowerMultiplier = getFieldPowerMultiplier(move, field);
  const fieldAdjustedMove: Move = {
    ...move,
    type: fieldPulse.type,
    power: fieldPulse.power === null ? null : Math.round(fieldPulse.power * fieldPowerMultiplier),
  };

  // 특성 배율(공격측 테크니션/모래의힘/메가런처/페어리스킨, 방어측 두꺼운지방 등) + 타입 변경 +
  // 자속 + 상대 타입 상성을 한 번에 계산 — battleSimulator의 resolveAction과 공유하는 로직
  const {
    effectiveMove,
    abilityOffenseMultiplier,
    abilityDefenseMultiplier: abilityDefense,
    stabMultiplier,
    typeEffectiveness,
  } = resolveMoveContext(
    attackerAbility,
    fieldAdjustedMove,
    defenderForm.types,
    defenderAbility,
    weather,
    defenderItem,
  );

  // 다단히트 기술이면, 특성/타입 조건 판정은 원래 기술(1타 위력) 기준으로 이미 끝났으니 여기서만
  // 선택한 타수까지의 위력을 합산해서 결정력 계산에 쓸 위력으로 바꿔치기한다.
  //  - 트리플악셀류(multiHitPowers): 타수별 위력이 다르므로 배열을 잘라 합산.
  //  - 록블라스트/스케일샷류(minHits~maxHits, multiHitPowers 없음): 매 타 위력이 동일하므로 위력 × 타수.
  const effectiveMoveWithHits = (() => {
    if (move.multiHitPowers && multiHitCount) {
      return {
        ...effectiveMove,
        power: move.multiHitPowers.slice(0, multiHitCount).reduce((sum, p) => sum + p, 0),
      };
    }
    if (
      move.minHits !== undefined &&
      move.maxHits !== undefined &&
      multiHitCount &&
      effectiveMove.power !== null
    ) {
      const clampedHits = Math.max(move.minHits, Math.min(move.maxHits, multiHitCount));
      return { ...effectiveMove, power: effectiveMove.power * clampedHits };
    }
    return effectiveMove;
  })();

  // 부자유친: 단일타 데미지 기술이 데미지를 준 직후 위력 × mult 짜리 추가타가 한 번 더 나간다
  // (battleSimulator와 동일 조건 — 다단히트·고정데미지는 제외). 매치업은 1턴 스냅샷이라 "추가타까지
  // 다 맞은" 상황으로 보고 결정력 위력에 합산한다. 추가타 위력은 엔진과 똑같이 round(위력 × mult).
  const followUpMultiplier = attackerAbility?.followUpHitPowerMultiplier;
  const effectiveMoveFinal =
    followUpMultiplier !== undefined &&
    !move.multiHitPowers &&
    move.minHits === undefined &&
    move.fixedDamage === undefined &&
    effectiveMoveWithHits.power !== null
      ? {
          ...effectiveMoveWithHits,
          power:
            effectiveMoveWithHits.power +
            Math.round(effectiveMoveWithHits.power * followUpMultiplier),
        }
      : effectiveMoveWithHits;

  // 메트로놈(연속 사용 보너스)은 매치업 화면이 여러 턴 이력이 없는 1턴 스냅샷이라 스트릭=1(보너스 없음)로 고정.
  const autoItemMultiplier = getItemOffenseMultiplier(attackerItem, effectiveMove, typeEffectiveness, 1);
  const berryResult = getBerryDefenseResult(defenderItem, effectiveMove.type, typeEffectiveness, false);

  // 날씨/필드 데미지 배율은 (타입 변경까지 끝난) effectiveMove.type 기준으로 구한다 — battleSimulator와 동일.
  const autoWeatherDamageMultiplier = getWeatherDamageMultiplier(weather, effectiveMove.type);
  const autoFieldDamageMultiplier = getFieldDamageMultiplier(field, effectiveMove.type);

  // 상대 타입 상성을 곱하기 전의 결정력. offensePower는 여기에 typeEffectiveness만 곱한 값이라
  // 매번 다시 계산하는 대신 이 값에 typeEffectiveness를 곱해서 구한다.
  const rawOffensePower = computeOffensePower(attackerRealStats, attackerForm.types, effectiveMoveFinal, {
    abilityMultiplier: manualAbilityMultiplier ?? abilityOffenseMultiplier,
    itemMultiplier: itemMultiplier ?? autoItemMultiplier,
    weatherMultiplier: manualWeatherMultiplier ?? autoWeatherDamageMultiplier,
    fieldMultiplier: manualFieldMultiplier ?? autoFieldDamageMultiplier,
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

export interface SpeedMatchupResult {
  /** 스피드 랭크까지 반영한 실효 스피드 (반올림 전) */
  attackerSpeed: number;
  defenderSpeed: number;
  /** 우선도가 같다는 전제에서 어느 쪽이 먼저 움직이는지. 완전 동속이면 "tie" */
  firstMover: "attacker" | "defender" | "tie";
}

export interface SpeedMatchupOptions {
  weather?: WeatherKind;
  /** 곡예(Unburden) 발동 후라고 가정 — 해당 측 스피드 2배 */
  attackerUnburden?: boolean;
  defenderUnburden?: boolean;
  /** 누적된 랭크 상태. 기본은 전부 0랭크 */
  attackerStages?: StatStages;
  defenderStages?: StatStages;
}

/**
 * 양쪽 슬롯의 실효 스피드를 비교해 어느 쪽이 먼저 움직이는지 판정한다(Phase 6.5 §2).
 * battleSimulator의 runTurn 스피드 공식(realStats.spe × 도구배율 × 날씨특성배율 × 곡예 2배,
 * 그 뒤 스피드 랭크 반영)을 그대로 미러한다. 매치업 페이지엔 상태이상/트릭룸/필드 개념이
 * 없어 마비 0.5배·트릭룸 역전·선제공격손톱은 반영하지 않는다.
 * 포켓몬을 찾을 수 없으면 null.
 */
export function evaluateSpeedMatchup(
  attackerSlot: EvaluatorSlot,
  defenderSlot: EvaluatorSlot,
  options: SpeedMatchupOptions = {},
): SpeedMatchupResult | null {
  const attackerPokemon = getPokemon(attackerSlot.pokemonId);
  const defenderPokemon = getPokemon(defenderSlot.pokemonId);
  if (!attackerPokemon || !defenderPokemon) return null;

  const {
    weather,
    attackerUnburden,
    defenderUnburden,
    attackerStages = NEUTRAL_STAGES,
    defenderStages = NEUTRAL_STAGES,
  } = options;

  const speedOf = (
    slot: EvaluatorSlot,
    pokemon: NonNullable<ReturnType<typeof getPokemon>>,
    stages: StatStages,
    unburden: boolean,
  ): number => {
    const form = getEffectiveForm(pokemon, slot);
    const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);
    const item = slot.item ? getItem(slot.item) : undefined;
    const effectiveAbilityId = getEffectiveAbilityId(form, slot.ability);
    const ability = effectiveAbilityId ? getAbility(effectiveAbilityId) : undefined;
    const weatherBoost = ability?.weatherSpeedMultiplier;
    const weatherSpeedMultiplier = weatherBoost && weatherBoost.weather === weather ? weatherBoost.multiplier : 1;
    const base =
      realStats.spe *
      getItemSpeedMultiplier(item) *
      weatherSpeedMultiplier *
      (unburden ? 2 : 1);
    return computeEffectiveSpeed(base, stages);
  };

  const attackerSpeed = speedOf(attackerSlot, attackerPokemon, attackerStages, !!attackerUnburden);
  const defenderSpeed = speedOf(defenderSlot, defenderPokemon, defenderStages, !!defenderUnburden);

  return {
    attackerSpeed,
    defenderSpeed,
    firstMover:
      attackerSpeed === defenderSpeed ? "tie" : attackerSpeed > defenderSpeed ? "attacker" : "defender",
  };
}
