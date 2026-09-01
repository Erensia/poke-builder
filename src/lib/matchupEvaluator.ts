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
import { getWeatherDamageMultiplier, applyWeatherBall } from "./weatherEffects";
import { applyFieldPulse, getFieldPowerMultiplier, getFieldDamageMultiplier } from "./fieldEffects";
import { resolveMoveContext } from "./moveContext";
import { resolveEffectiveDefenderAbility } from "./abilityModifiers";
import { NEUTRAL_STAGES, type StatStages } from "../types/battleStats";
import {
  computeOffensePower,
  computeBulkPower,
  computeEffectiveSpeed,
  evaluateMatchupChance,
  rankStageMultiplier,
  reversalPowerFromHp,
  gyroBallPowerFromSpeeds,
  positiveStagesPowerValue,
  weightRatioPowerValue,
  absoluteWeightPowerValue,
  WEIGHT_MOVE_FALLBACK_POWER,
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
   * 토해내기(spitUpPower)일 때 가정할 비축 스택 수(1~3). 생략하면 3(최대)으로 상정한다.
   * 위력 = 스택 × 100.
   */
  stockpileCount?: number;
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
  /**
   * 방어측에 걸린 스크린 가정(Phase 6.5 §5). 해당 카테고리 데미지가 절반이 된다 —
   * reflect=물리, lightScreen=특수, auroraVeil=둘 다. battleSimulator의 screenMultiplier를 미러하고,
   * 공격측이 틈새포착(bypassesScreensAndSubstitute)이면 무시된다.
   */
  screen?: "reflect" | "lightScreen" | "auroraVeil";
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
  /** 판정 타수로 격파할 확률(0~1). 확정 1·2타면 1, "3타 이상 필요"면 null (Phase 7.5 §2) */
  koChance: number | null;
  /** 난수 1타일 때만: [격파 난수 수, 16] */
  killingRolls?: readonly [number, number];
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
  if (move.category === "status" || move.category === null) return null;
  // move.power === null(자이로볼·바둥바둥·토해내기 등)은 여기서 바로 거르지 않는다 — 아래에서
  // 가변 위력을 확정해보고, 그래도 null이면 computeOffensePower가 null을 반환해 걸러진다.

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
    screen,
    multiHitCount,
    stockpileCount,
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

  // 가변 위력 기술(§3 증분 B-2·B-3·B-3몸무게): computeOffensePower 전에 위력을 먼저 확정한다.
  //  - reversalPower(기사회생·바둥바둥): 매치업은 HP 개념이 없어 풀피(=최소 위력 20) 가정
  //  - gyroBallPower(자이로볼): 양측 실효 스피드(실능 × 스피드 랭크 × 도구 배율)로 산출. 마비는
  //    매치업에 상태 개념이 없어 미반영(evaluateSpeedMatchup의 가정 토글과 동일 정책).
  //  - powerFromPositiveStages(기어오르기·어시스트파워): 넘겨받은 attackerStages 기준
  //  - spitUpPower(토해내기): options.stockpileCount(생략 시 3) × 100
  //  - weightRatioPower / targetAbsoluteWeightPower: pokemon.weightKg 기반, 미입력이면 폴백 위력
  let variablePowerMove: Move = move;
  // 레이징불: 사용자 종(팔데아 켄타로스 3품종)에 따라 실제 타입이 바뀐다 — 위력 확정·상성 계산 전에 먼저.
  const speciesTypedType = move.typeByUserSpecies?.[attackerSlot.pokemonId];
  if (speciesTypedType) variablePowerMove = { ...variablePowerMove, type: speciesTypedType };
  if (move.reversalPower) {
    variablePowerMove = { ...variablePowerMove, power: reversalPowerFromHp(1, 1) };
  } else if (move.gyroBallPower) {
    const effSpeed = (
      spe: number,
      stages: StatStages,
      item: Parameters<typeof getItemSpeedMultiplier>[0],
    ) => spe * rankStageMultiplier(stages.spe) * getItemSpeedMultiplier(item);
    variablePowerMove = {
      ...variablePowerMove,
      power: gyroBallPowerFromSpeeds(
        effSpeed(attackerRealStats.spe, attackerStages, attackerItem),
        effSpeed(defenderRealStats.spe, defenderStages, defenderItem),
      ),
    };
  } else if (move.powerFromPositiveStages) {
    const { base, perStage } = move.powerFromPositiveStages;
    variablePowerMove = { ...variablePowerMove, power: positiveStagesPowerValue(attackerStages, base, perStage) };
  } else if (move.spitUpPower) {
    const stacks = Math.max(0, Math.min(3, stockpileCount ?? 3));
    variablePowerMove = { ...variablePowerMove, power: stacks * 100 };
  } else if (move.weightRatioPower) {
    // 메가폼이면 그 폼의 몸무게(attackerForm.weightKg)를 쓴다.
    variablePowerMove = {
      ...variablePowerMove,
      power:
        attackerForm.weightKg !== undefined && defenderForm.weightKg !== undefined
          ? weightRatioPowerValue(attackerForm.weightKg, defenderForm.weightKg)
          : WEIGHT_MOVE_FALLBACK_POWER,
    };
  } else if (move.targetAbsoluteWeightPower) {
    variablePowerMove = {
      ...variablePowerMove,
      power:
        defenderForm.weightKg !== undefined
          ? absoluteWeightPowerValue(defenderForm.weightKg)
          : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  // 조건부 ×2(conditionalDoublePower). 매치업 페이지 정책(§3 증분 C·B-3, 사용자 지시):
  //  - user-has-no-item(애크러뱃): 지닌 도구를 알고 있으니 실제로 판정
  //  - user-stat-lowered-this-turn(분풀이)·user-move-failed-last-turn(분함의발구르기): 조건 충족을 상정(항상 ×2)
  //  - took-damage-this-turn(눈사태)·moves-after-target(보복): 배틀 문맥 필요 → 매치업에선 기본 위력
  if (variablePowerMove.power !== null) {
    const cond = variablePowerMove.conditionalDoublePower;
    const assumeDoubled =
      cond === "user-stat-lowered-this-turn" ||
      cond === "user-move-failed-last-turn" ||
      (cond === "user-has-no-item" && !attackerItem);
    if (assumeDoubled) {
      variablePowerMove = { ...variablePowerMove, power: variablePowerMove.power * 2 };
    }
  }

  // 웨더볼(날씨판 대지의파동): 타입·위력 변경을 fieldPulse보다 먼저.
  // 이 아래 fieldPulse/powerMultiplierInField(대지의파동·미스트버스트류)까지가 "특성 배율 계산 전
  // 타입/위력 확정" 구간 — 타입이 바뀐 상태여야 resolveMoveContext의 상성 계산에 반영된다.
  const weatherBall = applyWeatherBall(variablePowerMove, weather);
  const weatherBallMove: Move = { ...variablePowerMove, type: weatherBall.type, power: weatherBall.power };

  const fieldPulse = applyFieldPulse(weatherBallMove, field);
  const fieldPowerMultiplier = getFieldPowerMultiplier(weatherBallMove, field);
  const fieldAdjustedMove: Move = {
    ...weatherBallMove,
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
    // 속임수(usesTargetAttackStat): 방어자의 공격 실능·랭크로 결정력을 낸다
    defenderRealStats,
    defenderStages,
  });
  if (rawOffensePower === null) return null;
  const offensePower = rawOffensePower * typeEffectiveness;

  // 스크린(리플렉터/빛의장막/오로라베일): 해당 카테고리 데미지 절반 = 내구력 2배.
  // battleSimulator resolveAction의 screenMultiplier와 동일 — 틈새포착이면 무시.
  const screenBypassed = !!attackerAbility?.bypassesScreensAndSubstitute;
  const screenMultiplier =
    screenBypassed || !screen
      ? 1
      : screen === "auroraVeil" ||
          (screen === "reflect" && move.category === "physical") ||
          (screen === "lightScreen" && move.category === "special")
        ? 2
        : 1;

  const bulkPower = computeBulkPower(defenderRealStats, move.category, {
    defenderStages,
    bulkMultiplier:
      (manualBulkMultiplier ?? abilityDefense * berryResult.bulkMultiplier) * screenMultiplier,
    // 사이코쇼크(hitsDefensiveStat): 특수기지만 내구력은 방어자의 물리 방어로 낸다
    defensiveStatOverride: move.hitsDefensiveStat,
  });

  const chance = evaluateMatchupChance(offensePower, bulkPower);
  return {
    offensePower,
    rawOffensePower,
    bulkPower,
    verdict: chance.verdict,
    koChance: chance.koChance,
    killingRolls: chance.killingRolls,
  };
}

export interface SpeedMatchupResult {
  /** 스피드 랭크까지 반영한 실효 스피드 (반올림 전) */
  attackerSpeed: number;
  defenderSpeed: number;
  /** 우선도가 같다는 전제에서 어느 쪽이 먼저 움직이는지. 완전 동속이면 "tie" */
  firstMover: "attacker" | "defender" | "tie";
  /** 트릭룸 가정이 켜져 순서가 뒤집힌 상태로 판정했으면 true (UI 표기용) */
  trickRoom: boolean;
}

export interface SpeedMatchupOptions {
  weather?: WeatherKind;
  /** 곡예(Unburden) 발동 후라고 가정 — 해당 측 스피드 2배 */
  attackerUnburden?: boolean;
  defenderUnburden?: boolean;
  /** 마비 상태라고 가정 — 해당 측 스피드 0.5배(battleSimulator의 computeStatusSpeedMultiplier 미러) */
  attackerParalyzed?: boolean;
  defenderParalyzed?: boolean;
  /** 트릭룸이 걸려 있다고 가정 — 우선도가 같을 때 느린 쪽이 먼저 움직인다(동속은 그대로 랜덤) */
  trickRoom?: boolean;
  /** 누적된 랭크 상태. 기본은 전부 0랭크 */
  attackerStages?: StatStages;
  defenderStages?: StatStages;
}

/**
 * 양쪽 슬롯의 실효 스피드를 비교해 어느 쪽이 먼저 움직이는지 판정한다(Phase 6.5 §2).
 * battleSimulator의 runTurn 스피드 공식(realStats.spe × 도구배율 × 날씨특성배율 × 마비 0.5배 ×
 * 곡예 2배, 그 뒤 스피드 랭크 반영)을 그대로 미러한다. 마비·트릭룸은 매치업 페이지에 상태 개념이
 * 없어 "가정 토글"(options.attackerParalyzed 등)로만 들어온다. 선제공격손톱은 랜덤이라 반영하지 않는다.
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
    attackerParalyzed,
    defenderParalyzed,
    trickRoom = false,
    attackerStages = NEUTRAL_STAGES,
    defenderStages = NEUTRAL_STAGES,
  } = options;

  const speedOf = (
    slot: EvaluatorSlot,
    pokemon: NonNullable<ReturnType<typeof getPokemon>>,
    stages: StatStages,
    unburden: boolean,
    paralyzed: boolean,
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
      (paralyzed ? 0.5 : 1) *
      (unburden ? 2 : 1);
    return computeEffectiveSpeed(base, stages);
  };

  const attackerSpeed = speedOf(attackerSlot, attackerPokemon, attackerStages, !!attackerUnburden, !!attackerParalyzed);
  const defenderSpeed = speedOf(defenderSlot, defenderPokemon, defenderStages, !!defenderUnburden, !!defenderParalyzed);

  let firstMover: SpeedMatchupResult["firstMover"];
  if (attackerSpeed === defenderSpeed) {
    firstMover = "tie";
  } else {
    const attackerFaster = attackerSpeed > defenderSpeed;
    // 트릭룸이면 비교 방향만 뒤집힌다(turnOrder.compareTurnOrder와 동일).
    firstMover = (trickRoom ? !attackerFaster : attackerFaster) ? "attacker" : "defender";
  }

  return { attackerSpeed, defenderSpeed, firstMover, trickRoom };
}
