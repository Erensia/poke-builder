import type { Move } from "../types/move";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { PokemonType } from "../types/pokemon-type";
import type { StanceChangeForms, PokemonGender } from "../types/pokemon";
import {
  NEUTRAL_ACCURACY_STAGES,
  NEUTRAL_CRIT_STAGE,
  NEUTRAL_STAGES,
  isBattleStatKey,
  type AccuracyEvasionStages,
  type BattleStatKey,
  type CritStage,
  type StatStages,
} from "../types/battleStats";
import {
  NO_STATUS_CONDITION,
  NO_VOLATILE_CONDITIONS,
  type StatusConditionState,
  type VolatileCondition,
  type VolatileConditionState,
} from "../types/status";
import type { Ability } from "../types/ability";
import { getPokemon, getAbility, getMove, getItem } from "./data";
import { getEffectiveForm, getEffectiveAbilityId, getEffectiveGender } from "./pokemonForm";
import { computeRealStats } from "./statCalculator";
import { applyMoveStatChanges, applyStageDelta, clampStagesToNonNegative } from "./statStages";
import { hitTriggerMatchesMove } from "./abilityHitTriggers";
import { getAbilityPriorityBoost, resolveEffectiveDefenderAbility } from "./abilityModifiers";
import {
  applyMoveAccuracyEvasionChanges,
  applyMoveCritStageChanges,
  computeHitChance,
  critChance,
} from "./accuracyCrit";
import {
  advanceStatusTurn,
  checkStatusActionBlock,
  computeStatusAttackMultiplier,
  computeStatusEndOfTurnDamage,
  computeStatusSpeedMultiplier,
  ignoresBurnAttackPenalty,
  inflictRestSleep,
  inflictStatus,
  isImmuneToStatus,
} from "./statusConditions";
import {
  ATTRACT_ACTION_BLOCK_CHANCE,
  CONFUSION_SELF_HIT_CHANCE,
  CONFUSION_SELF_HIT_POWER,
  consumeVolatileTurn,
  hasVolatile,
  inflictVolatile,
} from "./volatileConditions";
import { resolveMoveContext } from "./moveContext";
import { getEffectiveness } from "./typeEffectiveness";
import {
  computeDamage,
  rankStageMultiplier,
  reversalPowerFromHp,
  gyroBallPowerFromSpeeds,
  positiveStagesPowerValue,
  weightRatioPowerValue,
  absoluteWeightPowerValue,
  WEIGHT_MOVE_FALLBACK_POWER,
} from "./battlePower";
import { getWeatherDamageMultiplier, computeWeatherHealFraction, applyWeatherBall } from "./weatherEffects";
import {
  FIELD_DURATION,
  applyFieldPulse,
  computeFieldEndOfTurnHeal,
  getFieldAdjustedPriority,
  getFieldDamageMultiplier,
  getFieldPowerMultiplier,
  isConfusionBlockedByField,
  isOpponentTargetingMove,
  isPriorityMoveBlockedByField,
  isStatusBlockedByField,
} from "./fieldEffects";
import {
  getBerryDefenseResult,
  getItemOffenseMultiplier,
  getItemAccuracyMultiplier,
  getDrainHealMultiplier,
  getStatusCureBerryResult,
  getConfusionCureBerryResult,
  getMentalHerbCureResult,
  getHpThresholdBerryHeal,
  shouldTriggerWhiteHerb,
  getEnduranceResult,
  getExtraFlinchTriggered,
  getQuickClawTriggered,
  getItemSpeedMultiplier,
  getItemCritStageBonus,
} from "./itemEffects";
import { compareTurnOrder } from "./turnOrder";
import type { BaseStats } from "../types/stats";
import type { EvaluatorSlot } from "./matchupEvaluator";

/** 데미지 난수 하한. computeDamage의 randomRoll에 매턴 0.85~1.00 사이 값을 뽑아 넘길 때 쓴다 */
const MIN_DAMAGE_ROLL = 0.85;

/** 트릭룸 지속 턴 수. 필드(FIELD_DURATION)와 같은 5턴 */
const TRICK_ROOM_DURATION = 5;

/** 날씨 기본 지속 턴 수(뜨거운바위 등 맞는 바위를 지녔으면 +3 = 8턴) */
const WEATHER_DURATION = 5;

/** 리플렉터/빛의장막 기본 지속 턴 수(빛의점토를 지녔으면 +3 = 8턴) */
const SCREEN_DURATION = 5;

/**
 * 록블라스트류(2~5회, multiHitPowers 없는 다단히트)의 타수를 확률표대로 뽑는다.
 * 록블라스트/독침/봉인구슬 등 moves.json에 이미 적힌 확률(2/3회 각 35%, 4/5회 각 15%) 기준.
 * minHits===maxHits(더블어택 등 고정 2타)면 확률 없이 그대로 그 값을 쓴다.
 * 2~5 외의 범위는 지금 로스터에 없어서, 혹시 생기면 균등분포로 근사한다(문서에 기록).
 */
function rollMultiHitCount(minHits: number, maxHits: number, random: () => number): number {
  if (minHits === maxHits) return minHits;
  if (minHits === 2 && maxHits === 5) {
    const r = random();
    if (r < 0.35) return 2;
    if (r < 0.7) return 3;
    if (r < 0.85) return 4;
    return 5;
  }
  const range = maxHits - minHits + 1;
  return minHits + Math.floor(random() * range);
}

/** 혼란 자멸 데미지 계산용 가짜 기술. 타입 없음(자속 안 붙음)·물리·위력 40으로 자기 자신을 타격한다 */
const CONFUSION_SELF_HIT_MOVE: Move = {
  id: "__confusion_self_hit__",
  name: "혼란 자멸",
  type: null,
  category: "physical",
  power: CONFUSION_SELF_HIT_POWER,
  accuracy: null,
  pp: 0,
  priority: 0,
  effect: "혼란 상태에서 스스로에게 가하는 데미지",
};

/**
 * 발버둥. 4개 기술 PP가 전부 0이 되면 자동으로 나가는 비상 기술이라 moves.json에는 없다(사용자 확인).
 * ???타입(=type null → resolveMoveContext/computeDamage가 이미 null-safe해서 자속·상성 없이 항상 등배로 처리됨)·
 * 물리·위력 50·필중(accuracy null). pp는 실제로 소모 관리하지 않으므로(remainingPp에 키가 없어 자동으로
 * 스킵됨) 의미상 최댓값만 채워둔 값 — 임의로 1로 정하지 않아도 된다는 요청 그대로 반영.
 */
export const STRUGGLE_MOVE: Move = {
  id: "__struggle__",
  name: "발버둥",
  type: null,
  category: "physical",
  power: 50,
  accuracy: null,
  pp: 1,
  priority: 0,
  effect: "사용할 수 있는 기술이 없을 때 자동으로 사용된다. 필중이며, 사용자는 최대 HP의 1/4만큼 반동 데미지를 입는다.",
};

/** 시뮬레이터 안에서 한 포켓몬이 갖는 전체 상태. 파티 슬롯(정적 정보) + 배틀 중 바뀌는 값들 */
export interface BattleFighterState {
  slot: EvaluatorSlot;
  types: PokemonType[];
  /**
   * 실제로 판정에 쓰는 성별(getEffectiveGender로 등장 시점에 한 번만 계산 — 배틀 중 바뀌지
   * 않는다). 무성별 종은 null. 헤롱헤롱(매혹)·헤롱헤롱바디가 이성 관계를 확인할 때 쓴다.
   */
  gender: PokemonGender | null;
  /**
   * 실제로 판정에 쓰는 특성 id. 메가진화 중이면 slot.ability와 무관하게 항상 그 메가폼 고유
   * 특성으로 고정된다(getEffectiveAbilityId) — 메가리자몽Y는 항상 가뭄, 메가리자몽X는 항상
   * 단단한발톱. slot.ability를 직접 쓰면 메가 특성이 무시되는 버그가 있어 이 필드로 분리했다.
   */
  effectiveAbilityId: string | null;
  realStats: BaseStats;
  currentHp: number;
  maxHp: number;
  stages: StatStages;
  accuracyStages: AccuracyEvasionStages;
  critStage: CritStage;
  /** 주 상태이상(화상/독/맹독/마비/잠듦/얼음). 한 번에 하나만 */
  status: StatusConditionState;
  /** 행동방해류(풀죽음/반동/혼란). 주 상태이상과 별도 축이라 여러 개 동시에 걸릴 수 있다 */
  volatile: VolatileConditionState;
  /** move id → 남은 PP */
  remainingPp: Record<string, number>;
  /**
   * 공중날기 등 2턴 차지 기술(Move.chargeTurn)의 준비 턴을 쓰는 중이면 그 기술 id.
   * 다음 턴 이 기술이 선택 여부와 무관하게 자동으로 재실행되고, chargeHideType이 있으면
   * bypassesHiding 예외 기술 외엔 전부 빗나간다(무적). 준비 중이 아니면 undefined.
   */
  chargingMoveId?: string;
  /** 메트로놈(연속 같은 기술 위력 증가)용 — 직전에 실제로 사용한 기술 id. 없으면 아직 없음 */
  lastMoveId?: string;
  /** lastMoveId와 같은 기술을 몇 번 연속으로 썼는지(첫 사용=1). 메트로놈 배율 계산에 쓴다 */
  lastMoveStreak?: number;
  /** 비축하기(Stockpile) 스택(0~3). 토해내기가 위력·랭크 소비에 쓴다. */
  stockpileCount?: number;
  /** 질투의불꽃 판정용 — 이번 턴이 시작된 시점의 랭크 스냅샷. runTurn이 매 턴 갱신한다. */
  statStagesAtTurnStart?: StatStages;
  /**
   * 이번 배틀에서 실제로 "행동을 개시한" 기술 id 모음(명중/빗나감 무관). 비장의무기
   * (usageCondition: "all-other-moves-used") 사용 가능 판정에 쓴다.
   */
  usedMoveIds?: Record<string, true>;
  /**
   * 이번 턴에 실제 HP로 받은 데미지를 카테고리별로 누적한다(미러코트/카운터용, F-1). 매 턴 시작 시
   * runTurn이 0으로 초기화한다. 대타로 흡수된 데미지는 포함하지 않는다.
   */
  damageTakenThisTurn?: { physical: number; special: number };
  /**
   * 멸망의노래 카운트(F-4). 걸리면 3, 매 턴 종료 시 로그를 찍고 1씩 줄어들며, 0에서 다음 감소
   * 시점에 HP가 0이 된다. undefined면 안 걸린 상태.
   */
  perishCount?: number;
  /** 나무열매(카리열매 등)처럼 대전 중 1회만 발동하는 지닌 도구를 이미 썼으면 true */
  itemConsumed?: boolean;
  /**
   * 배틀 중 실제로 지닌 도구 id. slot.item(파티 원본, 절대 안 바뀜)과 분리된 런타임 상태로,
   * 매지션(도구 강탈)·곡예(도구 상실 감지)가 도입되면서 "지금 이 순간 실제로 지닌 도구"를
   * 표현할 축이 필요해 신설했다. createFighterState에서 slot.item으로 초기화되고, 이후
   * 도구가 1회용 효과로 소모되거나(consumeItem 헬퍼) 매지션에게 빼앗기면 null이 된다.
   * attackerItem/defenderItem 등 전투 중 도구 효과를 읽는 모든 지점은 slot.item이 아니라
   * 이 필드를 기준으로 삼는다(단, 매치업 페이지의 1턴 스냅샷은 예외 — 이전 턴이 없으니
   * slot.item을 그대로 쓴다).
   */
  currentItemId: string | null;
  /**
   * 곡예: 도구를 잃은 순간 한 번 켜지면 배틀이 끝날 때까지 계속 유지되는 플래그(ownMoveTypeBoosts와
   * 같은 패턴) — 이후 스피드 계산에서 이 값이 true면 항상 2배를 곱한다. 본가는 "교체하기 전까지"
   * 유지고 교체하면 초기화되지만, 이 시뮬레이터는 교체가 없는 1v1이라 "배틀 끝까지"로 취급해도
   * 동일하다(Ability.doublesSpeedOnItemLoss 참고).
   */
  unburdenActive?: boolean;
  /**
   * 탈(Disguise): 배틀 중 이 특성으로 한 번이라도 데미지를 무효화했으면(=탈이 벗겨졌으면) true —
   * unburdenActive와 같은 패턴으로 배틀 끝까지 유지되는 플래그. 이후로는 정상적으로 데미지를 받는다.
   */
  disguiseBroken?: boolean;
  /**
   * 변신(Move.transformsIntoTarget)·괴짜(Ability.transformsIntoOpponentOnEntry)로 상대로 변신한
   * 상태면 true. 타입·5실능(HP 제외)·특성·능력 랭크·기술(PP 5)을 상대 것으로 갈아치운 뒤 이 플래그를
   * 세운다. 교체가 없는 1v1이라 한 번 변신하면 배틀 끝까지 유지되고, 재변신은 실패한다.
   * slot.pokemonId는 원본 그대로 두므로(종 자체는 안 바뀜) 몸무게·종별타입 기술은 원본 종 기준으로
   * 남는다 — 변신 사용자가 메타몽뿐이라 실질 영향이 없어 단순화했다.
   */
  transformed?: boolean;
  /**
   * 길동무: 이번 시전이 성공해서 "이번 턴(또는 이후 턴에) 직접 공격으로 쓰러지면 상대도 같이
   * 쓰러뜨린다" 예약이 걸려있으면 true. activeProtect와 달리 매 턴 시작 시 초기화되지 않고,
   * 이 포켓몬 자신의 다음 행동이 시작되는 시점(resolveAction 최상단)에 지워진다 — "다음 자신의
   * 턴이 오면(행동불능인 턴 포함) 예약이 사라진다"는 본가 규칙과 대응.
   */
  destinyBondArmed?: boolean;
  /**
   * 리플렉터(물리)/빛의장막(특수) — 이 포켓몬 쪽에 걸려있는 스크린과 각각의 남은 턴 수.
   * "아군이 받는 데미지 감소"라 1v1에서는 이 포켓몬 자신이 상대 공격을 맞을 때 적용된다.
   */
  screens: Partial<Record<"reflect" | "lightScreen" | "auroraVeil", number>>;
  /**
   * 타오르는불꽃처럼 "이 타입 기술을 무효화한 이후로 자신이 쓰는 그 타입 기술 위력이 오른다"는
   * 특성이 실제로 발동한 적 있으면 그 배수가 채워진다(교체가 없는 1v1이라 배틀 끝까지 유지).
   * 정적 데이터(Ability.absorbsType)만으로는 "발동한 적 있는지"를 표현할 수 없어 런타임 상태로 분리했다.
   */
  ownMoveTypeBoosts: Partial<Record<PokemonType, number>>;
  /** 킬가르도(배틀스위치)만 채운다 — 두 폼의 종족값 세트와 실드폼 복귀 전용 기술 id */
  stanceChangeForms?: StanceChangeForms;
  /** stanceChangeForms가 있을 때만 의미 있음. 등장 시 항상 "shield"로 시작한다 */
  currentStanceForm?: "shield" | "blade";
  /**
   * 대타출동으로 세운 대타의 남은 HP. undefined면 대타가 없는 상태. 대타가 있는 동안 상대
   * 기술의 데미지는(소리 계열 제외) 이 값에서 깎이고 실제 currentHp는 건드리지 않으며,
   * opponent 방향 부가효과(상태이상·랭크/명중회피/급소 하락·행동방해)도 전부 무산된다
   * (resolveAction의 blockedBySubstitute 참고).
   */
  substituteHp?: number;
  /**
   * 이번 턴에 방어류(방어/판별/버티기/킹실드) 기술이 성공적으로 발동했으면 채워진다. 같은 턴
   * 나중에 움직이는 상대의 공격을 이 값에 따라 처리한 뒤, runTurn이 매 턴 시작 시 항상
   * 지워서 다음 턴엔 남아있지 않게 한다(1턴짜리 효과).
   */
  activeProtect?: {
    effect: "block" | "endure";
    /** 로그 문구용 — 실제로 성공시킨 기술 이름(방어/판별/버티기/킹실드 중 하나) */
    moveName: string;
    /** 킹실드가 접촉기를 막았을 때만 채워서 아래에서 상대에게 적용한다 */
    contactPenalty?: { stat: BattleStatKey; delta: number };
    /** 니들가드가 접촉기를 막았을 때 공격자에게 줄 최대 HP 비율 데미지(니들가드=1/8) */
    contactDamageFraction?: number;
  };
  /**
   * 방어류 기술의 연속 성공 횟수. 다음 시도 성공 확률은 (1/3)^protectStreak. 계열이 아닌
   * 다른 기술을 쓰거나 이번 시도가 실패하면 0으로 리셋된다(undefined와 0은 동일하게 취급).
   */
  protectStreak?: number;
}

/** 두 포켓몬(a/b)을 마주 세운 배틀 상태 */
export interface BattleState {
  a: BattleFighterState;
  b: BattleFighterState;
  weather?: WeatherKind;
  /** 날씨가 사라지기까지 남은 턴 수. weather가 없으면 의미 없음 */
  weatherTurnsRemaining?: number;
  field?: FieldKind;
  /** 필드가 사라지기까지 남은 턴 수. field가 없으면 의미 없음 */
  fieldTurnsRemaining?: number;
  /** 트릭룸이 해제되기까지 남은 턴 수. 트릭룸이 안 걸려있으면 undefined */
  trickRoomTurnsRemaining?: number;
  /**
   * 진영별 스텔스록 설치 여부. 한 번 깔리면 배틀 끝까지 영구 유지된다(Phase 6.5 §6-2 ④).
   * 교체 개념이 없어 "등장 데미지"는 아직 없고, 로그·환경 UI 표시용 상태값이다.
   */
  stealthRock: { a: boolean; b: boolean };
  /** 진영별 압정뿌리기(스파이크) 설치 여부. 스텔스록과 같은 축 — 교체가 없어 로그·환경 UI 표시용 상태값이다. */
  spikes: { a: boolean; b: boolean };
  turnNumber: number;
  /** 배틀 시작 시점에 특성으로 날씨가 자동으로 바뀌었으면("○○의 잔비!") 그 안내 문구 */
  entryAnnouncements: string[];
}

export type FighterKey = "a" | "b";

/** 상대 키를 구한다 */
export function opponentKey(key: FighterKey): FighterKey {
  return key === "a" ? "b" : "a";
}

/** fighter의 현재 특성 객체(effectiveAbilityId 기준). 없으면 undefined */
function abilityOf(fighter: BattleFighterState): Ability | undefined {
  return fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
}

/**
 * 날씨부정(에어록/날씨부정): 양쪽 중 누구든 이 특성이면 날씨의 "부가효과"는 전부 무시된다.
 * state.weather 자체와 weatherTurnsRemaining(지속 턴)은 그대로 두고, 데미지 배율·조건 특성·
 * 웨더볼·틱 데미지 등 효과를 읽는 지점에서만 이 함수를 거쳐 undefined로 만든다.
 */
function activeWeather(state: BattleState): WeatherKind | undefined {
  if (abilityOf(state.a)?.negatesWeather || abilityOf(state.b)?.negatesWeather) return undefined;
  return state.weather;
}

/**
 * 투쟁심(Rivalry): 공격측이 이 특성일 때 상대와의 성별 관계로 데미지 배율을 낸다.
 * 같은 성별 ×1.25 · 다른 성별 ×0.75 · 어느 한쪽이라도 성별 불명(null) ×1.0.
 */
function rivalryDamageMultiplier(
  ability: Ability | undefined,
  attackerGender: PokemonGender | null,
  defenderGender: PokemonGender | null,
): number {
  if (!ability?.rivalryDamage) return 1;
  if (attackerGender === null || defenderGender === null) return 1;
  return attackerGender === defenderGender ? 1.25 : 0.75;
}

/**
 * 심술꾸러기(Contrary): fighter가 이 특성이면 랭크 변화 delta의 부호를 반전한다(그 외엔 그대로).
 * 위협·EOT 랭크업·hitTrigger 자기 랭크변화 등 applyStageDelta를 직접 부르는 지점에서 delta를 감싼다.
 */
function contraryDelta(fighter: BattleFighterState, delta: number): number {
  return abilityOf(fighter)?.invertsStatChanges ? -delta : delta;
}

/**
 * 심술꾸러기: fighter가 대상이 되는 기술 랭크 변화(statChanges)의 delta/setTo 부호를 반전한 기술
 * 복사본을 돌려준다. Contrary가 아니거나 statChanges가 없으면 원본을 그대로 반환한다.
 * applyMoveStatChanges / applyMoveAccuracyEvasionChanges 둘 다에 이 결과를 넘기면 5스탯·명중/회피가 함께 반전된다.
 */
function contraryMoveFor(move: Move, fighter: BattleFighterState): Move {
  if (!abilityOf(fighter)?.invertsStatChanges || !move.statChanges) return move;
  return {
    ...move,
    statChanges: move.statChanges.map((s) => ({
      ...s,
      delta: s.delta === undefined ? undefined : -s.delta,
      setTo: s.setTo === undefined ? undefined : -s.setTo,
    })),
  };
}

/** 기분파(캐스퐁): 날씨별 타입. 쾌청→불꽃, 비→물, 눈→얼음, 그 외→노말 */
const FORECAST_TYPE_BY_WEATHER: Partial<Record<WeatherKind, PokemonType>> = {
  쾌청: "불꽃",
  비: "물",
  눈: "얼음",
};

/**
 * 기분파 특성 소유자(캐스퐁)의 타입을 현재 유효 날씨(activeWeather)에 맞춰 다시 설정한다.
 * 날씨부정이 걸려 있으면 노말로 되돌아간다. 변신 중이면 건드리지 않는다.
 */
function applyForecastForm(fighter: BattleFighterState, weather: WeatherKind | undefined): void {
  if (fighter.transformed) return;
  if (!abilityOf(fighter)?.weatherFormChange) return;
  const next = (weather && FORECAST_TYPE_BY_WEATHER[weather]) || "노말";
  fighter.types = [next];
}

/** 의태(메더): 필드별 타입. 일렉트릭필드→전기, 사이코필드→에스퍼, 그래스필드→풀, 미스트필드→페어리 */
const MIMICRY_TYPE_BY_FIELD: Record<FieldKind, PokemonType> = {
  일렉트릭필드: "전기",
  사이코필드: "에스퍼",
  그래스필드: "풀",
  미스트필드: "페어리",
};

/**
 * 의태 특성 소유자의 타입을 현재 필드에 맞춰 다시 설정한다. 필드가 있으면 그 필드 타입(단일),
 * 없으면 종족 원래 타입으로 되돌린다. 필드 타입으로 "바뀌었을 때만" 그 타입을 돌려준다(로그용) —
 * 원래 타입 복귀는 조용히 처리한다. 변신 중이면 건드리지 않는다.
 */
function applyMimicryForm(fighter: BattleFighterState, field: FieldKind | undefined): PokemonType | undefined {
  if (fighter.transformed) return undefined;
  if (!abilityOf(fighter)?.terrainTypeChange) return undefined;
  const baseTypes = getPokemon(fighter.slot.pokemonId)?.types ?? fighter.types;
  const next: PokemonType[] = field ? [MIMICRY_TYPE_BY_FIELD[field]] : [...baseTypes];
  const changed = next.length !== fighter.types.length || next.some((t, i) => t !== fighter.types[i]);
  fighter.types = next;
  return changed && field ? next[0] : undefined;
}

/**
 * 파티 슬롯과 보유 기술 목록으로 초기 배틀 상태를 만든다. HP는 만HP로 시작하고,
 * 랭크·명중/회피/급소 카운터·상태이상은 전부 중립, PP는 각 기술의 최대치로 채운다.
 */
export function createFighterState(slot: EvaluatorSlot, moves: Move[]): BattleFighterState {
  const pokemon = getPokemon(slot.pokemonId);
  if (!pokemon) throw new Error(`알 수 없는 포켓몬: ${slot.pokemonId}`);

  const form = getEffectiveForm(pokemon, slot);
  // 킬가르도(배틀스위치): pokemon.baseStats에 이미 실드폼 수치를 그대로 채워뒀으므로, 등장 시점
  // 실수치는 별도 분기 없이 그대로 계산된다 — currentForm/stanceChangeForms만 같이 들고 다니다가
  // resolveAction에서 기술 카테고리에 따라 필요할 때 realStats를 다시 계산한다.
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);

  return {
    slot,
    types: form.types,
    gender: getEffectiveGender(pokemon, slot),
    effectiveAbilityId: getEffectiveAbilityId(form, slot.ability),
    realStats,
    currentHp: realStats.hp,
    maxHp: realStats.hp,
    stages: { ...NEUTRAL_STAGES },
    accuracyStages: { ...NEUTRAL_ACCURACY_STAGES },
    critStage: NEUTRAL_CRIT_STAGE,
    status: { ...NO_STATUS_CONDITION },
    volatile: { active: { ...NO_VOLATILE_CONDITIONS.active } },
    remainingPp: Object.fromEntries(moves.map((m) => [m.id, m.pp])),
    stockpileCount: 0,
    usedMoveIds: {},
    currentItemId: slot.item ?? null,
    screens: {},
    ownMoveTypeBoosts: {},
    stanceChangeForms: pokemon.stanceChangeForms,
    currentStanceForm: pokemon.stanceChangeForms ? "shield" : undefined,
  };
}

/** "비"/"쾌청"처럼 자음 받침 유무에 따라 "로"/"으로" 조사를 자동 판별한다 */
function roEuro(name: string): "로" | "으로" {
  const lastChar = name.at(-1);
  if (!lastChar) return "로";
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로";
  return code % 28 === 0 ? "로" : "으로";
}

/** "맹화를"/"트레이스을" 같은 목적격 조사 — 받침 유무로 "을"/"를"을 자동 판별한다(트레이스 복사 로그용) */
function eulReul(name: string): "을" | "를" {
  const lastChar = name.at(-1);
  if (!lastChar) return "를";
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "를";
  return code % 28 === 0 ? "를" : "을";
}

/** "잠만보는"/"오롱털은" 같은 주제격 조사 — 받침 유무로 "는"/"은"을 자동 판별한다(통찰 로그용) */
function eunNeun(name: string): "는" | "은" {
  const lastChar = name.at(-1);
  if (!lastChar) return "는";
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "는";
  return code % 28 === 0 ? "는" : "은";
}

/**
 * 우격다짐(추가효과 무효화 + 위력 1.3배)이 적용될 "추가효과가 있는 데미지 기술"인지 판정한다.
 *
 * ── 추가효과(追加効果 / secondary effect)의 정의 (이 프로젝트 단일 기준) ──
 * 데미지 기술(category !== "status")이 상대에게 딸려 거는 상태이상·행동방해·랭크변화. 확률(chance)
 * 유무와 무관하다 — 연옥 100% 화상·일렉트릭네트 100% 스피드↓도 추가효과다. 변화기(도깨비불 등)의
 * 효과는 주효과라 제외, 자기 대상 효과(반동·자기 랭크다운)도 제외.
 *
 * 우격다짐은 여기에 더해 "자기 랭크업"(차지빔 자기 특공↑ 등)까지 추가효과로 쳐서 같이 제거한다 —
 * 인분(Ability.blocksSecondaryEffects)은 자기 대상 효과엔 관심이 없어(상대에게 오는 것만 막음)
 * 그 부분만 범위가 다르다. 데미지가 없는 순수 변화기는 양쪽 다 적용 대상이 아니다.
 */
/** 모래바람 틱 데미지 면제 특성(모래 관련) — §1 F-3. 매직가드는 negatesIndirectDamage로 별도 처리. */
const SANDSTORM_IMMUNE_ABILITY_NAMES = new Set(["모래숨기", "모래의힘", "모래날림", "모래헤치기"]);

/**
 * 자이로볼(Move.gyroBallPower)의 실효 스피드 산출 — 실능 × 스피드 랭크 배율 × 마비 배율 ×
 * 도구 배율(구애스카프·검은철구). 엽록소류 날씨 스피드 특성은 미반영(후속). 최종 위력 공식은
 * battlePower.gyroBallPowerFromSpeeds가 담당한다.
 */
function gyroBallPowerValue(
  attacker: BattleFighterState,
  defender: BattleFighterState,
  attackerItem: Parameters<typeof getItemSpeedMultiplier>[0],
  defenderItem: Parameters<typeof getItemSpeedMultiplier>[0],
): number {
  const effSpeed = (f: BattleFighterState, item: Parameters<typeof getItemSpeedMultiplier>[0]) =>
    f.realStats.spe *
    rankStageMultiplier(f.stages.spe) *
    computeStatusSpeedMultiplier(f.status.condition) *
    getItemSpeedMultiplier(item);
  return gyroBallPowerFromSpeeds(effSpeed(attacker, attackerItem), effSpeed(defender, defenderItem));
}

function hasSheerForceSecondaryEffect(move: Move): boolean {
  if (move.power === null && move.fixedDamage === undefined) return false;
  if (move.inflictsStatus && move.inflictsStatus.length > 0) return true; // 이 스키마에서 대상은 항상 상대
  if (move.inflictsVolatile?.some((v) => v.target === "opponent")) return true;
  if (move.statChanges?.some((s) => s.target === "opponent")) return true;
  if (move.statChanges?.some((s) => s.target === "self" && (s.delta ?? 0) > 0)) return true;
  return false;
}

/**
 * 1회용 도구(나무열매·하양허브 등)가 이번에 소모됐음을 기록한다. itemConsumed(같은 도구 재발동
 * 방지)와 currentItemId(곡예가 "도구를 잃음"을 판정하는 기준)를 항상 같이 갱신해야 해서 헬퍼로
 * 묶었다 — 둘 중 하나만 갱신하면 곡예가 오작동한다(예: itemConsumed만 세팅하면 나무열매를 쓴
 * 뒤에도 currentItemId가 그대로 남아있어 곡예가 영영 발동하지 않는다).
 */
function consumeItem(fighter: BattleFighterState): void {
  fighter.itemConsumed = true;
  fighter.currentItemId = null;
}

/**
 * 이 날씨에 맞는 바위(뜨거운바위 등)를 지닌 쪽이 있으면 그 보너스 턴수를, 없으면 0을 반환한다.
 * 양쪽 다 지닐 일은 없지만(도구는 하나씩) 방어적으로 둘 다 확인해서 더 큰 쪽을 쓴다.
 */
function weatherRockBonus(weather: WeatherKind, aSlot: EvaluatorSlot, bSlot: EvaluatorSlot): number {
  const aItem = aSlot.item ? getItem(aSlot.item) : undefined;
  const bItem = bSlot.item ? getItem(bSlot.item) : undefined;
  const aBonus = aItem?.weatherDurationBonus?.weather === weather ? aItem.weatherDurationBonus.bonus : 0;
  const bBonus = bItem?.weatherDurationBonus?.weather === weather ? bItem.weatherDurationBonus.bonus : 0;
  return Math.max(aBonus, bBonus);
}

/**
 * 사용자가 날씨를 직접 고르지 않았을 때, 양쪽 특성(가뭄/잔비/모래날림 등 setsWeather)을 확인해서
 * 배틀 시작과 동시에 날씨를 자동으로 바꾼다.
 *
 * 양쪽 다 날씨 특성이면 실효 스피드가 빠른 쪽부터 순서대로 발동한다(사용자 확인) — "우선권"이
 * 있는 게 아니라 그냥 둘 다 발동하는데, 날씨 기술/특성은 이미 다른 날씨가 있어도 실패하지 않고
 * 항상 덮어쓰는 규칙(resolveAction의 Move.setsWeather 처리와 동일)이라, 나중에(=스피드가 느린
 * 쪽이) 발동하는 쪽의 날씨가 결국 최종적으로 남는다. 로그에도 두 특성이 순서대로 발동하는 걸
 * 그대로 보여준다.
 *
 * 챔피언스는 특성으로 걸리든 사용자가 수동으로 고르든 날씨에 5턴 카운트다운이 있다(사용자 확인 —
 * 본가와 달리 날씨 특성이 무제한 지속이 아님). 그래서 여기서도 기술로 걸 때(resolveAction의
 * Move.setsWeather 처리)와 똑같이 WEATHER_DURATION(+바위 보너스)을 turnsRemaining으로 채운다.
 */
function resolveEntryWeather(
  aSlot: EvaluatorSlot,
  aFighter: BattleFighterState,
  bSlot: EvaluatorSlot,
  bFighter: BattleFighterState,
  manualWeather: WeatherKind | undefined,
): { weather: WeatherKind | undefined; weatherTurnsRemaining: number | undefined; announcements: string[] } {
  if (manualWeather) {
    return {
      weather: manualWeather,
      weatherTurnsRemaining: WEATHER_DURATION + weatherRockBonus(manualWeather, aSlot, bSlot),
      announcements: [],
    };
  }

  const aAbility = aFighter.effectiveAbilityId ? getAbility(aFighter.effectiveAbilityId) : undefined;
  const bAbility = bFighter.effectiveAbilityId ? getAbility(bFighter.effectiveAbilityId) : undefined;
  if (!aAbility?.setsWeather && !bAbility?.setsWeather) {
    return { weather: manualWeather, weatherTurnsRemaining: undefined, announcements: [] };
  }

  const announce = (slot: EvaluatorSlot, ability: Ability, weather: WeatherKind) => {
    const pokemonName = getPokemon(slot.pokemonId)?.name ?? "포켓몬";
    return `${pokemonName}의 ${ability.name}! 날씨가 ${weather}${roEuro(weather)} 바뀌었다!`;
  };

  if (aAbility?.setsWeather && bAbility?.setsWeather) {
    // 둘 다 날씨 특성 보유: 스피드가 빠른 쪽부터 순서대로 발동하고, 나중에(느린 쪽이) 발동하는
    // 날씨가 덮어써서 최종적으로 남는다.
    const aFaster = aFighter.realStats.spe >= bFighter.realStats.spe;
    const [firstSlot, firstAbility] = aFaster ? ([aSlot, aAbility] as const) : ([bSlot, bAbility] as const);
    const [secondSlot, secondAbility] = aFaster ? ([bSlot, bAbility] as const) : ([aSlot, aAbility] as const);
    const weather = secondAbility.setsWeather!;
    return {
      weather,
      weatherTurnsRemaining: WEATHER_DURATION + weatherRockBonus(weather, aSlot, bSlot),
      announcements: [
        announce(firstSlot, firstAbility, firstAbility.setsWeather!),
        announce(secondSlot, secondAbility, weather),
      ],
    };
  }

  const aWins = !!aAbility?.setsWeather;
  const winnerSlot = aWins ? aSlot : bSlot;
  const winnerAbility = (aWins ? aAbility : bAbility)!;
  const weather = winnerAbility.setsWeather!;

  return {
    weather,
    weatherTurnsRemaining: WEATHER_DURATION + weatherRockBonus(weather, aSlot, bSlot),
    announcements: [announce(winnerSlot, winnerAbility, weather)],
  };
}

/**
 * 변신(Move.transformsIntoTarget)·괴짜(Ability.transformsIntoOpponentOnEntry) 공통 처리 —
 * self를 target으로 변신시킨다. 타입·5실능(HP 제외)·특성·능력 랭크(급소율 포함)·기술 목록을
 * target 것으로 복사하고, 복사한 기술의 PP는 각 min(5, 원래 최대 PP)로 채운다. 현재 HP·maxHp·
 * 주 상태이상은 유지. slot.pokemonId(종 자체)는 바꾸지 않는다 — 변신 사용자가 메타몽뿐이라
 * 몸무게·종별타입 기술 정도만 원본 종 기준으로 남고 실질 영향이 없다.
 */
function applyTransform(self: BattleFighterState, target: BattleFighterState): void {
  self.types = [...target.types];
  self.realStats = {
    ...self.realStats,
    atk: target.realStats.atk,
    def: target.realStats.def,
    spa: target.realStats.spa,
    spd: target.realStats.spd,
    spe: target.realStats.spe,
  };
  self.effectiveAbilityId = target.effectiveAbilityId;
  self.stages = { ...target.stages };
  self.accuracyStages = { ...target.accuracyStages };
  self.critStage = target.critStage;
  self.remainingPp = Object.fromEntries(
    Object.keys(target.remainingPp).map((id) => [id, Math.min(5, getMove(id)?.pp ?? 5)]),
  );
  self.transformed = true;
}

/**
 * 위협(상대 공격 하락)·일렉트릭메이커(필드 설치)·트레이스(상대 특성 복사)·괴짜(상대로 변신) —
 * 배틀 시작과 동시에 발동하는 특성을 한 번에 처리한다. 가뭄류(날씨)와 같은 이유로 실효 스피드가
 * 빠른 쪽부터 순서대로 적용한다. fighterA/fighterB는 이 함수 안에서 직접 변형된다(랭크 반영,
 * 특성 교체, 변신). 두 쪽 다 트레이스면 먼저 발동하는 쪽이 상대의 "원래" 특성을 복사하고, 나중
 * 쪽은 그 시점에 이미 바뀐 상대 특성을 복사한다(본가와 동일한 순서 의존성).
 */
function resolveEntryAbilityEffects(
  aSlot: EvaluatorSlot,
  aFighter: BattleFighterState,
  bSlot: EvaluatorSlot,
  bFighter: BattleFighterState,
): { field: FieldKind | undefined; fieldTurnsRemaining: number | undefined; announcements: string[] } {
  const aAbility = aFighter.effectiveAbilityId ? getAbility(aFighter.effectiveAbilityId) : undefined;
  const bAbility = bFighter.effectiveAbilityId ? getAbility(bFighter.effectiveAbilityId) : undefined;
  if (
    !aAbility?.lowersOpponentStatOnEntry &&
    !bAbility?.lowersOpponentStatOnEntry &&
    !aAbility?.setsFieldOnEntry &&
    !bAbility?.setsFieldOnEntry &&
    !aAbility?.copiesOpponentAbilityOnEntry &&
    !bAbility?.copiesOpponentAbilityOnEntry &&
    !aAbility?.revealsOpponentItemOnEntry &&
    !bAbility?.revealsOpponentItemOnEntry &&
    !aAbility?.transformsIntoOpponentOnEntry &&
    !bAbility?.transformsIntoOpponentOnEntry &&
    !aAbility?.negatesWeather &&
    !bAbility?.negatesWeather &&
    !aAbility?.revealsThreateningMovesOnEntry &&
    !bAbility?.revealsThreateningMovesOnEntry &&
    !aAbility?.revealsStrongestOpponentMoveOnEntry &&
    !bAbility?.revealsStrongestOpponentMoveOnEntry
  ) {
    return { field: undefined, fieldTurnsRemaining: undefined, announcements: [] };
  }

  const aFaster = aFighter.realStats.spe >= bFighter.realStats.spe;
  const order = aFaster
    ? [
        { slot: aSlot, fighter: aFighter, ability: aAbility, opponent: bFighter, opponentSlot: bSlot },
        { slot: bSlot, fighter: bFighter, ability: bAbility, opponent: aFighter, opponentSlot: aSlot },
      ]
    : [
        { slot: bSlot, fighter: bFighter, ability: bAbility, opponent: aFighter, opponentSlot: aSlot },
        { slot: aSlot, fighter: aFighter, ability: aAbility, opponent: bFighter, opponentSlot: bSlot },
      ];

  let field: FieldKind | undefined;
  let fieldTurnsRemaining: number | undefined;
  const announcements: string[] = [];

  for (const { slot, fighter, ability, opponent, opponentSlot } of order) {
    if (!ability) continue;
    const pokemonName = getPokemon(slot.pokemonId)?.name ?? "포켓몬";

    if (ability.lowersOpponentStatOnEntry) {
      const { stat, delta } = ability.lowersOpponentStatOnEntry;
      const before = opponent.stages[stat];
      opponent.stages = applyStageDelta(opponent.stages, stat, contraryDelta(opponent, delta));
      if (opponent.stages[stat] !== before) {
        announcements.push(`${pokemonName}의 ${ability.name}! 상대의 공격이 떨어졌다!`);
      }
    }
    if (ability.setsFieldOnEntry) {
      if (field) {
        announcements.push(`${pokemonName}의 ${ability.name}! 하지만 이미 다른 필드가 있어 실패했다!`);
      } else {
        field = ability.setsFieldOnEntry;
        fieldTurnsRemaining = FIELD_DURATION;
        announcements.push(`${pokemonName}의 ${ability.name}! 필드가 ${field}(으)로 바뀌었다!`);
      }
    }
    if (ability.copiesOpponentAbilityOnEntry && opponent.effectiveAbilityId) {
      const copiedAbility = getAbility(opponent.effectiveAbilityId);
      fighter.effectiveAbilityId = opponent.effectiveAbilityId;
      const opponentName = getPokemon(opponentSlot.pokemonId)?.name ?? "상대";
      const copiedName = copiedAbility?.name ?? "특성";
      announcements.push(`${pokemonName}의 ${ability.name}! ${opponentName}의 ${copiedName}${eulReul(copiedName)} 복사했다!`);
    }
    // 괴짜(Imposter): 등장하자마자 상대로 변신한다(변신 기술과 같은 처리). 메타몽 전용.
    if (ability.transformsIntoOpponentOnEntry && !fighter.transformed) {
      applyTransform(fighter, opponent);
      const opponentName = getPokemon(opponentSlot.pokemonId)?.name ?? "상대";
      announcements.push(
        `${pokemonName}의 ${ability.name}! ${pokemonName}${eunNeun(pokemonName)} ${opponentName}${roEuro(opponentName)} 변신했다!`,
      );
    }
    // 날씨부정(에어록/날씨부정): 등장하자마자 두 줄로 알린다. 실제 날씨 무시 처리는 activeWeather가 담당.
    if (ability.negatesWeather) {
      announcements.push(`${pokemonName}의 ${ability.name}!`);
      announcements.push(`날씨의 영향이 없어졌다!`);
    }
    // 위험예지: 상대가 지닌 기술 중 자신에게 효과가 굉장한(상성 > 1) 기술이나 일격필살기(tags "일격")가
    // 하나라도 있으면 한 줄로 알린다. 배틀 수치 영향 없음(통찰과 같은 정보 표시 훅).
    if (ability.revealsThreateningMovesOnEntry) {
      const threatened = Object.keys(opponent.remainingPp).some((mid) => {
        const m = getMove(mid);
        if (!m) return false;
        if ((m.tags ?? []).includes("일격")) return true;
        return !!m.type && getEffectiveness(m.type, fighter.types) > 1;
      });
      if (threatened) {
        announcements.push(`${pokemonName}${eunNeun(pokemonName)} 몸을 떨었다!`);
      }
    }
    // 예지몽: 상대가 지닌 기술 중 가장 위력이 높은 것을 한 줄로 알린다(통찰 패턴, 정보 표시 전용).
    if (ability.revealsStrongestOpponentMoveOnEntry) {
      let best: Move | undefined;
      for (const mid of Object.keys(opponent.remainingPp)) {
        const m = getMove(mid);
        if (!m) continue;
        if (!best || (m.power ?? 0) > (best.power ?? 0)) best = m;
      }
      if (best) {
        const opponentName = getPokemon(opponentSlot.pokemonId)?.name ?? "상대";
        announcements.push(
          `${pokemonName}${eunNeun(pokemonName)} ${opponentName}의 ${best.name}${eulReul(best.name)} 간파했다!`,
        );
      }
    }
    // 통찰: 상대가 도구를 지녔을 때만 두 줄로 알린다. 배틀 수치 영향 없음(정보 표시 전용).
    if (ability.revealsOpponentItemOnEntry && opponent.currentItemId) {
      const revealedItem = getItem(opponent.currentItemId);
      if (revealedItem) {
        announcements.push(`${pokemonName}의 ${ability.name}!`);
        announcements.push(
          `${pokemonName}${eunNeun(pokemonName)} ${revealedItem.name}${eulReul(revealedItem.name)} 통찰했다!`,
        );
      }
    }
  }

  return { field, fieldTurnsRemaining, announcements };
}

export function createBattleState(
  a: EvaluatorSlot,
  aMoves: Move[],
  b: EvaluatorSlot,
  bMoves: Move[],
  weather?: WeatherKind,
): BattleState {
  const fighterA = createFighterState(a, aMoves);
  const fighterB = createFighterState(b, bMoves);
  const {
    weather: resolvedWeather,
    weatherTurnsRemaining,
    announcements: weatherAnnouncements,
  } = resolveEntryWeather(a, fighterA, b, fighterB, weather);
  const {
    field: entryField,
    fieldTurnsRemaining,
    announcements: abilityAnnouncements,
  } = resolveEntryAbilityEffects(a, fighterA, b, fighterB);

  const state: BattleState = {
    a: fighterA,
    b: fighterB,
    weather: resolvedWeather,
    weatherTurnsRemaining,
    field: entryField,
    fieldTurnsRemaining,
    stealthRock: { a: false, b: false },
    spikes: { a: false, b: false },
    turnNumber: 0,
    entryAnnouncements: [...weatherAnnouncements, ...abilityAnnouncements],
  };
  // 기분파(캐스퐁): 등장 시점의 유효 날씨(날씨부정 반영)에 맞춰 타입을 맞춰둔다.
  applyForecastForm(state.a, activeWeather(state));
  applyForecastForm(state.b, activeWeather(state));
  // 의태(메더): 등장 시점 필드에 맞춰 타입을 맞춰둔다(첫 턴 시작 훅이 안내는 따로 낸다).
  applyMimicryForm(state.a, state.field);
  applyMimicryForm(state.b, state.field);
  return state;
}

/**
 * 지닌 기술 중 PP가 남은 게 하나라도 있는지. 전부 0이면(또는 애초에 기술이 없으면) 발버둥을
 * 자동으로 써야 한다는 뜻이라, UI(BattleLogPage)가 기술 선택을 요구하지 않고 곧장 STRUGGLE_MOVE로
 * 진행하도록 이 함수로 판단한다.
 */
export function hasUsableMove(fighter: BattleFighterState): boolean {
  return Object.values(fighter.remainingPp).some((pp) => pp > 0);
}

/** 이번 턴 행동이 왜 못 나갔는지. 있으면 hit/damage 등은 의미 없다 */
export type ActionBlockReason =
  | "status"
  | "flinch"
  | "recharge"
  | "confusion"
  | "attract"
  | "psychicFieldPriority"
  | "usageCondition"
  | "moveRestricted";

/** 한 번의 기술 사용 결과 로그 */
export interface ActionLogEntry {
  actor: FighterKey;
  move: Move;
  /** 주 상태이상(잠듦/얼음/마비)이나 행동방해(풀죽음/반동/혼란 자멸)로 기술을 못 썼으면 채워진다 */
  blockedReason?: ActionBlockReason;
  /** blockedReason이 "status"일 때, 정확히 어떤 상태이상 때문인지(마비/잠듦/얼음) — UI가 "몸이 저려서"/"쿨쿨 잠들어"/"얼어 버려서" 문구를 골라 쓰는 데 필요 */
  blockedByStatus?: StatusConditionState["condition"];
  /** blockedReason이 "moveRestricted"일 때, 도발/사슬묶기/앙코르 중 무엇 때문에 막혔는지 */
  moveRestrictionKind?: "taunt" | "disable" | "encore";
  /** 회피/빗나감 여부. 필중기는 항상 true. blockedReason이 있으면 의미 없음 */
  hit: boolean;
  critical: boolean;
  damage: number;
  damagePercent: number;
  /**
   * 이 기술의 상대 타입 상성 배율(0 / 0.25 / 0.5 / 1 / 2 / 4). 변화기·타입 없는 기술은 1.
   * UI가 "효과가 굉장했다!/별로인 듯하다.../효과가 없는 듯하다..." 문구를 고르는 데 쓴다.
   */
  typeEffectiveness: number;
  defenderRemainingHp: number;
  /** 스스로 입은 데미지. 혼란 자멸(blockedReason === "confusion") 또는 발버둥 반동(move.id === STRUGGLE_MOVE.id)일 때만 0보다 크다 */
  selfDamage: number;
  attackerRemainingHp: number;
  inflictedStatus?: StatusConditionState["condition"];
  inflictedVolatile?: VolatileCondition;
  /**
   * 상태이상이 나았으면(물거품아리아 등 치료 기술, 불꽃타입 데미지 기술의 해동, 잠듦/얼음의
   * 자연 해제, thawsUserOnUse 기술 사용) 그 상태이상 종류. curedStatusTarget으로 누구의 상태인지 구분.
   */
  curedStatus?: StatusConditionState["condition"];
  /** curedStatus가 누구에게 일어났는지 — "self"면 이 행동의 actor, "opponent"면 상대 */
  curedStatusTarget?: "self" | "opponent";
  /**
   * 잠듦/얼음이 "이번 행동 시작 시점"에 자연 해제(또는 thawsUserOnUse로 강제 해동)됐으면 그 상태.
   * 움직이기 전 상태 판정이므로 로그에서 기술 줄보다 **먼저** 렌더한다. curedStatus(치료기·피격
   * 해동 등 행동 이후에 일어나는 것들)와 별도 축.
   */
  selfWokeBeforeMove?: StatusConditionState["condition"];
  /**
   * 상대가 대타를 세운 상태라 이번 기술이 본체에 전혀 닿지 못하고 통째로 막혔으면 그 기술 이름
   * (소리 기술 제외). 데미지 기술이 대타를 실제로 깎은 경우는 hitSubstitute로 따로 표시.
   */
  blockedBySubstituteMoveName?: string;
  /** 가루/포자 기술을 풀타입 상대에게 써서 통하지 않았으면 그 기술 이름 */
  powderBlockedMoveName?: string;
  /** 이 행동으로 defender가 쓰러졌으면 true */
  fainted: boolean;
  /** 혼란 자멸로 스스로 쓰러졌으면 true */
  selfFainted: boolean;
  /** 이 행동으로 필드가 새로 깔렸으면(그래스필드 등) 채워진다 */
  setField?: FieldKind;
  /** 필드 기술을 썼지만 이미 다른 필드가 깔려있어서 실패했으면 true */
  fieldSetFailed?: boolean;
  /** 스텔스록을 어느 진영에 깔았으면 그 진영 키(a/b). 로그 문구용 */
  stealthRockSetForSide?: FighterKey;
  /** 압정뿌리기(스파이크)를 어느 진영에 깔았으면 그 진영 키(a/b). 비검천중파·압정뿌리기 */
  spikesSetForSide?: FighterKey;
  /** 설치기를 깔려 했으나 이미 그 진영에 깔려 있어 실패했으면 true */
  hazardSetFailed?: boolean;
  /**
   * 매직미러로 이 변화기가 시전자에게 되돌아갔으면 그 기술 이름. 이 플래그가 있으면 아래
   * inflictedStatus·inflictedVolatile·statChanges 등 "상대 방향" 효과는 실제로는 시전자(actor)
   * 본인에게 적용된 것이라, 로그 렌더에서 주어를 뒤집어야 한다.
   */
  bouncedMoveName?: string;
  /** 매직미러 반사를 일으킨 특성 이름(매직미러) — 로그 문구용 */
  bouncedByAbilityName?: string;
  /**
   * 인분처럼 방어측 특성이 이 기술의 추가효과를 무산시켰으면 그 특성 이름. 실제로 무산된 추가효과가
   * 하나라도 있을 때만 채워진다(추가효과가 없는 기술엔 안 뜬다).
   */
  secondaryBlockedByAbilityName?: string;
  /** 아이언롤러처럼 필드를 파괴하는 기술이 명중해서 활성 필드가 없어졌으면, 없어지기 직전의 필드 종류 */
  destroyedField?: FieldKind;
  /** 이 행동으로 트릭룸이 새로 걸렸으면 true */
  setTrickRoom?: boolean;
  /** 트릭룸을 썼지만 이미 걸려있어서 실패했으면 true */
  trickRoomSetFailed?: boolean;
  /** 이 행동으로 날씨가 바뀌었으면(비바라기 등) 그 날씨. 실패라는 개념이 없어 항상 성공 시 채워진다 */
  setWeather?: WeatherKind;
  /** 이 행동으로 리플렉터/빛의장막이 자신 쪽에 새로 걸렸으면 채워진다 */
  setScreen?: "reflect" | "lightScreen" | "auroraVeil";
  /** 리플렉터/빛의장막을 썼지만 이미 같은 스크린이 걸려있어서 실패했으면 true */
  screenSetFailed?: boolean;
  /**
   * 레이징불·깨트리기(Move.breaksScreensOnHit)로 명중해서 상대 쪽 스크린을 부쉈으면 그 목록.
   * 데미지 계산은 스크린이 살아있는 상태로 이미 끝난 뒤에 제거한다(그 턴엔 아직 경감됨).
   */
  brokeScreens?: ("reflect" | "lightScreen" | "auroraVeil")[];
  /**
   * 플레어드라이브·웨이브태클·브레이브버드·양날박치기(Move.recoilFraction)로 입은 반동 데미지.
   * selfDamage(혼란 자멸/발버둥 반동)와는 계산 기준이 달라 별도 필드로 분리했다 — 준 데미지가
   * 0(면역 등)이면 반동도 자연히 0.
   */
  recoilDamage: number;
  /** 기합의띠·기합의머리띠 덕분에 기절할 데미지를 버티고 HP 1로 남았으면 그 도구 이름 */
  enduredItemName?: string;
  /** 옹골참 덕분에 기절할 데미지를 버티고 HP 1로 남았으면 그 특성 이름 */
  enduredAbilityName?: string;
  /** 하양허브 — 이번 행동의 주체(자신) 쪽에서 발동했으면 그 도구 이름 */
  restoredStatsSelfItemName?: string;
  /** 하양허브 — 상대 쪽에서 발동했으면 그 도구 이름 */
  restoredStatsOpponentItemName?: string;
  /** 트리플악셀·록블라스트 등 다단히트 기술만 채운다 — 실제로 명중해서 데미지를 낸 타수 */
  hitCount?: number;
  /** 공중날기 등 차지 기술의 준비 턴(1턴째)이면 true — 데미지 없이 "숨었다"만 기록 */
  charging?: boolean;
  /** 상대가 차지 기술로 무적인 동안 그 무적을 못 뚫는 기술을 써서 빗나갔으면 true */
  evadedByCharge?: boolean;
  /** 생명의구슬처럼 도구 때문에 입은 반동 데미지(최대 HP 비율 고정) — recoilDamage와 계산 기준이 달라 분리 */
  itemRecoilDamage?: number;
  /** itemRecoilDamage를 준 도구 이름(UI 문구용) */
  itemRecoilItemName?: string;
  /** 나무열매(카리열매 등)로 이번 피격 데미지가 반감됐으면 그 나무열매 이름 */
  berryReducedDamageItemName?: string;
  /** 과사열매: 이번 행동으로 PP가 0이 된 기술의 PP를 복구했으면 그 도구 이름 */
  leppaRestoredPpItemName?: string;
  /** 흡수기(Move.drainFraction)로 회복한 양(큰뿌리 배율 반영 후) */
  drainHealAmount?: number;
  /** 조개껍질방울로 회복한 양 */
  shellBellHealAmount?: number;
  /** 즉시 회복형 변화기(광합성·달빛·날개쉬기·게으름피우기·치유파동)로 회복한 양 */
  healedAmount?: number;
  /** healedAmount가 누구에게 적용됐는지 */
  healedTarget?: "self" | "opponent";
  /** 잠자기로 실제로 잠들었으면 true (잠들자마자 상태이상 치료 나무열매로 즉시 깼으면 false) */
  restSlept?: boolean;
  /** 이 행동으로 뿌리박기/아쿠아링이 새로 걸렸으면 채워진다 */
  setRegenVolatile?: "ingrain" | "aquaRing";
  /** 뿌리박기/아쿠아링을 썼지만 이미 걸려있어서 실패했으면 true */
  regenSetFailed?: boolean;
  /** 이 행동으로 씨뿌리기가 상대에게 걸렸으면 true */
  setLeechSeed?: boolean;
  /** 씨뿌리기를 썼지만 상대가 이미 걸려있어서 실패했으면 true */
  leechSeedSetFailed?: boolean;
  /** 씨뿌리기를 풀타입 상대에게 써서 통하지 않았으면 true */
  leechSeedBlockedByGrass?: boolean;
  /** 이 행동으로 대타가 새로 세워졌으면 true */
  setSubstitute?: boolean;
  /** 대타출동을 썼지만 이미 대타가 있거나 HP가 부족해서 실패했으면 true */
  substituteSetFailed?: boolean;
  /** 사슬묶기로 상대의 이 기술이 봉인됐으면 그 기술 이름 */
  setDisabledMoveName?: string;
  /** 사슬묶기를 썼지만 상대가 아직 기술을 안 썼거나 이미 걸려있어서 실패했으면 true */
  disableSetFailed?: boolean;
  /** 앙코르로 상대가 이 기술만 반복하게 됐으면 그 기술 이름 */
  setEncoreMoveName?: string;
  /** 앙코르를 썼지만 상대가 아직 기술을 안 썼거나 이미 걸려있어서 실패했으면 true */
  encoreSetFailed?: boolean;
  /** 파워트릭으로 자신의 두 실수치를 맞바꿨으면 그 기술 이름 */
  swappedStatsMoveName?: string;
  /** 가드셰어로 자신·상대의 방어·특방 실능을 평균냈으면 그 기술 이름 */
  averagedDefensesMoveName?: string;
  /** 스피드스왑으로 자신·상대의 스피드 실능을 맞바꿨으면 그 기술 이름 */
  swappedSpeedMoveName?: string;
  /** 셸암즈(dynamicCategoryByHigherDamage)가 이번에 물리/특수 중 어느 판정으로 나갔는지 */
  shellSideArmCategory?: "physical" | "special";
  /** 변신으로 상대(이 종)로 변신했으면 그 종 이름 */
  transformedIntoName?: string;
  /** 변신을 썼지만 이미 변신 상태라 실패했으면 true */
  transformFailed?: boolean;
  /** 우격다짐(또는 같은 축의 특성)이 이번 기술의 부가효과를 없애고 위력을 올렸으면 그 특성 이름 */
  sheerForceAbilityName?: string;
  /** 이 행동(상대를 공격)으로 상대의 대타가 이번 타격에 깨졌으면 true */
  substituteBroke?: boolean;
  /** 이 행동의 데미지가 상대의 대타로 흡수됐으면(=본체 HP는 그대로) true */
  hitSubstitute?: boolean;
  /** 방어류(방어/판별/버티기/킹실드) 기술을 실제로 써서 "방어태세에 들어갔다" — 성공/실패와 무관하게 발동 자체. */
  protectStanceEntered?: boolean;
  /** 방어류(방어/판별/버티기/킹실드) 기술이 이번에 성공적으로 발동했으면 true (상대의 자신을 겨냥한 공격을 실제로 막음) */
  protectSucceeded?: boolean;
  /** 방어류 기술을 썼지만 실패했으면 true (연속 사용 확률 판정 실패, 또는 상대가 막을 것을 안 냄). streak는 0으로 리셋됨 */
  protectFailed?: boolean;
  /** 이 기술로 사용자 자신의 랭크가 실제로 오른 것(칼춤 등). 렌더에서 "OO의 X가 (크게) 올라갔다!" */
  selfStatRises?: { stat: BattleStatKey; delta: number }[];
  /** 랭크업을 시도했지만 이미 +6이라 오르지 않은 스탯. "OO의 X는 더 이상 올라가지 않는다!" */
  selfStatsAtMax?: BattleStatKey[];
  /**
   * 이 기술로 상대의 랭크가 실제로 내려간 것(거짓울음·브레이크클로 등). delta는 내려간 칸 수(양수).
   * selfStatRises와 대칭 — 렌더에서 "[상대]의 X가 (크게) 떨어졌다!". 확정 하락만(확률 부가효과 제외).
   */
  opponentStatDrops?: { stat: BattleStatKey; delta: number }[];
  /**
   * 이미 걸린 상태이상에 같은/다른 주 상태이상 기술을 써서 아무 변화가 없었으면 true
   * (블래키가 이미 맹독인 번치코에게 맹독 재시전 등). "그러나 실패했다!" 문구용.
   */
  statusInflictFailed?: boolean;
  /** 미러아머(reflectsOpponentStatDrops)가 이번 기술의 상대 랭크다운을 시전자에게 되받아쳤으면 그 특성 이름 */
  reflectedStatDropAbilityName?: string;
  /** reflectedStatDropAbilityName이 되돌린 랭크다운(시전자에게 적용된 것) — stat·폭(양수) */
  reflectedStatDrops?: { stat: BattleStatKey; delta: number }[];
  /** 무릎차기 등 crashFraction 기술이 빗나가거나/막히거나/무효화돼 사용자가 입은 반동 데미지 */
  crashDamage?: number;
  /** 철제광선 등 selfDamageFractionOnUse 기술이 "사용하는 순간" 사용자가 입은 데미지 */
  selfDamageOnUse?: number;
  /** 떨어뜨리기 등 cancelsTargetCharge 기술이 상대의 차징(공중날기 등)을 캔슬시켰으면 그 기술 이름 */
  canceledTargetChargeMoveName?: string;
  /** 죽기살기(Endeavor)가 상대 HP를 사용자 HP와 같게 깎았으면, 실제로 깎은 양 */
  endeavorDamage?: number;
  /** 미러코트/카운터가 되받아친 데미지(받은 데미지 ×2) */
  counterDamage?: number;
  /** 미러코트/카운터가 실패했으면(받은 데미지 없음·상대 면역 타입) true */
  counterFailed?: boolean;
  /** 멸망의노래가 이번에 새로 걸렸으면 true */
  perishSongStarted?: boolean;
  /** 멸망의노래를 썼지만 양쪽 다 이미 카운트 중이라 실패했으면 true */
  perishSongFailed?: boolean;
  /** 이 행동(공격)이 상대의 방어류 기술에 완전히 막혔으면 그 기술 이름 */
  blockedByProtectMoveName?: string;
  /** 방어류 버티기로 이번 데미지를 버티고 HP 1로 남았으면 그 기술 이름 */
  enduredProtectMoveName?: string;
  /** 킹실드/니들가드가 접촉기를 막아 공격측에게 반동(랭크변화 또는 데미지)을 걸었으면 그 기술 이름 */
  protectContactPenaltyMoveName?: string;
  /** 니들가드가 접촉기를 막아 공격측이 입은 데미지(currentHp에 이미 반영됨) */
  protectContactDamage?: number;
  /** 부자유친 추가타로 낸 데미지(총 damage에 이미 합산돼 있음 — 몇 대인지 구분용) */
  followUpHitDamage?: number;
  /** 프레셔로 인해 이번 기술의 PP가 추가로 더 깎였으면 그 특성 이름 */
  pressureExtraPpAbilityName?: string;
  /** 상태이상/혼란 즉시치료 나무열매(리샘·버치·유루·복슝·복분·배리·시몬)가 발동했으면 그 도구 이름 */
  statusCureBerryItemName?: string;
  /** 자뭉열매/오랭열매가 공격자에게 발동해 회복한 양 */
  attackerBerryHealAmount?: number;
  /** attackerBerryHealAmount를 준 도구 이름 */
  attackerBerryHealItemName?: string;
  /** 자뭉열매/오랭열매가 방어자에게 발동해 회복한 양 */
  defenderBerryHealAmount?: number;
  /** defenderBerryHealAmount를 준 도구 이름 */
  defenderBerryHealItemName?: string;
  /** 정전기/불꽃몸처럼 방어측 특성이 발동해 공격자에게 주 상태이상을 걸었으면 그 상태이상 */
  abilityInflictedStatusOnAttacker?: StatusConditionState["condition"];
  /** abilityInflictedStatusOnAttacker를 건 특성 이름 */
  abilityInflictedStatusAbilityName?: string;
  /** 헤롱헤롱바디처럼 방어측 특성이 발동해 공격자에게 행동방해(volatile)를 걸었으면 그 종류 */
  abilityInflictedVolatileOnAttacker?: VolatileCondition;
  /** abilityInflictedVolatileOnAttacker를 건 특성 이름 */
  abilityInflictedVolatileAbilityName?: string;
  /** 까칠한피부처럼 방어측 특성이 발동해 공격자에게 고정 데미지를 줬으면 그 양 */
  abilityDamageToAttacker?: number;
  /** abilityDamageToAttacker를 준 특성 이름 */
  abilityDamageAbilityName?: string;
  /** 저주받은바디처럼 방어측 특성이 발동해 공격자가 방금 쓴 기술을 봉인(PP 0)했으면 그 기술 이름 */
  abilityDisabledMoveName?: string;
  /** abilityDisabledMoveName을 봉인시킨 특성 이름 */
  abilityDisableAbilityName?: string;
  /** 나쁜손버릇으로 피격측이 공격자에게서 빼앗은 도구 이름 */
  pickpocketStolenItemName?: string;
  /** pickpocketStolenItemName을 빼앗은 특성 이름(나쁜손버릇) */
  pickpocketAbilityName?: string;
  /** 미라로 공격자의 특성을 바꿨으면 그 특성 이름(=미라) */
  mummifiedAttackerAbilityName?: string;
  /** 심플빔류로 상대 특성을 바꿨으면 바뀐 특성 이름 */
  abilitySwappedTargetToName?: string;
  /** 심플빔류를 썼으나 상대가 이미 그 특성이라 실패했으면 true */
  abilitySwapFailed?: boolean;
  /** 볼가득넣기로 먹은 나무열매 이름 */
  ateBerryName?: string;
  /** 볼가득넣기로 먹은 나무열매가 HP를 회복시켰으면 그 회복량 */
  ateBerryHeal?: number;
  /** 볼가득넣기를 썼으나 지닌 나무열매가 없어 실패했으면 true */
  berryEatFailed?: boolean;
  /** 지구력·깨어진갑옷처럼 방어측 특성이 피격 시 자기 랭크를 바꿨으면 그 특성 이름 */
  abilityRaisedDefenderStatsAbilityName?: string;
  /** abilityRaisedDefenderStatsAbilityName이 올린 스탯·폭 */
  abilityRaisedDefenderStats?: { stat: BattleStatKey; delta: number }[];
  /** 깨어진갑옷처럼 같은 발동에서 내려간 스탯·폭(delta는 내려간 칸 수, 양수). 랭크업과 별도 줄로 표시 */
  abilityLoweredDefenderStats?: { stat: BattleStatKey; delta: number }[];
  /** 타오르는불꽃/피뢰침처럼 방어측 특성이 이 기술의 타입을 통째로 무효화했으면 그 타입 */
  abilityAbsorbedMoveType?: PokemonType;
  /** abilityAbsorbedMoveType을 무효화한 특성 이름 */
  abilityAbsorbAbilityName?: string;
  /** 방음처럼 방어측 특성이 이 소리 기술을 완전히 무효화했으면 그 특성 이름 */
  soundproofBlockedByAbilityName?: string;
  /** 저수처럼 absorbsType이 랭크업 대신 회복을 줄 때, 그 회복량 */
  abilityAbsorbHealAmount?: number;
  /** 흑안개처럼 이 행동으로 양쪽의 능력 랭크 변화가 전부 초기화됐으면 true */
  resetAllStages?: boolean;
  /** 매지션으로 이번 행동에서 상대에게 빼앗은 도구 이름 */
  stolenItemName?: string;
  /** 곡예 — 이번 행동으로 자신(행동 주체)의 도구가 사라져서 발동했으면 그 특성 이름 */
  unburdenSelfAbilityName?: string;
  /** 곡예 — 이번 행동으로 상대의 도구가 사라져서 발동했으면 그 특성 이름 */
  unburdenOpponentAbilityName?: string;
  /** 잠꼬대로 대신 발동시킨 기술 이름(잠꼬대 자신이 아니라 이 이름이 실제로 나간 기술) */
  sleepTalkCalledMoveName?: string;
  /** 변환자재로 자신의 타입이 이번 기술의 타입으로 바뀌었으면 그 타입 */
  changedOwnTypeTo?: PokemonType;
  /** changedOwnTypeTo를 발동시킨 특성 이름 */
  changedOwnTypeAbilityName?: string;
  /** 탈(Disguise)처럼 방어측 특성이 이번 데미지를 통째로 무효화했으면 그 특성 이름 */
  hitNegatedByAbilityName?: string;
  /** hitNegatedByAbilityName이 발동하며(=탈이 벗겨지며) 방어측이 입은 반동 데미지 */
  disguiseRecoilDamage?: number;
  /**
   * 길동무: 이 행동(공격측의 공격)으로 상대가 쓰러졌는데, 상대가 길동무 예약 상태였어서
   * 공격측도 같이 쓰러졌으면 true. fainted/selfFainted 둘 다 이미 true로 채워지지만, UI가
   * "왜 같이 쓰러졌는지" 전용 문구를 보여줄 수 있게 별도 플래그로 남긴다.
   */
  triggeredDestinyBond?: boolean;
}

/** 턴 종료 시 상태이상 데미지 로그 */
export interface EndOfTurnLogEntry {
  actor: FighterKey;
  damage: number;
  remainingHp: number;
  fainted: boolean;
  /** 그래스필드 회복이면 damage가 음수(회복량)로 채워지는 대신, 이 필드로 회복량을 명시한다 */
  fieldHeal?: number;
  /** 하품(졸음) 2턴 카운터가 다 돼서 이번 턴 종료 시 실제로 잠들었으면 채워진다 */
  inflictedDelayedStatus?: StatusConditionState["condition"];
  /** 탈피처럼 턴 종료 시 특성으로 자신의 상태이상이 나았으면 그 상태이상 */
  abilityCuredStatus?: StatusConditionState["condition"];
  /** abilityCuredStatus를 치료한 특성 이름 */
  abilityCuredStatusAbilityName?: string;
  /** damage가 상태이상 매턴 데미지일 때(독/맹독/화상) 어떤 상태이상인지 — UI가 문구를 골라 쓰는 데 필요 */
  statusCondition?: StatusConditionState["condition"];
  /** 먹다남은음식으로 회복했으면 그 회복량 */
  itemHeal?: number;
  /** itemHeal을 준 도구 이름 */
  itemHealItemName?: string;
  /** 젖은접시처럼 날씨 조건부로 회복하는 특성이 준 회복량 */
  abilityWeatherHeal?: number;
  /** abilityWeatherHeal을 준 특성 이름 */
  abilityWeatherHealAbilityName?: string;
  /** 뿌리박기/아쿠아링으로 회복했으면 그 회복량(큰뿌리 배율 반영 후) */
  regenHeal?: number;
  /** regenHeal이 어느 지속 효과에서 왔는지 */
  regenSource?: "ingrain" | "aquaRing";
  /** 씨뿌리기로 이번 턴 잃은 HP(씨앗이 걸린 쪽의 로그) */
  leechSeedDamage?: number;
  /** 씨뿌리기로 상대에게서 흡수해 회복한 양(시드를 심은 쪽의 로그, 큰뿌리 배율 반영 후) */
  leechSeedHealAmount?: number;
  /** 희망사항이 발동해 회복한 양 */
  wishHeal?: number;
  /** 자뭉열매/오랭열매가 턴 종료 시점에 발동해 회복한 양 */
  berryHeal?: number;
  /** berryHeal을 준 도구 이름 */
  berryHealItemName?: string;
  /** 가속(Speed Boost)처럼 턴 종료 시 특성으로 스피드가 1랭크 상승했으면 그 특성 이름 */
  speedBoostAbilityName?: string;
  /** speedBoostAbilityName이 있는데 이미 스피드 +6이라 실제로는 안 올랐으면 true — "더 이상 올라가지 않는다!" 문구용 */
  speedBoostAtCap?: boolean;
  /** 변덕쟁이: 턴 종료 시 랜덤 능력이 2랭크 올랐으면 [올라간 스탯, 내려간 스탯]과 특성 이름 */
  moodyRaisedStat?: BattleStatKey;
  moodyLoweredStat?: BattleStatKey;
  moodyAbilityName?: string;
  /** 포이즌힐: 독·맹독 데미지 대신 회복한 양 */
  poisonHealAmount?: number;
  /** poisonHealAmount를 준 특성 이름 */
  poisonHealAbilityName?: string;
  /** 건조피부: 쾌청 등 날씨로 턴 종료 시 입은 피해량(특성 기인) */
  abilityWeatherDamage?: number;
  /** abilityWeatherDamage를 준 특성 이름 */
  abilityWeatherDamageAbilityName?: string;
  /** 모래바람 틱 데미지면 true (damage에 실제 수치) — §1 F-3 */
  sandstormDamage?: boolean;
  /** 속박(조이기·집게덫류) 지속 데미지면 true (damage에 실제 수치) */
  boundDamage?: boolean;
  /** 멸망의노래 카운트 안내(F-4) — 이번 턴 종료 시점의 남은 카운트(3→2→1) */
  perishCount?: number;
  /** 멸망의노래 카운트가 0에 도달해 이번 턴 종료에 쓰러졌으면 true */
  perishFainted?: boolean;
}

export interface TurnResult {
  turnNumber: number;
  /** 이번 턴 실제로 먼저 행동한 쪽 */
  order: [FighterKey, FighterKey];
  actions: ActionLogEntry[];
  endOfTurn: EndOfTurnLogEntry[];
  /**
   * 어느 한쪽(또는 양쪽) HP가 0 이하가 되면 채워짐. 자폭류(selfFaints)로 상대를 쓰러뜨리면서
   * 자신도 같이 기절하거나, 턴 종료 상태이상 데미지로 양쪽이 동시에 0이 되면 "draw".
   */
  winner?: FighterKey | "draw";
  /** 이번 턴이 끝난 시점의 필드 상태. 필드가 없으면 undefined */
  field?: FieldKind;
  /** field가 있을 때, 다음 턴을 포함해 앞으로 몇 턴 더 지속되는지 (0이 되면 이번 턴에 사라짐) */
  fieldTurnsRemaining?: number;
  /** 이번 턴에 필드가 5턴을 다 채우고 사라졌으면 true */
  fieldExpired?: boolean;
  /** 이번 턴이 끝난 시점에 트릭룸이 걸려있으면, 앞으로 몇 턴 더 지속되는지 */
  trickRoomTurnsRemaining?: number;
  /** 이번 턴에 트릭룸이 5턴을 다 채우고 사라졌으면 true */
  trickRoomExpired?: boolean;
  /**
   * 이번 턴이 끝난 시점에 날씨가 유한 지속시간으로 걸려있으면(기술로 걸었으면) 앞으로 몇 턴
   * 더 지속되는지. 날씨가 아예 없으면(weather도 undefined) 이 값도 undefined.
   */
  weatherTurnsRemaining?: number;
  /** 이번 턴에 날씨가 지속시간을 다 채우고 사라졌으면 true */
  weatherExpired?: boolean;
  /** 이번 턴에 사라진 스크린(리플렉터/빛의장막) 목록 — 양쪽에 동시에 걸려있을 수 있어 배열 */
  expiredScreens: { actor: FighterKey; screen: "reflect" | "lightScreen" | "auroraVeil" }[];
  /** 턴 시작 시점에 발생한 안내 문구(의태 타입 변화 등). 없으면 빈 배열 */
  turnStartAnnouncements: string[];
}

function isFainted(fighter: BattleFighterState): boolean {
  return fighter.currentHp <= 0;
}

function cloneFighter(fighter: BattleFighterState): BattleFighterState {
  return {
    ...fighter,
    stages: { ...fighter.stages },
    statStagesAtTurnStart: fighter.statStagesAtTurnStart ? { ...fighter.statStagesAtTurnStart } : undefined,
    accuracyStages: { ...fighter.accuracyStages },
    status: { ...fighter.status },
    volatile: { active: { ...fighter.volatile.active } },
    remainingPp: { ...fighter.remainingPp },
    usedMoveIds: { ...fighter.usedMoveIds },
    screens: { ...fighter.screens },
    ownMoveTypeBoosts: { ...fighter.ownMoveTypeBoosts },
  };
}

/**
 * 공격자 하나가 기술 하나를 쓰는 걸 처리한다. 명중 판정 → 급소 판정 → 데미지 계산(computeDamage 재사용)
 * → HP 차감 → 기술 자신의 랭크/명중회피/급소 변화 적용 → 상태이상 부여까지 한 번에 끝낸다.
 * evaluateSlotMatchup과 같은 하위 재료(특성 배율/자속/타입상성)를 그대로 재사용한다.
 */
function resolveAction(
  state: BattleState,
  actorKey: FighterKey,
  move: Move,
  random: () => number,
  movesSecond: boolean,
  defenderMove: Move,
): ActionLogEntry {
  const defenderKey = opponentKey(actorKey);
  // 매직미러 반사 구간에서만 이 바인딩들을 통째로 맞바꾼다(let). 그 외에는 사실상 const처럼 쓰인다.
  let attacker = state[actorKey];
  let defender = state[defenderKey];

  // 길동무: "다음 자신의 턴이 오면(행동불능인 턴 포함) 예약이 사라진다"는 본가 규칙 — 이 공격자의
  // 이번 턴 처리가 막 시작된 시점에 지난 턴 걸어둔 예약을 무조건 지운다. 이번 턴 다시 길동무를
  // 걸면(아래 protectEffect 판정 성공 시) 새로 켠다.
  attacker.destinyBondArmed = false;

  // 차지 기술 2턴째: 준비 턴에 저장해둔 기술을 이번 턴 실제로 고른 기술과 무관하게 강제로
  // 재실행한다(본가 규칙 — UI에서도 이 경우 선택을 요구하지 않는다). PP는 준비 턴에 이미
  // 소모했으니 여기선 다시 깎지 않는다.
  const releasingCharge = attacker.chargingMoveId !== undefined;
  if (releasingCharge) {
    const storedMove = getMove(attacker.chargingMoveId!);
    if (storedMove) move = storedMove;
    attacker.chargingMoveId = undefined;
  }

  // 일찍기상(잠듦 해제 확률 스케줄에 필요)·습기(자폭기 차단, 아래 0번)는 상태이상 판정보다도
  // 먼저 필요해서, attackerAbility/defenderAbility 전체를 원래보다 앞당겨 여기서 구해둔다.
  const attackerHasEarlyBird = attacker.effectiveAbilityId === "일찍기상";
  // attackerAbility/defenderAbility도 매직미러 반사 구간에서 attacker/defender와 함께 맞바뀐다(let).
  let attackerAbility = attacker.effectiveAbilityId ? getAbility(attacker.effectiveAbilityId) : undefined;
  const rawDefenderAbility = defender.effectiveAbilityId ? getAbility(defender.effectiveAbilityId) : undefined;
  // 틀깨기: 공격측이 이 특성이면 예외 목록에 없는 한 방어측 특성 전체를 무효화한다 — 이 지점에서
  // 한 번만 치환해두면 modifiers·absorbsType·hitTrigger·blocksOpponentStatDropsForStats 등
  // defenderAbility를 참조하는 아래 코드 전부가 자동으로 반영된다. (매직미러도 이 예외 목록에서
  // 빠져 있어, 공격측이 틀깨기면 여기서 defenderAbility가 undefined가 되고 반사도 자연히 무산된다.)
  let defenderAbility = resolveEffectiveDefenderAbility(attackerAbility, rawDefenderAbility);

  // 긴장감: "이 특성을 가진 쪽의 상대"가 나무열매를 못 쓴다 — 방향이 헷갈리기 쉬운데, 내(공격측)
  // 나무열매가 막히는 건 상대(방어측)가 긴장감을 가졌을 때고, 상대(방어측) 나무열매가 막히는 건
  // 내(공격측)가 긴장감을 가졌을 때다. defenderAbility는 이미 틀깨기가 반영된 값이라(긴장감은
  // 틀깨기 예외 목록에 없음), 틀깨기 소유자가 공격하면 상대의 긴장감도 자연히 무시된다.
  const attackerBerriesBlocked = !!defenderAbility?.preventsOpponentBerries;
  const defenderBerriesBlocked = !!attackerAbility?.preventsOpponentBerries;

  // 곡예: "도구를 잃은 순간" 발동 여부를 판정하려면 이번 행동 시작 시점의 currentItemId를
  // 미리 기억해둬야 한다(행동 도중 나무열매 소모나 매지션 강탈로 값이 바뀔 수 있어서).
  const attackerItemIdBeforeAction = attacker.currentItemId;
  const defenderItemIdBeforeAction = defender.currentItemId;

  // PP 소모는 행동 여부와 무관하게 발생(단, 차지 기술 2턴째는 위에서 이미 스킵 처리)
  let leppaRestoredPpItemName: string | undefined;
  if (!releasingCharge && attacker.remainingPp[move.id] !== undefined) {
    const ppBefore = attacker.remainingPp[move.id];
    attacker.remainingPp[move.id] = Math.max(0, ppBefore - 1);
    // 과사열매: 이번 사용으로 PP가 정확히 0이 됐을 때(원래 0이던 걸 또 쓴 게 아니라)만 발동한다.
    if (
      ppBefore > 0 &&
      attacker.remainingPp[move.id] === 0 &&
      !attacker.itemConsumed &&
      !attackerAbility?.disablesOwnItemEffects &&
      !defenderBerriesBlocked
    ) {
      const itemForPp = attacker.currentItemId ? getItem(attacker.currentItemId) : undefined;
      // 과사열매도 나무열매라 긴장감에 막힌다(위 조건에서 이미 확인) — restoresPpOnZero 자체가
      // 나무열매 전용 필드라 별도 태그 없이도 이 게이트 하나로 충분하다.
      if (itemForPp?.restoresPpOnZero) {
        attacker.remainingPp[move.id] = Math.min(move.pp, itemForPp.restoresPpOnZero);
        consumeItem(attacker);
        leppaRestoredPpItemName = itemForPp.name;
      }
    }
  }

  // 프레셔: 상대(defender)가 이 특성이면, 자신을 향한 기술이든 자기 자신에게 쓰는 변화기든
  // 가리지 않고(본가 규칙 — 프레셔는 "이 포켓몬이 필드에 있는 동안 상대가 쓰는 모든 기술"에
  // 적용된다) PP를 추가로 더 소모시킨다. 과사열매 재판정 없이 단순 차감만 한다.
  let pressureExtraPpAbilityName: string | undefined;
  if (defenderAbility?.extraPpCostWhenTargeted && !releasingCharge && attacker.remainingPp[move.id] !== undefined) {
    const before = attacker.remainingPp[move.id];
    attacker.remainingPp[move.id] = Math.max(0, before - defenderAbility.extraPpCostWhenTargeted);
    if (attacker.remainingPp[move.id] !== before) pressureExtraPpAbilityName = defenderAbility.name;
  }

  const blocked = (
    reason: ActionBlockReason,
    selfDamage = 0,
    extra?: Partial<ActionLogEntry>,
  ): ActionLogEntry => ({
    actor: actorKey,
    move,
    blockedReason: reason,
    hit: false,
    critical: false,
    damage: 0,
    damagePercent: 0,
    typeEffectiveness: 1,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    fainted: false,
    selfFainted: isFainted(attacker),
    recoilDamage: 0,
    leppaRestoredPpItemName,
    pressureExtraPpAbilityName,
    ...extra,
  });

  // 0) 사용 조건이 있는 기술(코골기=잠든 상태 전용, 속이기=첫 턴 전용). 상태이상/행동방해
  // 판정보다 먼저 확인한다 — 조건 자체를 못 채우면 애초에 시도조차 안 한 것으로 취급.
  // 첫 턴 전용은 1v1 시뮬레이터에 교체가 없으니 배틀 전체의 1턴째로 취급한다.
  if (move.usageCondition === "first-turn-only" && state.turnNumber !== 1) {
    return blocked("usageCondition");
  }
  // 아이언롤러: 활성화된 필드가 하나도 없으면 실패한다(본가 규칙)
  if (move.usageCondition === "field-required" && !state.field) {
    return blocked("usageCondition");
  }
  // 오로라베일: 지정된 날씨(눈)가 아니면 실패한다
  if (move.usageCondition === "weather-required" && activeWeather(state) !== move.requiresWeather) {
    return blocked("usageCondition");
  }
  // 비장의무기: 자신의 다른 기술(remainingPp에 등록된 id들)을 전부 한 번씩 사용하기 전까지는 실패.
  if (move.usageCondition === "all-other-moves-used") {
    const otherMoveIds = Object.keys(attacker.remainingPp).filter((id) => id !== move.id);
    const allUsed = otherMoveIds.every((id) => attacker.usedMoveIds?.[id]);
    if (!allUsed) return blocked("usageCondition");
  }
  // 토해내기: 비축 스택이 0이면 쓸 수 없다.
  if (move.spitUpPower && (attacker.stockpileCount ?? 0) === 0) {
    return blocked("usageCondition");
  }
  // 비축하기: 이미 3스택이면 더 비축할 수 없다(본가 규칙 — 실패 처리).
  if (move.addsStockpile && (attacker.stockpileCount ?? 0) >= 3) {
    return blocked("usageCondition");
  }
  // 기습: 상대보다 먼저 움직이지 않으면(movesSecond) 실패, 상대가 이번 턴 고른 기술이
  // 데미지 기술(물리/특수)이 아니면(=변화기를 냈거나, 자기 자신의 usageCondition 미충족 등으로
  // 어차피 데미지를 안 낼 예정이면) 실패한다. 본가 규칙과 동일하게 defenderMove의 category만
  // 보고 판정 — 상대가 상태이상으로 실제 행동에 실패할지 여부까지는 반영하지 않는다(동시 비공개
  // 선택 방식이라 이 시뮬레이터 구조상 그 정보까지 반영하려면 판정 순서 자체를 바꿔야 함).
  if (
    move.usageCondition === "opponent-damaging-move-only" &&
    (movesSecond || (defenderMove.category !== "physical" && defenderMove.category !== "special"))
  ) {
    return blocked("usageCondition");
  }
  // 습기: 자신이든 상대든 이 특성이 있으면 자폭류 기술(대폭발 등) 자체를 쓸 수 없다.
  if (move.selfFaints && (attackerAbility?.preventsSelfFaintMoves || defenderAbility?.preventsSelfFaintMoves)) {
    return blocked("usageCondition");
  }

  // 1) 주 상태이상(잠듦/얼음/마비)으로 행동 자체가 막히는지. 잠듦/얼음은 이 판정 안에서
  // 자체 해제 카운터가 갱신되므로 결과를 attacker.status에 반드시 반영해야 한다.
  // 코골기처럼 "잠든 상태에서만" 쓸 수 있는 기술은 본가에서 잠듦이 행동을 막는 예외라,
  // 일반 잠듦 차단을 건너뛰고 별도로 처리한다 — 해제 판정/카운터 자체는 그대로 진행시킨다.
  const preActionStatus = attacker.status.condition;
  let selfCuredStatus: StatusConditionState["condition"] | undefined;

  // 1-1) 불사르기·열사의대지·플레어드라이브 등 "사용 직전 사용자의 얼음 상태를 치유한다" 기술은
  // 매턴 해제 확률 판정 없이 무조건 먼저 해동된 뒤 기술이 정상적으로 나간다.
  if (attacker.status.condition === "freeze" && move.thawsUserOnUse) {
    attacker.status = { ...NO_STATUS_CONDITION };
    selfCuredStatus = "freeze";
  } else if (move.usageCondition === "sleep-only") {
    if (attacker.status.condition !== "sleep") return blocked("usageCondition");
    const wakeCheck = checkStatusActionBlock(attacker.status, random, attackerHasEarlyBird);
    attacker.status = wakeCheck.nextState;
    // 이 판정으로 잠에서 깼다면 이번 턴은 이미 깬 상태이므로 사용 조건이 깨진 것으로 처리한다.
    if (attacker.status.condition !== "sleep") return blocked("usageCondition");
  } else {
    const statusCheck = checkStatusActionBlock(attacker.status, random, attackerHasEarlyBird);
    attacker.status = statusCheck.nextState;
    if (statusCheck.blocked) return blocked("status", 0, { blockedByStatus: preActionStatus ?? undefined });
    // 잠듦/얼음이 이번 판정에서 자연 해제됐으면(매턴 확률 스케줄) 로그에 남긴다 — 물거품아리아 같은
    // 명시적 치료(curesStatus)와는 다른 경로라 여기서 별도로 잡아야 한다.
    if ((preActionStatus === "sleep" || preActionStatus === "freeze") && !attacker.status.condition) {
      selfCuredStatus = preActionStatus;
    }
  }

  // 2) 풀죽음/반동: 1턴짜리 행동방해. 걸려있으면 이번 턴 소모하고 못 움직인다
  if (hasVolatile(attacker.volatile, "flinch")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "flinch");
    return blocked("flinch");
  }
  if (hasVolatile(attacker.volatile, "recharge")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "recharge");
    return blocked("recharge");
  }

  // 2-0) 도발/사슬묶기/앙코르: 이번 턴 고른 기술이 제약을 어기면 실패한다. 차지 기술 2턴째
  // (releasingCharge)는 지난 턴에 이미 확정된 선택이라 이 판정에서 제외한다. 지속 턴수는
  // 막혔는지 여부와 무관하게 전부 이 시점에 1씩 줄어든다(자기 차례마다 한 번씩만 판정되므로
  // 자연히 턴당 1회 소모) — 여러 제약이 동시에 걸려있어도 전부 소모시킨 뒤 첫 번째로 걸린
  // 이유(도발 > 사슬묶기 > 앙코르 순)만 대표로 보고한다.
  if (!releasingCharge) {
    let restrictionBlockedKind: "taunt" | "disable" | "encore" | undefined;
    if (hasVolatile(attacker.volatile, "taunt")) {
      if (move.category === "status") restrictionBlockedKind = "taunt";
      attacker.volatile = consumeVolatileTurn(attacker.volatile, "taunt");
    }
    const disableEntry = attacker.volatile.active.disable;
    if (disableEntry) {
      if (disableEntry.moveId === move.id) restrictionBlockedKind ??= "disable";
      attacker.volatile = consumeVolatileTurn(attacker.volatile, "disable");
    }
    const encoreEntry = attacker.volatile.active.encore;
    if (encoreEntry) {
      if (encoreEntry.moveId !== move.id) restrictionBlockedKind ??= "encore";
      attacker.volatile = consumeVolatileTurn(attacker.volatile, "encore");
    }
    if (restrictionBlockedKind) return blocked("moveRestricted", 0, { moveRestrictionKind: restrictionBlockedKind });
  }

  // 2-1) 사이코필드: 우선도 +1 이상인 기술이 "상대를 겨냥"하면 그 기술 자체가 실패한다.
  // 짓궂은마음으로 변화기 우선도가 올라간 경우도 반영해야 해서 원본 우선도가 아니라 특성
  // 보정을 더한 실제 우선도로 판정한다 — 단, 순풍·리플렉터·빛의장막처럼 상대를 겨냥하지 않는
  // 변화기는 우선도가 올라가 있어도 막히지 않는다(isOpponentTargetingMove가 그 축을 가른다).
  if (isPriorityMoveBlockedByField(state.field, move.priority + getAbilityPriorityBoost(move, attackerAbility), move)) {
    return blocked("psychicFieldPriority");
  }

  // 3) 혼란: 매 행동 판정마다 지속 턴수를 소모하고, 1/3 확률로 자멸(물리 40위력 자가타격)한다.
  // 자멸하면 이번 턴은 그걸로 끝 — 원래 쓰려던 기술은 실행되지 않는다.
  if (hasVolatile(attacker.volatile, "confusion")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "confusion");
    if (random() < CONFUSION_SELF_HIT_CHANCE) {
      const selfHit = computeDamage(attacker.realStats, attacker.realStats, attacker.types, CONFUSION_SELF_HIT_MOVE, {
        randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
      });
      const selfDamage = selfHit?.damage ?? 0;
      attacker.currentHp = Math.max(0, attacker.currentHp - selfDamage);
      return blocked("confusion", selfDamage);
    }
  }

  // 3-1) 헤롱헤롱(매혹): ingrain/leechSeed와 같은 "배틀 끝까지 유지"형이라 턴수를 소모하지 않는다
  // (consumeVolatileTurn 호출 없음 — 교체가 없는 1v1이라 해제될 계기가 없음). 걸려있는 동안 매
  // 행동 판정마다 50% 확률로 그 턴 행동을 통째로 못 한다.
  if (hasVolatile(attacker.volatile, "attract") && random() < ATTRACT_ACTION_BLOCK_CHANCE) {
    return blocked("attract");
  }

  // 4) 차지 기술 1턴째(공중날기 등): 준비만 하고 이번 턴엔 데미지를 주지 않는다. 맑음 날씨의
  // 솔라빔처럼 chargeSkipWeather가 현재 날씨와 일치하면 준비 없이 곧장 2턴째처럼 실행한다.
  // releasingCharge면 이미 2턴째(위에서 move를 저장된 기술로 바꿔치기했음)라 여기 안 들어온다.
  if (move.chargeTurn && !releasingCharge) {
    // 메테오빔·일렉트로빔: 능력치 상승은 "이 기술을 쓴 턴"(=1턴째, 준비 선언 시점) 기준이라
    // chargeSkipWeather로 준비 턴 자체가 생략되는 경우(비 오는 일렉트로빔)에도 여기서 적용한다.
    // move.statChanges(2턴째 공격 판정에서 쓰는 필드)와 겹치지 않게 별도 필드로 받는다.
    if (move.chargeStatChanges) {
      attacker.stages = applyMoveStatChanges(
        attacker.stages,
        { ...move, statChanges: move.chargeStatChanges },
        "self",
        { userTypes: attacker.types },
      );
    }
    const skipsCharge = move.chargeSkipWeather !== undefined && activeWeather(state) === move.chargeSkipWeather;
    if (!skipsCharge) {
      attacker.chargingMoveId = move.id;
      return {
        actor: actorKey,
        move,
        hit: true,
        critical: false,
        damage: 0,
        damagePercent: 0,
        typeEffectiveness: 1,
        defenderRemainingHp: defender.currentHp,
        selfDamage: 0,
        attackerRemainingHp: attacker.currentHp,
        fainted: false,
        selfFainted: false,
        recoilDamage: 0,
        charging: true,
        leppaRestoredPpItemName,
      };
    }
  }

  // 잠꼬대: 여기까지 왔다는 건 잠든 채로 이 기술을 실제로 선택했다는 뜻(usageCondition 게이트를
  // 이미 통과) — 이 시점부터는 잠꼬대 자신 대신 자신이 배운 다른 기술 중 하나를 무작위로 대신
  // 발동시킨다. PP는 잠꼬대 자신만 이미 위에서 소모했고, 대신 나가는 기술의 PP는 건드리지 않는다
  // (본가와 동일). 이 아래로는 move가 그 대신 나간 기술을 가리키므로, 특성 배율/자속/타입상성/
  // 우선도 등 이후의 모든 판정이 자동으로 그 기술 기준으로 이뤄진다.
  let sleepTalkCalledMoveName: string | undefined;
  if (move.callsRandomLearnedMove) {
    const candidates = Object.keys(attacker.remainingPp)
      .map((id) => getMove(id))
      .filter(
        (m): m is Move =>
          !!m && m.id !== move.id && !m.chargeTurn && !m.usageCondition && !m.excludedFromSleepTalk,
      );
    if (candidates.length === 0) {
      // 배운 기술이 잠꼬대 하나뿐이거나 전부 제외 대상이면 대신 낼 기술이 없어 실패한다.
      return blocked("usageCondition");
    }
    const chosen = candidates[Math.floor(random() * candidates.length)];
    sleepTalkCalledMoveName = chosen.name;
    move = chosen;
  }

  // 서투름: 자기 자신의 도구 전투 효과가 무효화된다 — 실제로 지녔는지와 무관하게 이 시점부터는
  // 아예 안 지닌 것처럼 취급한다(메가스톤에 의한 폼 변화는 pokemonForm.ts의 별도 축이라 영향 없음).
  // attackerItem/defenderItem도 매직미러 반사 구간에서 함께 맞바뀐다(let).
  let attackerItem = attackerAbility?.disablesOwnItemEffects
    ? undefined
    : attacker.currentItemId
      ? getItem(attacker.currentItemId)
      : undefined;
  let defenderItem = defenderAbility?.disablesOwnItemEffects
    ? undefined
    : defender.currentItemId
      ? getItem(defender.currentItemId)
      : undefined;

  // 황금몸: 상대(공격측)가 변화기(카테고리 status)를 쓸 때, 그 기술이 "자신(=defender)을 직접
  // 겨냥하는" 효과(상태이상 부여·행동방해·랭크/명중회피/급소 하락)만 전부 무산시킨다. 필드
  // 전역 효과(날씨·필드·트릭룸)나 공격측 자신을 향한 효과(자기 스탯 상승, 자기 스크린 설치)는
  // "이 포켓몬을 겨냥한" 게 아니라서 그대로 적용된다 — 아래 각 opponent 방향 적용 지점에서만
  // 이 플래그로 건너뛴다.
  const blockedByGoodAsGold = move.category === "status" && !!defenderAbility?.blocksOpponentStatusMoveEffects;

  // 대타출동: 방어측이 대타를 세운 상태면, 소리 계열(돌림노래 등 classification "소리") 기술을
  // 제외한 모든 기술의 "opponent 방향" 부가효과(상태이상·랭크/명중회피/급소 하락·행동방해)가
  // 카테고리 무관(데미지기든 변화기든)으로 전부 무산된다 — 황금몸과 달리 status 기술로 한정하지
  // 않는다. 데미지 자체는 무산이 아니라 대타 HP로 흡수(아래 resolveHit 계열에서 별도 처리).
  // 틈새포착: 공격측이 이 특성이면 대타출동도 소리 계열과 마찬가지로 무시하고 본체에 직접 적중한다.
  const blockedBySubstitute =
    defender.substituteHp !== undefined &&
    !(move.classification ?? []).includes("소리") &&
    !attackerAbility?.bypassesScreensAndSubstitute;

  // 가루/포자 기술(수면가루·저리가루·독가루·목화포자·분노가루)은 풀타입 포켓몬에게 통하지 않는다
  // (본가 규칙 — 타입 면역과 같은 축). 방진 특성·방진고글 도구도 막지만 포챔스 로스터엔 없어 생략.
  const blockedByPowderImmunity =
    (move.classification ?? []).includes("가루") && defender.types.includes("풀");

  // 방어/판별/킹실드(protectEffect: "block"): 이번 턴 상대의 공격을 카테고리 무관으로 완전히
  // 무효화한다 — 대타와 달리 데미지를 어디로도 흡수하지 않고 그냥 0으로 만든다(아래 canDealDamage).
  // 버티기(protectEffect: "endure")는 막는 게 아니라 applyEndurance에서 별도로 처리하므로 여기
  // 포함하지 않는다.
  // 고스트다이브: "방어를 무시" = 방어류(protectEffect) 차단 자체를 뚫는다는 뜻(사용자 확인) — 실제
  // 방어 실수치와는 무관해서 여기서 판정 자체를 건너뛴다(틈새포착이 스크린/대타를 뚫는 것과 같은 결).
  const blockedByProtect = !move.bypassesProtect && defender.activeProtect?.effect === "block";
  // "방어로 막혔다!" 문구는 실제로 상대를 겨냥한 기술이 막혔을 때만 — 칼춤·나쁜음모처럼 자기
  // 대상 랭크업/자기 회복기는 방어와 무관하게 그대로 발동하므로 "막혔다"가 아니다(Phase 6.5 §6-2 ⑦).
  const blockedByProtectMoveName =
    blockedByProtect && isOpponentTargetingMove(move) ? defender.activeProtect?.moveName : undefined;
  // 방음: 방어측이 이 특성이면 소리 기술(classification "소리")이 데미지기·변화기 모두 완전히
  // 무효화된다. resolveMoveContext도 같은 판정으로 typeEffectiveness를 0으로 만든다.
  const blockedBySoundproof = !!(
    defenderAbility?.blocksSound && (move.classification ?? []).includes("소리")
  );
  const soundproofBlockedByAbilityName = blockedBySoundproof ? defenderAbility?.name : undefined;
  const opponentEffectsBlocked =
    blockedByGoodAsGold || blockedBySubstitute || blockedByProtect || blockedByPowderImmunity || blockedBySoundproof;

  // 매직미러: 방어측이 이 특성을 지녔고(틀깨기면 위에서 defenderAbility가 이미 undefined), 이번
  // 기술이 방어측을 겨냥하는 status 변화기이며 반사 제외(notReflectable — 고스트 저주·추억의선물·
  // 멸망의노래·흔들흔들댄스)가 아니면, 이 기술을 시전자에게 되돌린다. setsHazard(스텔스록)는
  // isOpponentTargetingMove가 잡지 않아 따로 OR로 포함한다. 되돌린 기술은 빗나가지 않고(아래 hit
  // 강제), "방어측 방향 효과" 블록 진입 직전에 공격/방어 바인딩을 통째로 맞바꿔 원래 시전자에게
  // 효과가 그대로 꽂히게 한다.
  const bouncedByMagicMirror =
    !opponentEffectsBlocked &&
    move.category === "status" &&
    !move.notReflectable &&
    !!defenderAbility?.reflectsOpponentStatusMoves &&
    (isOpponentTargetingMove(move) || !!move.setsHazard);

  // 레이징불: 이 기술을 쓰는 켄타로스의 종(팔데아 3품종)에 따라 실제 타입이 바뀐다. 웨더볼/
  // fieldPulse보다 먼저 반영해야 이후 resolveMoveContext의 상성·자속 계산이 전부 새 타입으로 돈다.
  const speciesTypedType = move.typeByUserSpecies?.[attacker.slot.pokemonId];
  const speciesTypedMove: Move = speciesTypedType ? { ...move, type: speciesTypedType } : move;

  // 셸암즈(dynamicCategoryByHigherDamage) — 가라르야도란 전용기. 물리(공격 vs 상대 방어)와
  // 특수(특공 vs 상대 특방)로 각각 데미지를 계산해 큰 쪽 판정으로 공격한다. 물리면 접촉기,
  // 특수면 비접촉기. 두 값이 같으면 무작위. 도구·특성·날씨 배율은 여기 비교에 넣지 않고(사용자
  // 확정 — "물리/특수 여부를 먼저 판단한 뒤 적용"), 순수 실능·랭크만으로 비교한다.
  let shellSideArmCategory: "physical" | "special" | undefined;
  let categoryResolvedMove: Move = speciesTypedMove;
  if (speciesTypedMove.dynamicCategoryByHigherDamage) {
    const dmgOpts = { attackerStages: attacker.stages, defenderStages: defender.stages };
    const physDmg =
      computeDamage(attacker.realStats, defender.realStats, attacker.types, { ...speciesTypedMove, category: "physical" }, dmgOpts)?.damage ?? 0;
    const specDmg =
      computeDamage(attacker.realStats, defender.realStats, attacker.types, { ...speciesTypedMove, category: "special" }, dmgOpts)?.damage ?? 0;
    shellSideArmCategory = physDmg > specDmg ? "physical" : specDmg > physDmg ? "special" : random() < 0.5 ? "physical" : "special";
    categoryResolvedMove = {
      ...speciesTypedMove,
      category: shellSideArmCategory,
      makesContact: shellSideArmCategory === "physical",
    };
  }

  // 웨더볼(날씨판 대지의파동): 날씨로 타입·위력이 바뀐다. 웨더볼과 fieldPulse를 동시에 갖는
  // 기술은 없어 순차 적용해도 안전하다.
  const weatherBall = applyWeatherBall(categoryResolvedMove, activeWeather(state));
  const moveAfterWeatherBall: Move = { ...categoryResolvedMove, type: weatherBall.type, power: weatherBall.power };

  // 필드 조건부 타입/위력 변경(대지의파동=fieldPulse, 미스트버스트·와이드포스·라이징볼트=
  // powerMultiplierInField)을 특성 배율 계산보다 먼저 반영한다 — 타입이 바뀐 상태여야
  // resolveMoveContext 안의 상성 계산(getEffectiveness)에도 바뀐 타입이 들어간다. 둘 중
  // 한 기술이 두 속성을 동시에 갖는 경우는 없어서(대지의파동만 fieldPulse, 나머지 셋만
  // powerMultiplierInField) 순서·중복 곱셈 걱정 없이 그냥 합쳐도 안전하다.
  const fieldPulse = applyFieldPulse(moveAfterWeatherBall, state.field);
  const fieldPowerMultiplier = getFieldPowerMultiplier(moveAfterWeatherBall, state.field);
  const fieldAdjustedMove: Move = {
    ...moveAfterWeatherBall,
    type: fieldPulse.type,
    power: fieldPulse.power === null ? null : Math.round(fieldPulse.power * fieldPowerMultiplier),
  };

  // evaluateSlotMatchup(1턴 스냅샷 판정)과 같은 로직을 공유 — 특성 배율/타입 변경/자속/상대 상성
  const {
    effectiveMove: contextEffectiveMove,
    abilityOffenseMultiplier,
    abilityDefenseMultiplier,
    stabMultiplier,
    typeEffectiveness,
    absorbedByDefenderAbility,
  } = resolveMoveContext(
    attackerAbility,
    fieldAdjustedMove,
    defender.types,
    defenderAbility,
    activeWeather(state),
    defenderItem,
    attacker.currentHp / attacker.maxHp,
    defender.currentHp === defender.maxHp,
    defender.status.condition !== null,
  );

  // 우격다짐: 데미지 기술에 "상대에게 해로운"(상태이상/행동방해/랭크다운) 또는 "자신에게 이로운"
  // (자기 랭크업) 부가 효과가 있으면 그 효과를 전부 없애는 대신 위력에 배수를 곱한다. 반동
  // (recoilFraction)·자기 디메리트(자기 랭크다운·행동불능 예약 등)는 "부가 효과"가 아니라서
  // 손대지 않는다 — 플레어드라이브가 반동은 그대로 받으면서 화상만 사라지고 위력이 오르는 것과
  // 같은 축(사용자 확인). 급소율(highCritRatio)도 버프/디버프가 아니라 대상이 아니다.
  let effectiveMove = contextEffectiveMove;
  let sheerForceAbilityName: string | undefined;
  if (attackerAbility?.tradesSecondaryEffectForPower && hasSheerForceSecondaryEffect(effectiveMove)) {
    effectiveMove = {
      ...effectiveMove,
      power:
        effectiveMove.power !== null
          ? Math.round(effectiveMove.power * attackerAbility.tradesSecondaryEffectForPower)
          : effectiveMove.power,
      inflictsStatus: undefined,
      // target: "self"인 항목(반동성 자기 예약 등)은 그대로 두고, 상대를 향한 것만 제거한다.
      inflictsVolatile: effectiveMove.inflictsVolatile?.filter((v) => v.target !== "opponent"),
      // 상대 랭크다운(target: opponent)과 자기 랭크업(target: self, delta > 0)만 제거 — 자기
      // 랭크다운(디메리트)은 "부가 효과"가 아니라서 그대로 유지된다.
      statChanges: effectiveMove.statChanges?.filter(
        (s) => !(s.target === "opponent" || (s.target === "self" && (s.delta ?? 0) > 0)),
      ),
    };
    sheerForceAbilityName = attackerAbility.name;
  }

  // 기사회생(Reversal)·바둥바둥(Flail, F-2): power가 null인 채로 오고, 사용자의 현재 HP 비율에 따라 위력이 정해진다.
  if (effectiveMove.reversalPower) {
    effectiveMove = { ...effectiveMove, power: reversalPowerFromHp(attacker.currentHp, attacker.maxHp) };
  }
  // 자이로볼(§3-1a): 상대가 느릴수록 강하다. 자신·상대의 실효 스피드로 위력을 정한다.
  if (effectiveMove.gyroBallPower) {
    effectiveMove = {
      ...effectiveMove,
      power: gyroBallPowerValue(attacker, defender, attackerItem, defenderItem),
    };
  }
  // 기어오르기·어시스트파워(§3-1a): 자신의 양수 랭크 합계로 위력이 오른다.
  if (effectiveMove.powerFromPositiveStages) {
    const { base, perStage } = effectiveMove.powerFromPositiveStages;
    effectiveMove = { ...effectiveMove, power: positiveStagesPowerValue(attacker.stages, base, perStage) };
  }
  // 토해내기(§3 증분 B-3): 위력 = 비축 스택 × 100. 스택·랭크 소비는 아래 usedMoveIds 기록 지점에서.
  if (effectiveMove.spitUpPower) {
    effectiveMove = { ...effectiveMove, power: (attacker.stockpileCount ?? 0) * 100 };
  }
  // 헤비봄버·히트스탬프 / 풀묶기·안다리걸기(§3-6): 몸무게 기반 위력. 메가폼이면 그 폼의 몸무게를
  // 쓴다(getEffectiveForm.weightKg). weightKg 미입력이면 폴백.
  const weightOf = (fighter: BattleFighterState): number | undefined => {
    const pk = getPokemon(fighter.slot.pokemonId);
    const baseKg = pk ? getEffectiveForm(pk, fighter.slot).weightKg : undefined;
    if (baseKg === undefined) return undefined;
    // 헤비메탈(2)·라이트메탈(0.5): 자신의 몸무게에 배율을 곱한다.
    const mult = abilityOf(fighter)?.weightMultiplier ?? 1;
    return baseKg * mult;
  };
  if (effectiveMove.weightRatioPower) {
    const userKg = weightOf(attacker);
    const targetKg = weightOf(defender);
    effectiveMove = {
      ...effectiveMove,
      power:
        userKg !== undefined && targetKg !== undefined
          ? weightRatioPowerValue(userKg, targetKg)
          : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  if (effectiveMove.targetAbsoluteWeightPower) {
    const targetKg = weightOf(defender);
    effectiveMove = {
      ...effectiveMove,
      power: targetKg !== undefined ? absoluteWeightPowerValue(targetKg) : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  // 눈사태·보복·애크러뱃(§3 증분 C): 조건 충족 시 위력 2배.
  // 분풀이("user-stat-lowered-this-turn")·분함의발구르기("user-move-failed-last-turn")는 이번 턴/직전
  // 턴 이력 상태가 엔진에 없어 여기선 항상 미충족(기본 위력)으로 둔다 — 매치업 페이지에서만 충족
  // 상정(§3 증분 B-3, 사용자 지시).
  if (effectiveMove.conditionalDoublePower && effectiveMove.power !== null) {
    const condition = effectiveMove.conditionalDoublePower;
    const met =
      condition === "took-damage-this-turn"
        ? (attacker.damageTakenThisTurn?.physical ?? 0) + (attacker.damageTakenThisTurn?.special ?? 0) > 0
        : condition === "moves-after-target"
          ? movesSecond
          : condition === "user-has-no-item"
            ? !attacker.currentItemId
            : false; // user-stat-lowered-this-turn / user-move-failed-last-turn → 엔진 미추적
    if (met) effectiveMove = { ...effectiveMove, power: effectiveMove.power * 2 };
  }

  // 타오르는불꽃 발동 이후로 자신(=현재 공격자)이 쓰는 그 타입 기술의 위력이 올라있으면 반영.
  // 절대 타입이 null인 기술(발버둥 등)은 boosts 조회 자체를 건너뛴다.
  const ownMoveTypeBoostMultiplier =
    (effectiveMove.type ? attacker.ownMoveTypeBoosts[effectiveMove.type] : undefined) ?? 1;

  // 투쟁심: 상대와 성별이 같으면 ×1.25, 다르면 ×0.75, 어느 한쪽이라도 성별 불명이면 ×1.0.
  const rivalryMultiplier = rivalryDamageMultiplier(attackerAbility, attacker.gender, defender.gender);

  // 메트로놈(연속 같은 기술 위력 증가)용 스트릭 갱신 — 여기까지 왔다는 건 앞의 모든 행동방해
  // 판정(상태이상/풀죽음/반동/혼란/차지 등)을 통과해서 실제로 이 기술을 쓴다는 뜻이라, 명중 여부와
  // 무관하게 여기서 갱신한다(본가 규칙 — 빗나가도 스트릭은 유지되고, 다른 기술을 쓰면 끊긴다).
  attacker.lastMoveStreak = attacker.lastMoveId === effectiveMove.id ? (attacker.lastMoveStreak ?? 1) + 1 : 1;
  attacker.lastMoveId = effectiveMove.id;

  // 비장의무기 사용 조건용 — "이 기술로 행동을 개시했다"를 여기서 기록(명중 여부 무관).
  (attacker.usedMoveIds ??= {})[effectiveMove.id] = true;

  // 비축하기: 스택 +1 (3스택 초과는 위 usageCondition 게이트에서 이미 실패). 방어·특방 랭크업은
  // 데이터의 statChanges로 처리된다.
  if (effectiveMove.addsStockpile) {
    attacker.stockpileCount = Math.min(3, (attacker.stockpileCount ?? 0) + 1);
  }
  // 토해내기: 사용 즉시 비축 스택을 0으로 되돌리고, 비축하기로 올렸던 방어·특방 랭크도 그만큼 내린다.
  // (위에서 이미 스택 수로 위력을 확정한 뒤라 여기서 소비해도 안전.)
  if (effectiveMove.spitUpPower) {
    const spent = attacker.stockpileCount ?? 0;
    attacker.stockpileCount = 0;
    if (spent > 0) {
      attacker.stages = applyStageDelta(applyStageDelta(attacker.stages, "def", -spent), "spd", -spent);
    }
  }

  // 배틀스위치(킬가르도): 여기까지 왔다는 건 이번 기술을 실제로 사용한다는 뜻이라(위 lastMoveStreak
  // 주석과 동일한 근거), 명중 여부와 무관하게 폼이 바뀐다 — 데미지 기술이면 블레이드폼(공격/특공↑),
  // 킹실드(revertMoveId)를 쓰면 실드폼으로 되돌아간다. 그 외 변화기는 폼을 유지한다(본가 규칙 —
  // 킹실드만 실드폼 복귀 트리거고 다른 변화기는 폼에 영향 없음). 이 스탯 재계산은 데미지 계산보다
  // 먼저 일어나야 이번 공격 자체에 새 폼의 실수치가 반영된다.
  if (attacker.stanceChangeForms) {
    const forms = attacker.stanceChangeForms;
    const nextForm: "shield" | "blade" =
      effectiveMove.id === forms.revertMoveId
        ? "shield"
        : effectiveMove.category !== "status"
          ? "blade"
          : (attacker.currentStanceForm ?? "shield");
    if (nextForm !== attacker.currentStanceForm) {
      const nextBaseStats = nextForm === "blade" ? forms.bladeBaseStats : forms.shieldBaseStats;
      attacker.realStats = computeRealStats(nextBaseStats, attacker.slot.points, attacker.slot.nature);
      attacker.currentStanceForm = nextForm;
    }
  }

  // 변환자재: 위와 같은 이유(여기까지 왔다는 건 실제로 이 기술을 쓴다는 뜻)로, 명중 여부와 무관하게
  // 자신의 타입이 이 기술의 타입으로 바뀐다(사용자 확인 — 실제로 타입이 바뀌어서 이후 턴 방어에도
  // 반영된다). attacker.types를 그 자리에서 통째로 갈아치우는 것뿐이라 이후 이 값을 읽는 모든
  // 곳(이번 턴의 자속 판정은 물론, 다음 턴 이 포켓몬이 방어측이 될 때 defender.types로 쓰이는 것
  // 까지)에 자동으로 반영된다. 발버둥처럼 타입이 없는(null) 기술은 바뀌지 않는다(본가와 동일).
  let changedOwnTypeTo: PokemonType | undefined;
  let changedOwnTypeAbilityName: string | undefined;
  if (attackerAbility?.changesUserTypeToMoveType && effectiveMove.type) {
    attacker.types = [effectiveMove.type];
    changedOwnTypeTo = effectiveMove.type;
    changedOwnTypeAbilityName = attackerAbility.name;
  }

  // 반짝가루(방어측 0.9배)·광각렌즈(공격측 1.1배)·포커스렌즈(공격측, 늦게 움직일 때 1.2배)·
  // 모래숨기(방어측, 날씨 조건부 0.8배)·복안(공격측 1.3배)을 전부 한 배율로 곱한다.
  const weatherAccuracyBoost = defenderAbility?.weatherOpponentAccuracyMultiplier;
  const abilityAccuracyMultiplier =
    (weatherAccuracyBoost && weatherAccuracyBoost.weather === activeWeather(state) ? weatherAccuracyBoost.multiplier : 1) *
    (attackerAbility?.userAccuracyMultiplier ?? 1);
  const accuracyExtraMultiplier =
    getItemAccuracyMultiplier(attackerItem, defenderItem, movesSecond) * abilityAccuracyMultiplier;
  // 날카로운눈: 공격측이 이 특성이면 상대의 회피율 상승분을 무시한다(원문 "상대의 회피율을
  // 무시하고 공격한다") — 다만 회피율이 마이너스인 경우(오히려 공격측에게 유리)는 그대로
  // 존중한다. 0 이하로 클램프하지 않고 min(evasion, 0)만 적용하면 두 조건을 동시에 만족한다.
  // 성스러운칼은 원문이 방어/특방과 나란히 "회피율 랭크 변화를 무시"라고 못박아서 날카로운눈과
  // 달리 방향 구분 없이 완전히 0으로 취급한다(천진식 전면 무시와 같은 결).
  const effectiveDefenderEvasion = attackerAbility?.ignoresOpponentEvasionBoost
    ? Math.min(defender.accuracyStages.evasion, 0)
    : effectiveMove.ignoresDefenderStatStagesInDamage
      ? 0
      : defender.accuracyStages.evasion;
  const hitChance =
    // 노가드: 어느 한쪽이라도 지녔으면 이번 공격은 명중률/회피율과 무관하게 반드시 명중한다.
    attackerAbility?.alwaysHits || defenderAbility?.alwaysHits
      ? null
      : computeHitChance(
          effectiveMove.accuracy,
          attacker.accuracyStages.accuracy,
          effectiveDefenderEvasion,
          accuracyExtraMultiplier,
        );

  // 상대가 차지 기술 준비 턴(공중날기 등)으로 무적인 동안엔, bypassesHiding에 이 무적 종류가
  // 포함된 기술이 아닌 이상 조건 없이 빗나간다 — 명중률 굴림 자체를 건너뛴다.
  // 단, 상대를 겨냥하지 않는 기술(칼춤·방어·광합성 등 자기 대상)은 애초에 "빗나갈" 대상이 아니라서
  // 무적과 무관하게 정상 발동한다(§1 E-1 버그 수정).
  const defenderHideType = defender.chargingMoveId ? getMove(defender.chargingMoveId)?.chargeHideType : undefined;
  const evadedByCharge =
    !!defenderHideType &&
    !(effectiveMove.bypassesHiding ?? []).includes(defenderHideType) &&
    isOpponentTargetingMove(effectiveMove);

  // 매직미러로 되돌릴 기술은 명중 굴림을 건너뛴다(반사는 빗나가지 않는다).
  const hit = bouncedByMagicMirror
    ? true
    : evadedByCharge
      ? false
      : hitChance === null
        ? true
        : random() < hitChance;

  // 철제광선: "사용하는 순간" 명중·빗나감과 무관하게 사용자가 최대 HP의 절반을 잃는다(E-3).
  let selfDamageOnUse = 0;
  if (effectiveMove.selfDamageFractionOnUse !== undefined) {
    selfDamageOnUse = Math.floor(attacker.maxHp * effectiveMove.selfDamageFractionOnUse);
    attacker.currentHp = Math.max(0, attacker.currentHp - selfDamageOnUse);
  }

  if (!hit) {
    // 자폭류(대폭발 등)는 빗나가도 사용자가 반드시 기절한다 (본가 규칙). 데미지가 아예 없는
    // 경로라 승자 판정에 영향을 줄 순서 문제도 없다 — 그냥 여기서 바로 처리해도 된다.
    if (effectiveMove.selfFaints) {
      attacker.currentHp = 0;
    }
    // 무릎차기: 빗나가면 사용자가 최대 HP 절반을 잃는다(E-2). "의욕이 넘쳐 땅에 부딪혔다!"
    let crashDamage = 0;
    if (effectiveMove.crashFraction !== undefined) {
      crashDamage = Math.floor(attacker.maxHp * effectiveMove.crashFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - crashDamage);
    }
    return {
      actor: actorKey,
      move,
      hit,
      critical: false,
      damage: 0,
      damagePercent: 0,
      typeEffectiveness,
      defenderRemainingHp: defender.currentHp,
      selfDamage: 0,
      attackerRemainingHp: attacker.currentHp,
      fainted: false,
      selfFainted: isFainted(attacker),
      recoilDamage: 0,
      evadedByCharge,
      crashDamage: crashDamage || undefined,
      selfDamageOnUse: selfDamageOnUse || undefined,
      leppaRestoredPpItemName,
    };
  }

  // 타오르는불꽃/피뢰침: 명중한 시점에 카테고리 무관(상태이상 기술도 포함)으로 발동한다 — 위에서
  // 이미 typeEffectiveness를 0으로 덮어써놨으니 데미지 계산 쪽은 자연히 0이 되고, 여기서는
  // 그 즉시 랭크 변화 + (있다면) 자기 타입 기술 위력 상승 플래그만 별도로 적용하면 된다.
  let abilityAbsorbedMoveType: PokemonType | undefined;
  let abilityAbsorbAbilityName: string | undefined;
  let abilityAbsorbHealAmount = 0;
  if (absorbedByDefenderAbility && defenderAbility?.absorbsType) {
    const absorb = defenderAbility.absorbsType;
    abilityAbsorbedMoveType = absorb.type;
    abilityAbsorbAbilityName = defenderAbility.name;
    if (absorb.selfStatChanges) {
      for (const change of absorb.selfStatChanges) {
        defender.stages = applyStageDelta(defender.stages, change.stat, contraryDelta(defender, change.delta));
      }
    }
    if (absorb.boostsOwnMoveTypeMultiplier) {
      defender.ownMoveTypeBoosts = { ...defender.ownMoveTypeBoosts, [absorb.type]: absorb.boostsOwnMoveTypeMultiplier };
    }
    // 저수: 랭크업 대신 무효화한 그 즉시 최대 HP 비율만큼 회복한다.
    if (absorb.healsFraction) {
      abilityAbsorbHealAmount = Math.min(
        defender.maxHp - defender.currentHp,
        Math.floor(defender.maxHp * absorb.healsFraction),
      );
      defender.currentHp += abilityAbsorbHealAmount;
    }
  }

  // 킹실드/니들가드: 접촉기를 막아냈을 때만 공격측에게 반동을 건다 — 킹실드는 랭크변화(공격 -1),
  // 니들가드는 최대 HP 1/8 데미지. 막지 못했거나(blockedByProtect === false) 접촉기가 아니면 없다.
  let protectContactPenaltyMoveName: string | undefined;
  let protectContactDamage = 0;
  if (blockedByProtect && defender.activeProtect && (effectiveMove.makesContact ?? false)) {
    const ap = defender.activeProtect;
    if (ap.contactPenalty) {
      attacker.stages = applyStageDelta(attacker.stages, ap.contactPenalty.stat, contraryDelta(attacker, ap.contactPenalty.delta));
      protectContactPenaltyMoveName = ap.moveName;
    }
    // 니들가드 접촉 데미지 — 공격측이 매직가드면 무효(까칠한피부·록키헬멧과 같은 축).
    if (ap.contactDamageFraction && !attackerAbility?.negatesIndirectDamage) {
      const amount = Math.floor(attacker.maxHp * ap.contactDamageFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      protectContactDamage = amount;
      protectContactPenaltyMoveName = ap.moveName;
    }
  }

  // status 기술(도깨비불·최면술 등 위력 없는 변화기)은 데미지 계산을 건너뛴다.
  // 예전엔 여기서 바로 return 해버려서 이런 기술들의 랭크변화/상태이상 부여가 전혀 발동하지 않는
  // 버그가 있었다 — 명중만 하면 데미지 유무와 무관하게 아래 효과 적용까지 항상 도달해야 한다.
  // 나이트헤드처럼 fixedDamage 기술은 power가 null(가변형과 동일한 "수치 없음" 표기)이라
  // power !== null 조건만으로는 걸러진다 — fixedDamage가 있으면 power 유무와 무관하게 데미지 기술로 취급한다.
  const isDamaging =
    effectiveMove.category !== "status" &&
    (effectiveMove.power !== null || effectiveMove.fixedDamage !== undefined);
  // 나무열매(카리열매 등)가 이번 행동 중 발동했으면 그 나무열매 이름 — resolveHit 클로저 안에서 채운다
  let berryReducedDamageItemName: string | undefined;
  let damage = 0;
  let damagePercent = 0;
  let isCritical = false;
  // 트리플악셀처럼 여러 타로 나뉘는 기술만 채운다 — 실제로 명중해서 데미지를 낸 타수.
  let hitCount: number | undefined;

  // 방어측 접촉/피격 트리거 특성(정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디 — Phase 5 §1).
  // 트리플악셀·록블라스트 같은 다단히트 기술은 타수마다 별도로 판정해야 한다(본가 규칙 — 록키헬멧
  // 등 동일 축의 도구도 다단히트 매 타마다 발동) — 그래서 총합 damage가 아니라 아래 triggerAbilityHitEffect를
  // 각 히트 직후(fixedDamage/단일타는 1회, 다단히트는 루프 안에서 타수만큼) 호출해서 채운다.
  let abilityInflictedStatusOnAttacker: StatusConditionState["condition"] | undefined;
  let abilityInflictedStatusAbilityName: string | undefined;
  let abilityInflictedVolatileOnAttacker: VolatileCondition | undefined;
  let abilityInflictedVolatileAbilityName: string | undefined;
  let abilityDamageToAttacker = 0;
  let abilityDamageAbilityName: string | undefined;
  let abilityDisabledMoveName: string | undefined;
  let abilityDisableAbilityName: string | undefined;
  // 나쁜손버릇: 접촉기로 피격당한 방어측이 공격자의 도구를 빼앗았을 때 그 도구 이름과 특성 이름.
  let pickpocketStolenItemName: string | undefined;
  let pickpocketAbilityName: string | undefined;
  // 미라: 접촉기로 피격당한 방어측이 공격자의 특성을 미라로 바꿨을 때 그 특성(=미라) 이름.
  let mummifiedAttackerAbilityName: string | undefined;
  // 지구력·깨어진갑옷처럼 방어측 특성이 피격 시 자기 랭크를 바꿨을 때(Phase 6.5 §6-2 ③ / §6-1).
  // 다단히트면 타수만큼 누적. 오른 스탯과 내려간 스탯을 나눠 담아 로그도 별도 줄로 낸다.
  let abilityRaisedDefenderStatsAbilityName: string | undefined;
  const abilityRaisedDefenderStats: { stat: BattleStatKey; delta: number }[] = [];
  const abilityLoweredDefenderStats: { stat: BattleStatKey; delta: number }[] = [];

  // 지진이 땅속의 구멍파기를, 파도타기가 물속의 다이빙을 실제로 맞혔을 때의 위력 배가.
  // evadedByCharge가 false인데 defenderHideType이 있다는 건 bypassesHiding 예외로 명중했다는 뜻.
  const hidingBypassMultiplier =
    defenderHideType && !evadedByCharge ? (effectiveMove.hidingBypassMultiplier ?? 1) : 1;

  /**
   * 한 번의 "타격"에 대한 급소 판정 + 데미지 계산. 다단히트 기술은 이걸 타수만큼 반복 호출해서
   * 급소를 타수마다 따로 굴린다(사용자 확인) — highCritRatio/alwaysCrit는 항상 원본 기술
   * (effectiveMove) 기준으로 판정하고, hitMove는 트리플악셀처럼 타수별 위력만 다를 때 쓴다.
   */
  function resolveHit(hitMove: Move): { damage: number; isCritical: boolean } {
    // 대운: 급소율 카운터가 상시 +raisesCritStageBy(1). 조가비갑옷/전투무장: 방어측이면 급소 자체가 안 뜬다(alwaysCrit 포함).
    const critStageForHit =
      attacker.critStage + getItemCritStageBonus(attackerItem) + (attackerAbility?.raisesCritStageBy ?? 0);
    const critical =
      !defenderAbility?.preventsCritsAgainstSelf &&
      (effectiveMove.alwaysCrit || random() < critChance(critStageForHit, effectiveMove.highCritRatio));
    const ignoreBurnPenalty = ignoresBurnAttackPenalty(attackerAbility?.id, effectiveMove.id);
    const statusAttackMultiplier = computeStatusAttackMultiplier(
      attacker.status.condition,
      effectiveMove.category,
      ignoreBurnPenalty,
    );
    const weatherMultiplier = getWeatherDamageMultiplier(activeWeather(state), effectiveMove.type);
    const fieldMultiplier = getFieldDamageMultiplier(state.field, effectiveMove.type);
    const itemMultiplier = getItemOffenseMultiplier(
      attackerItem,
      effectiveMove,
      typeEffectiveness,
      attacker.lastMoveStreak ?? 1,
    );
    // 나무열매(카리열매 등): 이 피격이 조건(타입 일치 + 효과가 굉장함)을 채우면 데미지를
    // 절반으로 줄이고 대전 중 1회만 발동하도록 소모 처리한다. 다단히트면 첫 타에서만 소모되고,
    // 이후 타수는 이미 소모된 상태라 다시 발동하지 않는다.
    const berryResult = getBerryDefenseResult(
      defenderBerriesBlocked ? undefined : defenderItem,
      effectiveMove.type,
      typeEffectiveness,
      defender.itemConsumed ?? false,
    );
    if (berryResult.consumed) {
      consumeItem(defender);
      berryReducedDamageItemName = defenderItem?.name;
    }

    // 리플렉터(물리)/빛의장막(특수)/오로라베일(물리·특수 둘 다): 방어측 자기 스크린이 걸려있으면
    // 데미지 반감. 급소는 스크린을 무시한다(본가 규칙) — bulkMultiplier는 나눗셈이라 2를 곱하면
    // 절반이 된다. 틈새포착이면 스크린 자체를 아예 무시한다(급소 판정과 별개로 항상 1배).
    // 오로라베일은 카테고리 전용 스크린과 별개 축이라 둘 다 걸려있으면 곱으로 중첩된다.
    const screenType = effectiveMove.category === "physical" ? "reflect" : "lightScreen";
    const screenBypassed = !!attackerAbility?.bypassesScreensAndSubstitute || critical;
    const categoryScreenActive = !screenBypassed && defender.screens[screenType] !== undefined;
    const auroraVeilActive = !screenBypassed && defender.screens.auroraVeil !== undefined;
    const screenMultiplier = (categoryScreenActive ? 2 : 1) * (auroraVeilActive ? 2 : 1);

    // 관통드릴: 접촉기일 때만 상대 방어/특방 랭크의 "상승분"을 무시한다(날카로운눈의 회피율
    // 처리와 같은 패턴 — 마이너스 랭크는 그대로 페널티로 받는다). 천진(전부 무시)과 겹치면
    // 천진 쪽이 이미 NEUTRAL_STAGES라 이 클램프는 자연히 아무 효과가 없다.
    // 사이코쇼크류(hitsDefensiveStat)는 실제 데미지에 쓰는 방어 스탯이 분류 기본값과 다르므로
    // 그 축(=computeDamage가 실제로 읽는 축)에 클램프를 맞춘다.
    const contactDefenseStat: BattleStatKey =
      effectiveMove.hitsDefensiveStat ?? (effectiveMove.category === "physical" ? "def" : "spd");
    const contactIgnoresDefenseBoost =
      (effectiveMove.makesContact ?? false) &&
      attackerAbility?.contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction !== undefined;
    // 성스러운칼: 천진(특성)과 정확히 같은 축이지만 기술 단위 효과라 여기서 같이 확인한다.
    const baseDefenderStages =
      attackerAbility?.ignoresOpponentStatStagesInDamage || effectiveMove.ignoresDefenderStatStagesInDamage
        ? NEUTRAL_STAGES
        : defender.stages;
    const defenderStagesForDamage =
      contactIgnoresDefenseBoost && baseDefenderStages[contactDefenseStat] > 0
        ? { ...baseDefenderStages, [contactDefenseStat]: 0 }
        : baseDefenderStages;

    const result = computeDamage(attacker.realStats, defender.realStats, attacker.types, hitMove, {
      typeEffectiveness,
      abilityMultiplier:
        abilityOffenseMultiplier *
        statusAttackMultiplier *
        hidingBypassMultiplier *
        ownMoveTypeBoostMultiplier *
        rivalryMultiplier,
      weatherMultiplier,
      fieldMultiplier,
      itemMultiplier,
      stabMultiplier,
      // 천진: 자신이 이 특성이면 상대 쪽 랭크(공격측이면 상대 방어/특방, 방어측이면 상대
      // 공격/특공)를 전부 무시(0랭크 취급) — computeDamage는 카테고리에 맞는 스탯 하나만
      // 읽으므로 NEUTRAL_STAGES를 통째로 넘겨도 안전하다. 자신의 랭크는 그대로 반영된다.
      attackerStages: defenderAbility?.ignoresOpponentStatStagesInDamage ? NEUTRAL_STAGES : attacker.stages,
      defenderStages: defenderStagesForDamage,
      bulkMultiplier: abilityDefenseMultiplier * berryResult.bulkMultiplier * screenMultiplier,
      isCritical: critical,
      // 스나이퍼: 급소 데미지 배율을 2.25로 올린다(기본 1.5).
      critDamageMultiplier: attackerAbility?.critDamageMultiplier,
      randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
    });
    let hitDamage = result?.damage ?? 0;
    // 관통드릴: 접촉기가 명중(면역 제외)했는데 데미지가 상대 최대 HP의 지정 비율보다 낮으면
    // 그 비율만큼으로 끌어올린다(최소 데미지 보장).
    if (contactIgnoresDefenseBoost && typeEffectiveness !== 0) {
      const minDamage = Math.floor(
        defender.maxHp * attackerAbility!.contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction!,
      );
      if (hitDamage < minDamage) hitDamage = minDamage;
    }
    return { damage: hitDamage, isCritical: critical };
  }

  // 기합의띠(최대 HP 상태에서만, 1회)·기합의머리띠(조건 없이 매번 확률): 이번 데미지로 정확히
  // 기절했을 때만(currentHp가 0이 됐을 때만) 판정 대상이 된다. preHp는 이번 데미지를 받기
  // 직전 HP — 기합의띠의 "최대 HP 상태" 조건과 애초에 죽어있던 게 아니었는지 확인에 쓴다.
  // 다단히트 루프 안에서 타수마다 호출되므로, 한 타에서 버텨도 다음 타에서 다시 죽을 수 있고
  // (기합의머리띠는 매번 재판정, 기합의띠는 이미 소모돼 두 번은 못 버팀) 그건 본가와 동일하다.
  let enduredItemName: string | undefined;
  let enduredAbilityName: string | undefined;
  let enduredProtectMoveName: string | undefined;
  function applyEndurance(preHp: number): void {
    if (defender.currentHp > 0 || preHp <= 0) return;
    const result = getEnduranceResult(defenderItem, preHp, defender.maxHp, defender.itemConsumed ?? false, random);
    if (result.survives) {
      defender.currentHp = 1;
      enduredItemName = defenderItem?.name;
      if (result.consumes) consumeItem(defender);
      return;
    }
    // 옹골참: 기합의띠와 조건은 같지만(최대 HP 상태) 소모되지 않아 매번 다시 판정한다.
    if (defenderAbility?.survivesLethalAtFullHp && preHp === defender.maxHp) {
      defender.currentHp = 1;
      enduredAbilityName = defenderAbility.name;
      return;
    }
    // 버티기(protectEffect: "endure"): 기합의띠·옹골참과 달리 풀피 조건 없이 이번 턴엔
    // 무조건 버틴다 — 방어류 공용 성공 확률(protectStreak)로 이미 발동 여부가 갈렸으니
    // 여기 도달했다는 건 이번 턴 발동에 성공했다는 뜻이다.
    if (defender.activeProtect?.effect === "endure") {
      defender.currentHp = 1;
      enduredProtectMoveName = defender.activeProtect.moveName;
    }
  }

  // 대타출동: blockedBySubstitute(=대타가 있고 소리 계열이 아님)면 데미지를 실제 HP가 아니라
  // 대타 HP에서 깎는다. 대타 HP를 넘는 초과분은 그냥 사라진다(본가 규칙 — 실제 HP로 안 넘어옴).
  // 대타가 이번 타격으로 다 깎였으면 그 즉시 사라지고, 다단히트 루프는 이 시점에서 멈춰야 한다
  // (기절과 같은 축 — substituteBroke를 그 판정에 같이 쓴다).
  let substituteBroke = false;
  let hitSubstitute = false;
  // 도구 발동 시 UI에 표시할 이름(상태이상/혼란/헤롱헤롱/도발/사슬묶기/앙코르 즉시치료 나무열매·
  // 멘탈허브 등) — triggerAbilityHitEffect(헤롱헤롱바디)가 이 변수를 참조하므로 그 정의보다
  // 앞에 선언해야 한다(TDZ 회피).
  let statusCureBerryItemName: string | undefined;
  // 탈(Disguise): 배틀 중 처음 데미지를 입는 순간에만 발동(disguiseBroken이 아직 false일 때).
  let hitNegatedByAbilityName: string | undefined;
  let disguiseRecoilDamage: number | undefined;
  // 길동무: 데미지 적용 직후 판정하지만, 기합의띠/옹골참/버티기(applyEndurance)로 HP 1로 버텨낸
  // 경우는 애초에 안 쓰러진 것이므로 발동하면 안 된다 — applyEndurance까지 다 끝난 뒤에 판정해야
  // 한다(checkDestinyBond를 별도 호출로 분리한 이유). 다단히트 도중 이미 발동했으면 재판정 안 함.
  let destinyBondTriggered = false;
  function applyDamageToDefender(amount: number): void {
    if (blockedBySubstitute && defender.substituteHp !== undefined) {
      hitSubstitute = true;
      defender.substituteHp = Math.max(0, defender.substituteHp - amount);
      if (defender.substituteHp <= 0) {
        defender.substituteHp = undefined;
        substituteBroke = true;
      }
      return;
    }
    // 탈: 대타를 맞힌 게 아니라 실제로 HP를 깎으려는 순간에만 판정한다(대타가 있는 동안은
    // 애초에 위 분기에서 return하므로 여기 안 옴). 다단히트는 첫 타에서만 발동하고, 벗겨진
    // 뒤의 나머지 타수는 이 블록을 건너뛰어 정상적으로 실제 HP를 깎는다(disguiseBroken=true).
    if (amount > 0 && defenderAbility?.negatesFirstHitThenRecoils && !defender.disguiseBroken) {
      defender.disguiseBroken = true;
      hitNegatedByAbilityName = defenderAbility.name;
      disguiseRecoilDamage = Math.floor(defender.maxHp * defenderAbility.negatesFirstHitThenRecoils.recoilFraction);
      defender.currentHp = Math.max(0, defender.currentHp - disguiseRecoilDamage);
      return;
    }
    defender.currentHp = Math.max(0, defender.currentHp - amount);
    // 미러코트/카운터용: 실제 HP로 받은 데미지를 카테고리별로 누적(대타 흡수분은 위에서 이미
    // return되어 제외). effectiveMove가 아니라 hitMove로 넘어와도 카테고리는 동일하다.
    if (amount > 0 && (effectiveMove.category === "physical" || effectiveMove.category === "special") && defender.damageTakenThisTurn) {
      defender.damageTakenThisTurn[effectiveMove.category] += amount;
    }
  }

  /**
   * 길동무: applyDamageToDefender + applyEndurance까지 끝난 뒤(=기합의띠·옹골참·버티기로도 못
   * 버티고 실제로 쓰러졌는지가 확정된 뒤) 호출한다. 상대(defender)가 길동무 예약 상태였는데
   * 이번 공격으로 실제 기절했으면, 공격자(attacker)도 그 자리에서 같이 기절시킨다 — 간접
   * 데미지(상태이상·씨뿌리기 등)는 이 함수를 거치는 데미지 경로 자체가 아니라서 자연히 대상이
   * 아니다(본가 규칙과 일치).
   */
  function checkDestinyBond(): void {
    if (destinyBondTriggered || defender.currentHp > 0 || !defender.destinyBondArmed) return;
    attacker.currentHp = 0;
    defender.destinyBondArmed = false;
    destinyBondTriggered = true;
  }

  /**
   * 방어측 hitTrigger 특성 한 번의 "타격"에 대한 판정. 다단히트 기술은 타수마다 이 함수를
   * 다시 호출해서 확률(chance)을 매번 새로 굴린다 — 정전기/불꽃몸이 트리플악셀 3타에 각각
   * 별도로 마비/화상을 노릴 수 있고, 까칠한피부/저주받은바디도 타수만큼 반복 발동한다.
   * hitDamage가 0(면역 등)이면 애초에 판정하지 않는다. 공격자가 이미 기절했으면(예: 앞선
   * 타에서 까칠한피부 반동으로 죽었으면) 더 이상 판정하지 않는다. 대타를 맞혔을 때도 발동하지
   * 않는다 — 본가 규칙: 접촉은 대타(인형)에 닿은 것이라 실제 상대에게 닿은 게 아니다.
   */
  function triggerAbilityHitEffect(hitDamage: number): void {
    if (hitDamage <= 0 || isFainted(attacker) || blockedBySubstitute) return;
    const trigger = defenderAbility?.hitTrigger;
    if (!trigger) return;
    const chance = trigger.chance !== undefined ? trigger.chance / 100 : 1;
    if (!hitTriggerMatchesMove(trigger, effectiveMove) || random() >= chance) return;

    if (
      trigger.inflictsStatusOnAttacker &&
      !isImmuneToStatus(trigger.inflictsStatusOnAttacker, attacker.types, attackerAbility?.immuneToStatuses)
    ) {
      const before = attacker.status.condition;
      attacker.status = inflictStatus(attacker.status, trigger.inflictsStatusOnAttacker);
      if (attacker.status.condition !== before) {
        abilityInflictedStatusOnAttacker = attacker.status.condition;
        abilityInflictedStatusAbilityName = defenderAbility!.name;
      }
    }
    // 헤롱헤롱바디: 접촉해 온 공격자와 이성 관계일 때만(무성별이거나 동성이면 조용히 무산) 공격자에게
    // 헤롱헤롱을 건다. 이미 헤롱헤롱 상태면 본가처럼 재발동하지 않는다.
    if (
      trigger.inflictsVolatileOnAttacker &&
      !(trigger.requiresOppositeGender && (attacker.gender === null || defender.gender === null || attacker.gender === defender.gender)) &&
      !hasVolatile(attacker.volatile, trigger.inflictsVolatileOnAttacker)
    ) {
      attacker.volatile = inflictVolatile(attacker.volatile, trigger.inflictsVolatileOnAttacker, random);
      abilityInflictedVolatileOnAttacker = trigger.inflictsVolatileOnAttacker;
      abilityInflictedVolatileAbilityName = defenderAbility!.name;
      // 멘탈허브: 헤롱헤롱바디로 걸린 헤롱헤롱도 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(attackerItem, attacker.itemConsumed ?? false)) {
        attacker.volatile = { active: { ...attacker.volatile.active } };
        delete attacker.volatile.active[trigger.inflictsVolatileOnAttacker];
        consumeItem(attacker);
        statusCureBerryItemName = attackerItem!.name;
        abilityInflictedVolatileOnAttacker = undefined;
        abilityInflictedVolatileAbilityName = undefined;
      }
    }
    // 매직가드: 까칠한피부·유폭류가 공격자에게 되돌리는 접촉 반사 데미지는 "공격기 데미지"가
    // 아니라서 무효화된다(공격자가 매직가드일 때).
    if (trigger.damagesAttackerFraction && !attackerAbility?.negatesIndirectDamage) {
      const amount = Math.floor(attacker.maxHp * trigger.damagesAttackerFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      abilityDamageToAttacker += amount;
      abilityDamageAbilityName = defenderAbility!.name;
    }
    if (trigger.selfStatChanges) {
      for (const change of trigger.selfStatChanges) {
        const before = defender.stages[change.stat];
        defender.stages = applyStageDelta(defender.stages, change.stat, contraryDelta(defender, change.delta));
        const after = defender.stages[change.stat];
        // 실제로 변한 것만 로그에 남긴다(이미 상·하한이라 그대로면 조용히 무산). 다단히트면 폭 누적.
        // 깨어진갑옷은 한 번 발동에 방어 -1 / 스피드 +2가 같이 오므로 오름·내림을 각자 담는다.
        if (after !== before) {
          abilityRaisedDefenderStatsAbilityName = defenderAbility!.name;
          const bucket = after > before ? abilityRaisedDefenderStats : abilityLoweredDefenderStats;
          const magnitude = Math.abs(after - before);
          const existing = bucket.find((s) => s.stat === change.stat);
          if (existing) existing.delta += magnitude;
          else bucket.push({ stat: change.stat, delta: magnitude });
        }
      }
    }
    if (trigger.disablesAttackerMove && attacker.remainingPp[move.id] !== undefined) {
      attacker.remainingPp[move.id] = 0;
      abilityDisabledMoveName = move.name;
      abilityDisableAbilityName = defenderAbility!.name;
    }
    // 나쁜손버릇: 피격측(defender)이 무도구이고 공격자(attacker)가 도구를 지녔으면 그 자리에서 강탈한다.
    // 매지션과 방향만 반대고 규칙은 동일 — 대타에 맞았을 때는 함수 진입부 가드(blockedBySubstitute)에서
    // 이미 걸러진다. 다단히트여도 첫 타에 도구를 얻는 순간 !defender.currentItemId가 깨져 재발동하지 않는다.
    if (trigger.stealsAttackerItem && !defender.currentItemId && attacker.currentItemId) {
      const stolen = getItem(attacker.currentItemId);
      pickpocketStolenItemName = stolen?.name;
      pickpocketAbilityName = defenderAbility!.name;
      defender.currentItemId = attacker.currentItemId;
      defender.itemConsumed = false; // 새로 얻은 도구라 이전 소모 이력과 무관하게 쓸 수 있다
      attacker.currentItemId = null;
    }
    // 미라(Mummy): 접촉기로 피격당하면 공격자의 특성을 미라로 바꾼다. 이미 그 특성이면 무발동.
    if (
      trigger.setsAttackerAbilityId &&
      attacker.effectiveAbilityId !== trigger.setsAttackerAbilityId
    ) {
      attacker.effectiveAbilityId = trigger.setsAttackerAbilityId;
      mummifiedAttackerAbilityName = defenderAbility!.name;
    }
    // 유폭(Aftermath): 접촉기로 이 포켓몬이 쓰러진 그 순간 공격자에게 공격자 최대 HP 비율만큼 데미지.
    if (
      trigger.damagesContactAttackerFractionOnFaint &&
      isFainted(defender) &&
      !attackerAbility?.negatesIndirectDamage
    ) {
      const amount = Math.floor(attacker.maxHp * trigger.damagesContactAttackerFractionOnFaint);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      abilityDamageToAttacker += amount;
      abilityDamageAbilityName = defenderAbility!.name;
    }
  }

  // 방어/판별/킹실드가 성공했으면 데미지 계산 자체를 건너뛴다(대타처럼 흡수하는 게 아니라
  // 그냥 0으로 만든다) — 아래 세 분기 전부 이 가드로 묶는다.
  if (isDamaging && !blockedByProtect && effectiveMove.fixedDamage !== undefined) {
    // 나이트헤드류: 방어/랭크/특성/도구/급소를 전부 무시하고 고정 수치만 깎는다.
    // 타입 상성 면역(0배)만은 그대로 존중 — 반감/2배는 적용하지 않는다.
    damage = typeEffectiveness === 0 ? 0 : effectiveMove.fixedDamage;
    damagePercent = damage / defender.realStats.hp;
    {
      const preHp = defender.currentHp;
      applyDamageToDefender(damage);
      applyEndurance(preHp);
      triggerAbilityHitEffect(damage);
    }
  } else if (isDamaging && !blockedByProtect && effectiveMove.minHits !== undefined && effectiveMove.maxHits !== undefined) {
    // 다단히트: 명중 판정은 이미 위(첫 타 기준)에서 끝났으니 여기부턴 최소 1타는 맞은 상태로
    // 시작한다. 록블라스트류(multiHitPowers 없음)는 첫 타만 명중 판정하고 나머지는 자동 명중,
    // 트리플악셀(multiHitPowers 있음)은 타수마다 따로 명중을 판정해서 빗나가면 그 시점에서
    // 중단된다 — moves.json의 effect 텍스트에 이미 명시된 구분(사용자 확인). 급소는 다단히트
    // 종류와 무관하게 항상 타수마다 따로 판정한다(사용자 확인).
    const perHitAccuracyCheck = effectiveMove.multiHitPowers !== undefined;
    const totalHits = perHitAccuracyCheck
      ? effectiveMove.maxHits
      : rollMultiHitCount(effectiveMove.minHits, effectiveMove.maxHits, random);

    let landed = 0;
    for (let i = 0; i < totalHits; i++) {
      if (i > 0 && perHitAccuracyCheck) {
        const stillHits = hitChance === null ? true : random() < hitChance;
        if (!stillHits) break;
      }
      const hitPower = effectiveMove.multiHitPowers?.[i] ?? effectiveMove.power;
      if (hitPower === null || hitPower === undefined) break;
      const hitMove = effectiveMove.multiHitPowers ? { ...effectiveMove, power: hitPower } : effectiveMove;
      const hitResult = resolveHit(hitMove);
      damage += hitResult.damage;
      if (hitResult.isCritical) isCritical = true;
      landed += 1;
      const preHp = defender.currentHp;
      applyDamageToDefender(hitResult.damage);
      applyEndurance(preHp);
      triggerAbilityHitEffect(hitResult.damage);
      if (isFainted(defender) || substituteBroke) break; // 상대가 쓰러지거나 대타가 깨지면 남은 타수는 진행하지 않는다
    }
    damagePercent = damage / defender.realStats.hp;
    hitCount = landed;
  } else if (isDamaging && !blockedByProtect) {
    const hitResult = resolveHit(effectiveMove);
    damage = hitResult.damage;
    isCritical = hitResult.isCritical;
    damagePercent = damage / defender.realStats.hp;
    const preHp = defender.currentHp;
    applyDamageToDefender(damage);
    applyEndurance(preHp);
    triggerAbilityHitEffect(damage);
  }

  // 죽기살기(Endeavor, E-5): 데미지 계산이 없는(power null) 기술이라 위 분기에 안 걸린다.
  // 상대 HP를 사용자의 현재 HP와 같게 깎는다 — 상대가 더 많을 때만, 대타가 있으면 무효(단순화),
  // 노말→고스트 면역이면 typeEffectiveness가 0이라 스킵.
  let endeavorDamage = 0;
  if (
    effectiveMove.setsTargetHpToUserHp &&
    !blockedByProtect &&
    typeEffectiveness !== 0 &&
    defender.substituteHp === undefined &&
    defender.currentHp > attacker.currentHp
  ) {
    endeavorDamage = defender.currentHp - attacker.currentHp;
    defender.currentHp = attacker.currentHp;
    damage = endeavorDamage;
    damagePercent = endeavorDamage / defender.maxHp;
  }

  // 무릎차기(crashFraction, E-2): 명중은 했지만 방어류에 막혔거나 타입 면역(격투→고스트)으로
  // 무효화됐으면 사용자가 최대 HP의 절반을 잃는다. 대타에 흡수된 경우는 "맞은" 것이라 제외.
  let crashDamage = 0;
  if (
    effectiveMove.crashFraction !== undefined &&
    !hitSubstitute &&
    (blockedByProtect || typeEffectiveness === 0)
  ) {
    crashDamage = Math.floor(attacker.maxHp * effectiveMove.crashFraction);
    attacker.currentHp = Math.max(0, attacker.currentHp - crashDamage);
  }

  // 떨어뜨리기(cancelsTargetCharge, E-1): 공중날기 등으로 무적인 상대에게 명중하면 그 차징을 캔슬.
  let canceledTargetChargeMoveName: string | undefined;
  if (effectiveMove.cancelsTargetCharge && defender.chargingMoveId && damage > 0) {
    canceledTargetChargeMoveName = getMove(defender.chargingMoveId)?.name;
    defender.chargingMoveId = undefined;
  }

  // 미러코트/카운터(counters, F-1): 이번 턴 사용자가 받은 해당 카테고리 데미지의 2배를 상대에게
  // 그대로 되돌린다. 우선도 -5라 보통 이 시점엔 상대가 이미 공격을 마친 뒤다. 타입 상성·자속·랭크
  // 전부 무시. 받은 데미지가 없거나(0) 상대가 면역 타입(특수 카운터=악, 물리 카운터=고스트)이면 실패.
  let counterDamage = 0;
  let counterFailed = false;
  if (effectiveMove.counters) {
    const taken = attacker.damageTakenThisTurn?.[effectiveMove.counters] ?? 0;
    const immuneType = effectiveMove.counters === "special" ? "악" : "고스트";
    if (taken <= 0 || defender.types.includes(immuneType)) {
      counterFailed = true;
    } else {
      counterDamage = Math.min(defender.currentHp, taken * 2);
      defender.currentHp -= counterDamage;
      damage = counterDamage;
      damagePercent = counterDamage / defender.maxHp;
    }
  }

  // 앙갚음/메탈버스트(countersAllCategories): 이번 턴 받은 (물리+특수) 데미지 합의 multiplier배(1.5)를
  // 카테고리·타입·랭크 무시하고 되돌린다. counters와 달리 면역 타입이 없다. 받은 데미지가 0이면 실패.
  if (effectiveMove.countersAllCategories) {
    const taken =
      (attacker.damageTakenThisTurn?.physical ?? 0) + (attacker.damageTakenThisTurn?.special ?? 0);
    if (taken <= 0) {
      counterFailed = true;
    } else {
      counterDamage = Math.min(
        defender.currentHp,
        Math.floor(taken * effectiveMove.countersAllCategories.multiplier),
      );
      defender.currentHp -= counterDamage;
      damage = counterDamage;
      damagePercent = counterDamage / defender.maxHp;
    }
  }

  // 부자유친: 단일타 기술이 실제로 데미지를 준 뒤(다단히트/고정데미지는 제외 — 본가에서도 이미
  // 여러 번 때리는 기술과는 안 겹침), 같은 컨텍스트로 위력만 배율만큼 줄인 추가타를 한 번 더
  // 날린다. 첫 타로 이미 상대가 쓰러졌으면 추가타는 나가지 않는다.
  let followUpHitDamage = 0;
  if (
    isDamaging &&
    !blockedByProtect &&
    damage > 0 &&
    !isFainted(defender) &&
    effectiveMove.fixedDamage === undefined &&
    effectiveMove.minHits === undefined &&
    effectiveMove.power !== null &&
    attackerAbility?.followUpHitPowerMultiplier
  ) {
    const followUpMove = { ...effectiveMove, power: Math.round(effectiveMove.power * attackerAbility.followUpHitPowerMultiplier) };
    const followUpResult = resolveHit(followUpMove);
    followUpHitDamage = followUpResult.damage;
    damage += followUpHitDamage;
    damagePercent = damage / defender.realStats.hp;
    if (followUpResult.isCritical) isCritical = true;
    const preHp = defender.currentHp;
    applyDamageToDefender(followUpHitDamage);
    applyEndurance(preHp);
    triggerAbilityHitEffect(followUpHitDamage);
  }

  // 발버둥 반동: 필중이라 항상 이 지점까지 오고, 명중/기절 여부와 무관하게 사용자가
  // 최대 HP의 1/4만큼 반동 데미지를 입는다 (상대 데미지와는 별개 계산).
  let selfDamage = 0;
  if (move.id === STRUGGLE_MOVE.id) {
    selfDamage = Math.floor(attacker.maxHp / 4);
    attacker.currentHp = Math.max(0, attacker.currentHp - selfDamage);
  }

  // 반동(recoil): 플레어드라이브·웨이브태클·브레이브버드·양날박치기. 상대에게 준 데미지(damage)의
  // 일정 비율만큼 사용자도 입는다 — damage가 0(면역 등)이면 반동도 자연히 0이 된다.
  // 매직가드: 반동기(recoilFraction)의 반동은 "공격기 데미지"가 아니라서 무효화된다.
  let recoilDamage = 0;
  if (effectiveMove.recoilFraction !== undefined && damage > 0 && !attackerAbility?.negatesIndirectDamage) {
    recoilDamage = Math.floor(damage * effectiveMove.recoilFraction);
    attacker.currentHp = Math.max(0, attacker.currentHp - recoilDamage);
  }

  // 생명의구슬: 데미지를 실제로 준(damage > 0) 공격이 성공할 때마다 최대 HP의 1/10만큼 자신도
  // 반동을 입는다 — 다단히트도 타수 수와 무관하게 이번 행동에 한 번만 적용(본가 규칙).
  // 단, 이번 기술에서 우격다짐(sheerForceAbilityName)이 실제로 발동했다면 생명의구슬 반동은
  // 면제된다 — 본가에서 확인된 특수 상호작용(Bulbapedia: Sheer Force negates Life Orb recoil).
  // 위력 상승·아이템 데미지 보너스는 그대로 받으면서 반동만 사라진다.
  let itemRecoilDamage = 0;
  let itemRecoilItemName: string | undefined;
  // 매직가드: 생명의구슬 반동도 무효화한다(위력·데미지 보너스는 그대로 — 우격다짐과 같은 결).
  if (
    isDamaging &&
    damage > 0 &&
    attackerItem?.selfRecoilFractionOfMaxHp &&
    !sheerForceAbilityName &&
    !attackerAbility?.negatesIndirectDamage
  ) {
    itemRecoilDamage = Math.floor(attacker.maxHp * attackerItem.selfRecoilFractionOfMaxHp);
    attacker.currentHp = Math.max(0, attacker.currentHp - itemRecoilDamage);
    itemRecoilItemName = attackerItem.name;
  }

  // 흡수기(기가드레인·드레인펀치·드레인키스·원념의칼): 준 데미지의 일정 비율만큼 회복.
  // 큰뿌리를 지녔으면 회복량이 1.3배. recoil의 정반대 축이라 recoilDamage와 별도로 관리한다.
  let drainHealAmount = 0;
  if (isDamaging && damage > 0 && effectiveMove.drainFraction !== undefined) {
    drainHealAmount = Math.floor(
      damage * effectiveMove.drainFraction * getDrainHealMultiplier(attackerItem),
    );
    attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + drainHealAmount);
  }

  // 조개껍질방울: 준 데미지의 1/8만큼 회복. 흡수기와는 별개 축이라 같은 행동에서 동시에 발동할 수 있다.
  let shellBellHealAmount = 0;
  if (isDamaging && damage > 0 && attackerItem?.damageDealtHealDenominator) {
    shellBellHealAmount = Math.floor(damage / attackerItem.damageDealtHealDenominator);
    attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + shellBellHealAmount);
  }

  // 매지션: 데미지를 실제로 준(damage > 0) 공격이 명중했고, 자신이 무도구 상태(currentItemId
  // 없음)면 그 자리에서 상대가 지닌 도구를 빼앗는다. 자신이 이미 도구를 지녔으면 발동하지
  // 않고(본가 규칙), 상대도 무도구면 훔칠 게 없어 조용히 아무 일도 안 일어난다. 대타가 대신
  // 맞았을 때는 상대의 "실제 소지품"과 무관한 인형에 닿은 것이므로 훔치지 않는다.
  let stolenItemName: string | undefined;
  if (
    isDamaging &&
    damage > 0 &&
    !hitSubstitute &&
    attackerAbility?.stealsItemOnDamagingHit &&
    !attacker.currentItemId &&
    defender.currentItemId
  ) {
    const stolenItem = getItem(defender.currentItemId);
    stolenItemName = stolenItem?.name;
    attacker.currentItemId = defender.currentItemId;
    attacker.itemConsumed = false; // 새로 얻은 도구라 이전 소모 이력과 무관하게 다시 쓸 수 있다
    defender.currentItemId = null;
  }

  // 자폭류(대폭발 등): 명중했으면 반드시 데미지를 먼저 입힌 "다음" 사용자가 기절한다.
  // 순서가 중요하다 — 이 데미지로 상대가 이미 쓰러졌다면, 실제 게임처럼 "상대를 먼저 쓰러뜨린 뒤
  // 반동으로 자신도 쓰러진 것"으로 취급되어야 승자 판정(runTurn)이 이 행동의 주체를 승자로 잡는다.
  if (effectiveMove.selfFaints) {
    attacker.currentHp = 0;
  }

  // 길동무: 생명의구슬 반동/흡수기 회복/조개껍질방울 등 공격측 HP에 영향을 주는 후처리가 전부
  // 끝난 뒤에 마지막으로 판정한다 — 상대를 쓰러뜨리며 동시에 흡수기로 회복했더라도, 길동무는
  // "HP를 깎는" 효과가 아니라 그 자리에서 확정적으로 기절시키는 효과라 이후 회복을 무시해야
  // 한다(=먼저 판정하면 나중 회복이 되살리는 버그가 생김). 다단히트/부자유친 추가타 중 어느 타가
  // 상대를 쓰러뜨렸든 이 시점의 defender.currentHp/destinyBondArmed만 보면 되므로 한 번으로 충분.
  checkDestinyBond();

  // ── 매직미러 반사 구간 시작 ──
  // 여기서부터 스텔스록 설치까지의 "방어측 방향" 효과 블록에 한해 공격/방어 바인딩을 맞바꾼다.
  // 되돌린 기술은 원래 시전자(이제 defender) 기준으로 상태이상 면역·조사·도구·승기까지 전부
  // 재평가된다. 블록이 끝나면 곧바로 원위치하며, 로그·후처리는 원래 방향 기준으로 돌아간다.
  // status 카테고리라 데미지 경로(resolveHit 등)는 이 지점 이전에 이미 no-op으로 끝나 있다.
  let bounceActive = false;
  let bouncedMoveName: string | undefined;
  let bouncedByAbilityName: string | undefined;
  if (bouncedByMagicMirror) {
    bounceActive = true;
    bouncedMoveName = move.name;
    bouncedByAbilityName = defenderAbility!.name;
    [attacker, defender] = [defender, attacker];
    [attackerAbility, defenderAbility] = [defenderAbility, attackerAbility];
    [attackerItem, defenderItem] = [defenderItem, attackerItem];
  }

  // 인분(Shield Dust): 방어측이 이 특성이면, 데미지 기술이 방어측에게 딸려 거는 추가효과
  // (상태이상·행동방해·랭크변화 — chance 유무 무관)를 전부 무산시킨다. 변화기 주효과와 자기 대상
  // 효과는 대상이 아니다. hasSheerForceSecondaryEffect(우격다짐)와 같은 "추가효과" 정의를 공유.
  const secondaryEffectsBlockedByAbility =
    effectiveMove.category !== "status" && !!defenderAbility?.blocksSecondaryEffects;
  let secondaryBlockedByAbilityName: string | undefined;

  // 볼가득넣기(eatsHeldBerry): 지닌 나무열매(이름이 "열매"로 끝나는 도구)를 먹는다 — 없으면 실패.
  // HP 회복 나무열매(자뭉·오랭)면 즉시 그만큼 회복(HP 조건 무시). 방어 +2는 아래 statChanges로 적용.
  let berryEatFailed = false;
  let stuffCheeksBerryHeal = 0;
  let stuffCheeksBerryName: string | undefined;
  if (effectiveMove.eatsHeldBerry) {
    const berry = attackerItem && attackerItem.name.endsWith("열매") ? attackerItem : undefined;
    if (!berry) {
      berryEatFailed = true;
    } else {
      stuffCheeksBerryName = berry.name;
      const rawHeal = berry.healsBelowHalfHpDenominator
        ? Math.floor(attacker.maxHp / berry.healsBelowHalfHpDenominator)
        : (berry.healsBelowHalfHpFlat ?? 0);
      stuffCheeksBerryHeal = Math.min(attacker.maxHp - attacker.currentHp, rawHeal);
      attacker.currentHp += stuffCheeksBerryHeal;
      consumeItem(attacker);
    }
  }

  // 기술 자신의 랭크/명중회피/급소 변화 적용 (칼춤, 그림자분신, 기충전 등).
  // attacker/defender는 state.a/state.b를 그대로 참조하고 있어 여기서 바꾼 값이 state에도 반영된다.
  const attackerStagesBeforeMoveChange = attacker.stages;
  const defenderStagesBeforeMoveChange = defender.stages;
  // 확률부(chance) statChanges는 여기서 굴려서 통과한 항목만 남긴다(확정은 그대로). 인분이면
  // 상대 대상 항목은 굴림 없이 통째로 제거한다. 예전엔 applyMoveStatChanges가 chance를 굴리지
  // 않고 100%로 적용하던 버그가 있었다(불꽃춤 자기 특공↑ 50%·브레이크클로 상대 방어↓ 50%).
  const rolledStatChanges = berryEatFailed
    ? []
    : effectiveMove.statChanges?.filter((sc) => {
        if (secondaryEffectsBlockedByAbility && sc.target === "opponent") {
          // 방어/대타/황금몸으로 이미 통째로 막힌 경우엔 "인분" 문구를 따로 낼 필요가 없다.
          if (!opponentEffectsBlocked) secondaryBlockedByAbilityName = defenderAbility!.name;
          return false;
        }
        return sc.chance === undefined || random() * 100 < sc.chance;
      });
  const statChangeMove: Move = { ...effectiveMove, statChanges: rolledStatChanges };
  // 심술꾸러기: 랭크 변화를 받는 쪽이 Contrary면 delta 부호를 뒤집은 기술로 적용한다(자기 랭크변화·상대가 건 랭크변화 모두).
  attacker.stages = applyMoveStatChanges(attacker.stages, contraryMoveFor(statChangeMove, attacker), "self", {
    userTypes: attacker.types,
  });
  defender.stages = opponentEffectsBlocked
    ? defender.stages
    : applyMoveStatChanges(defender.stages, contraryMoveFor(statChangeMove, defender), "opponent", {
        userTypes: attacker.types,
      });

  // 랭크업 결과 문구용(Phase 6.5 §6-2 ⑥⑦, §6-3): 이 기술이 사용자 자신의 랭크를 실제로 올린 것과,
  // 올리려 했으나 이미 +6이라 막힌 것을 각각 모은다. 확정 랭크업만 대상 — 확률 부가효과(chance)와
  // 자기 랭크다운 디메리트(delta ≤ 0), 명중/회피/급소는 제외. 승기·하양허브 등 뒤 후처리 전에 측정.
  const selfStatRises: { stat: BattleStatKey; delta: number }[] = [];
  const selfStatsAtMax: BattleStatKey[] = [];
  for (const sc of effectiveMove.statChanges ?? []) {
    if (sc.target !== "self" || sc.chance !== undefined) continue;
    if (!isBattleStatKey(sc.stat) || (sc.delta ?? 0) <= 0) continue;
    const before = attackerStagesBeforeMoveChange[sc.stat];
    const after = attacker.stages[sc.stat];
    if (after > before) selfStatRises.push({ stat: sc.stat, delta: after - before });
    else if (before >= 6) selfStatsAtMax.push(sc.stat);
  }

  // 클리어바디(전체)·괴력집게(공격만)·미러아머(반사): 방금 적용된 opponent 랭크변화 중 실제로
  // 내려간 스탯만(-6 클램프로 변화가 없었던 건 자연히 제외) 골라서, 막을 스탯이면 원래 값으로
  // 되돌리고, 반사 특성이면 원래 값으로 되돌린 뒤 그만큼을 공격측에게 대신 적용한다. "상대의
  // 기술로" 내려간 것만 대상이라 방금 위에서 적용한 opponent 방향 변화만 비교하면 충분하다.
  const blockedStats = defenderAbility?.blocksOpponentStatDropsForStats;
  const reflects = defenderAbility?.reflectsOpponentStatDrops;
  // 미러아머 반사 문구용(E-4): 실제로 시전자(attacker)에게 되돌아간 랭크다운을 모은다. 특성/변화기
  // 랭크다운뿐 아니라 데미지 기술의 부가 랭크다운(브레이크클로 등)도 rolledStatChanges에 반영돼
  // 있어 여기서 같은 방식으로 잡힌다.
  let reflectedStatDropAbilityName: string | undefined;
  const reflectedStatDrops: { stat: BattleStatKey; delta: number }[] = [];
  if (blockedStats || reflects) {
    for (const stat of Object.keys(defender.stages) as BattleStatKey[]) {
      const dropAmount = defenderStagesBeforeMoveChange[stat] - defender.stages[stat];
      if (dropAmount <= 0) continue;
      if (reflects) {
        defender.stages = { ...defender.stages, [stat]: defenderStagesBeforeMoveChange[stat] };
        const attackerBefore = attacker.stages[stat];
        attacker.stages = applyStageDelta(attacker.stages, stat, -dropAmount);
        const applied = attackerBefore - attacker.stages[stat];
        if (applied > 0) {
          reflectedStatDropAbilityName = defenderAbility!.name;
          reflectedStatDrops.push({ stat, delta: applied });
        }
      } else if (blockedStats?.includes(stat)) {
        defender.stages = { ...defender.stages, [stat]: defenderStagesBeforeMoveChange[stat] };
      }
    }
  }

  // 승기: 자신의 능력치가 실제로 하락했으면(이미 -6으로 클램프돼 변화가 없었던 건 제외) 그
  // 즉시 지정된 랭크가 오른다. 자기 기술로 자기 스탯을 내렸든(공격측), 상대 기술로 스탯이
  // 내려갔든(방어측) 둘 다 같은 방식으로 판정한다 — 각자 자기 자신의 stages before/after만 비교.
  function applyCompetitiveBoost(
    fighter: BattleFighterState,
    ability: Ability | undefined,
    before: StatStages,
  ): void {
    const boost = ability?.boostsStatOnOwnStatDrop;
    if (!boost) return;
    const dropped = (Object.keys(fighter.stages) as BattleStatKey[]).some((stat) => fighter.stages[stat] < before[stat]);
    if (dropped) fighter.stages = applyStageDelta(fighter.stages, boost.stat, boost.delta);
  }
  applyCompetitiveBoost(attacker, attackerAbility, attackerStagesBeforeMoveChange);
  applyCompetitiveBoost(defender, defenderAbility, defenderStagesBeforeMoveChange);

  // 하양허브: 방금 반영된 랭크 중 마이너스가 하나라도 있으면(자신이 스스로 내렸든, 상대 기술로
  // 내려갔든) 그 즉시 마이너스 랭크만 전부 0으로 되돌리고 소모된다. 양쪽 다 이 도구를 지녔고
  // 같은 턴에 둘 다 마이너스가 됐으면(드문 경우) 둘 다 독립적으로 발동한다.
  let restoredStatsSelfItemName: string | undefined;
  let restoredStatsOpponentItemName: string | undefined;
  if (shouldTriggerWhiteHerb(attackerItem, attacker.stages, attacker.itemConsumed ?? false)) {
    attacker.stages = clampStagesToNonNegative(attacker.stages);
    consumeItem(attacker);
    restoredStatsSelfItemName = attackerItem?.name;
  }
  if (shouldTriggerWhiteHerb(defenderItem, defender.stages, defender.itemConsumed ?? false)) {
    defender.stages = clampStagesToNonNegative(defender.stages);
    consumeItem(defender);
    restoredStatsOpponentItemName = defenderItem?.name;
  }

  // 상대 랭크다운 결과 문구용(§1 C-6): 이 기술이 실제로 상대 랭크를 내린 것만 모은다. 최종
  // defender.stages 기준이라 클리어바디로 막혔거나 미러아머로 반사됐거나 하양허브로 되돌아간
  // 경우엔 net 변화가 0이라 자연히 제외된다. selfStatRises와 대칭 — 확정 하락만(확률 부가효과는
  // rolledStatChanges 단계에서 이미 굴려져 통과한 것만 남아 있고, 실제 하락분으로 판정).
  const opponentStatDrops: { stat: BattleStatKey; delta: number }[] = [];
  if (!opponentEffectsBlocked) {
    const seen = new Set<BattleStatKey>();
    for (const sc of rolledStatChanges ?? []) {
      if (sc.target !== "opponent" || !isBattleStatKey(sc.stat) || seen.has(sc.stat)) continue;
      seen.add(sc.stat);
      const drop = defenderStagesBeforeMoveChange[sc.stat] - defender.stages[sc.stat];
      if (drop > 0) opponentStatDrops.push({ stat: sc.stat, delta: drop });
    }
  }

  attacker.accuracyStages = applyMoveAccuracyEvasionChanges(
    attacker.accuracyStages,
    contraryMoveFor(effectiveMove, attacker),
    "self",
    { userTypes: attacker.types },
  );
  const defenderAccuracyBeforeChange = defender.accuracyStages.accuracy;
  defender.accuracyStages = opponentEffectsBlocked
    ? defender.accuracyStages
    : applyMoveAccuracyEvasionChanges(defender.accuracyStages, contraryMoveFor(effectiveMove, defender), "opponent", {
        userTypes: attacker.types,
      });
  // 날카로운눈: 상대(공격측)의 기술로 자신의 명중률이 떨어지는 걸 막는다. 회피율 변화는 이
  // 축과 무관해서(원문이 "명중률을 떨어뜨릴 수 없다"까지만) 건드리지 않는다.
  if (defenderAbility?.blocksOpponentAccuracyDrops && defender.accuracyStages.accuracy < defenderAccuracyBeforeChange) {
    defender.accuracyStages = { ...defender.accuracyStages, accuracy: defenderAccuracyBeforeChange };
  }
  attacker.critStage = applyMoveCritStageChanges(attacker.critStage, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  defender.critStage = opponentEffectsBlocked
    ? defender.critStage
    : applyMoveCritStageChanges(defender.critStage, effectiveMove, "opponent", {
        userTypes: attacker.types,
      });

  // 흑안개: 명중하면 양쪽의 5스탯 랭크 + 명중률/회피율 랭크를 전부 초기화한다. 급소율(critStage)은
  // 본가에서 별개 축이라 건드리지 않는다. 자신/상대 구분이 의미 없는(둘 다 리셋되는) 유일한
  // statChanges류 효과라 별도 필드로 분리했다.
  if (effectiveMove.resetsAllStages) {
    attacker.stages = { ...NEUTRAL_STAGES };
    defender.stages = { ...NEUTRAL_STAGES };
    attacker.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
    defender.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
  }

  let inflictedStatus: StatusConditionState["condition"] | undefined;
  // 이미 걸린 상태이상 때문에 상태이상 전용 변화기(맹독·도깨비불 등)가 아무 변화도 못 냈으면 true.
  // C-8: "블래키의 맹독 - 그러나 실패했다!". 데미지 기술의 부가 상태이상은 그냥 안 걸린 것뿐이라 대상 아님.
  let statusInflictFailed = false;
  if (secondaryEffectsBlockedByAbility && effectiveMove.inflictsStatus && !opponentEffectsBlocked) {
    // 인분: 데미지 기술이 거는 상태이상(화염방사 화상·연옥 100% 화상·볼부비부비 마비 등)은
    // 전부 추가효과라 무산된다. 변화기(도깨비불 등)의 상태이상은 secondaryEffectsBlockedByAbility가
    // false라 이 분기에 오지 않는다.
    secondaryBlockedByAbilityName = defenderAbility!.name;
  } else if (!opponentEffectsBlocked && effectiveMove.inflictsStatus) {
    for (const effect of effectiveMove.inflictsStatus) {
      if (
        isImmuneToStatus(
          effect.status,
          defender.types,
          defenderAbility?.immuneToStatuses,
          attackerAbility?.bypassesPoisonTypeImmunity,
        )
      )
        continue;
      if (isStatusBlockedByField(state.field, effect.status)) continue;
      // 쾌청(강한 햇살) 날씨에서는 얼음 상태에 걸리지 않는다 — 타입 면역과는 다른 축이라 별도 확인
      if (effect.status === "freeze" && activeWeather(state) === "쾌청") continue;
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() < chance) {
        const before = defender.status.condition;
        defender.status = inflictStatus(defender.status, effect.status);
        if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
        else if (effectiveMove.category === "status" && effect.chance === undefined) statusInflictFailed = true;
        break; // 주 상태이상은 한 번에 하나만 걸린다 (중첩 없음)
      }
    }
  }

  // 질투의불꽃(burnsTargetIfStatRoseThisTurn): 명중해서 데미지를 줬고, 이번 턴에 방어자의 랭크가
  // 하나라도 올랐으면(턴 시작 스냅샷 대비) 화상을 건다(확정). 대타를 맞혔으면 본체엔 안 건다.
  // 통상 화상 면역(불꽃 타입·특성·이미 상태이상·미스트필드)·인분·황금몸 규칙은 그대로 존중한다.
  if (
    effectiveMove.burnsTargetIfStatRoseThisTurn &&
    hit &&
    damage > 0 &&
    !hitSubstitute &&
    !opponentEffectsBlocked &&
    !secondaryEffectsBlockedByAbility &&
    !inflictedStatus
  ) {
    const rose = (["atk", "def", "spa", "spd", "spe"] as const).some(
      (stat) => defender.stages[stat] > (defender.statStagesAtTurnStart?.[stat] ?? 0),
    );
    if (
      rose &&
      !isImmuneToStatus("burn", defender.types, defenderAbility?.immuneToStatuses) &&
      !isStatusBlockedByField(state.field, "burn")
    ) {
      const before = defender.status.condition;
      defender.status = inflictStatus(defender.status, "burn");
      if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
    }
  }

  // 독수(Poison Touch): 접촉기로 데미지를 준 직후 이 확률로 상대를 독 상태로 만든다(독가시
  // hitTrigger의 공격측 버전). 타입/특성 상태이상 면역·필드는 그대로 존중. 대타를 맞혔으면 본체엔
  // 안 건다. 이미 다른 부가 상태이상이 걸린 경우는 중첩하지 않는다.
  if (
    attackerAbility?.poisonTouchChance !== undefined &&
    (effectiveMove.makesContact ?? false) &&
    hit &&
    damage > 0 &&
    !hitSubstitute &&
    !inflictedStatus &&
    !isImmuneToStatus("poison", defender.types, defenderAbility?.immuneToStatuses, attackerAbility?.bypassesPoisonTypeImmunity) &&
    !isStatusBlockedByField(state.field, "poison") &&
    random() * 100 < attackerAbility.poisonTouchChance
  ) {
    const before = defender.status.condition;
    defender.status = inflictStatus(defender.status, "poison");
    if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
  }

  // 싱크로: 이번 행동으로 방어측이 지정된 상태이상에 걸렸으면(원인은 이 블록 — 상대 기술) 그
  // 즉시 공격측에게도 같은 상태이상을 건다. abilityInflictedStatusOnAttacker는 정전기/불꽃몸
  // hitTrigger와 같은 필드를 재사용한다 — "방어측 특성이 공격측에게 상태이상을 걸었다"는 점에서
  // 의미가 동일하고, 한 포켓몬이 두 특성을 동시에 가질 수 없어 충돌하지 않는다.
  if (
    inflictedStatus &&
    defenderAbility?.reflectsStatusToOpponent?.includes(inflictedStatus) &&
    !isImmuneToStatus(inflictedStatus, attacker.types, attackerAbility?.immuneToStatuses) &&
    !isStatusBlockedByField(state.field, inflictedStatus) &&
    !(inflictedStatus === "freeze" && activeWeather(state) === "쾌청")
  ) {
    const beforeAttackerStatus = attacker.status.condition;
    attacker.status = inflictStatus(attacker.status, inflictedStatus);
    if (attacker.status.condition !== beforeAttackerStatus) {
      abilityInflictedStatusOnAttacker = attacker.status.condition;
      abilityInflictedStatusAbilityName = defenderAbility.name;
    }
  }

  // 상태이상 치료 관련 상태(물거품아리아 등 치료 기술, 불꽃 피격 해동, 잠듦/얼음 자연 해제,
  // 잠자기, 상태이상 즉시치료 나무열매)를 전부 여기 한 변수에 모은다 — 아래에서 순서대로 채워진다.
  let curedStatus: StatusConditionState["condition"] | undefined;
  let curedStatusTarget: "self" | "opponent" | undefined;

  // 상태이상 즉시치료 나무열매(리샘·버치·유루·복슝·복분·배리): 걸리는 "그 순간" 치료하고 소모된다.
  // itemConsumed는 나무열매 18종(타입내성)과 같은 축을 공유하므로(도구 1개=1회용), 이미 다른
  // 나무열매 효과가 이번 배틀에서 소모됐으면 발동하지 않는다.
  if (
    inflictedStatus &&
    !defenderBerriesBlocked &&
    getStatusCureBerryResult(defenderItem, inflictedStatus, defender.itemConsumed ?? false)
  ) {
    defender.status = { ...NO_STATUS_CONDITION };
    consumeItem(defender);
    statusCureBerryItemName = defenderItem!.name;
    curedStatus = inflictedStatus;
    curedStatusTarget = "opponent";
  }

  let inflictedVolatile: VolatileCondition | undefined;
  if (effectiveMove.inflictsVolatile) {
    for (const effect of effectiveMove.inflictsVolatile) {
      if (effect.volatile === "confusion" && isConfusionBlockedByField(state.field)) continue;
      // 정신력: 풀죽음 자체에 면역이라 발동 시도 자체가 무산된다(본가 규칙 — 확률 판정까지 가지 않음)
      if (effect.volatile === "flinch" && effect.target !== "self" && defenderAbility?.immuneToFlinch) continue;
      // 황금몸: 상대(공격측)를 향한 변화기 효과만 막는다 — target이 "self"(공격측 자신에게
      // 거는 것, 예: 반동/하품 예약)면 이 포켓몬을 겨냥한 게 아니라서 그대로 진행된다.
      if (effect.target !== "self" && opponentEffectsBlocked) continue;
      // 인분: 데미지 기술이 상대에게 거는 행동방해(아이언헤드 풀죽음·물의파동 혼란 등)도 추가효과.
      if (effect.target !== "self" && secondaryEffectsBlockedByAbility) {
        secondaryBlockedByAbilityName = defenderAbility!.name;
        continue;
      }
      const target = effect.target === "self" ? attacker : defender;
      // 하품(졸음): 대상이 이미 다른 주 상태이상이거나 이미 졸음 상태면 실패한다(본가 규칙) —
      // 실제 잠듦 여부(타입/필드 면역)는 2턴 뒤 트리거 시점에 따로 확인한다.
      if (effect.volatile === "drowsy" && (target.status.condition || hasVolatile(target.volatile, "drowsy"))) {
        continue;
      }
      // 희망사항: 이미 예약돼 있으면 재사용 실패(본가 규칙 — 필드/트릭룸과 같은 패턴)
      if (effect.volatile === "wish" && hasVolatile(target.volatile, "wish")) continue;
      // 헤롱헤롱: 이미 헤롱헤롱 상태거나(재사용 실패, drowsy/wish와 같은 패턴), 대상 또는
      // 거는 쪽이 무성별이거나 둘이 동성이면(getEffectiveGender 기준) 조용히 무산된다 — 본가에서도
      // 이 경우 "But it failed!"로 아무 효과 없이 끝난다.
      if (effect.volatile === "attract") {
        const inflicter = effect.target === "self" ? defender : attacker;
        if (
          hasVolatile(target.volatile, "attract") ||
          target.gender === null ||
          inflicter.gender === null ||
          target.gender === inflicter.gender
        ) {
          continue;
        }
      }
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() >= chance) continue;
      if (effect.target === "self") {
        attacker.volatile = inflictVolatile(attacker.volatile, effect.volatile, random);
      } else {
        defender.volatile = inflictVolatile(defender.volatile, effect.volatile, random);
      }
      inflictedVolatile = effect.volatile;

      // 시몬열매: 혼란에 걸리는 순간 치료하고 소모된다
      if (effect.volatile === "confusion") {
        const targetBerriesBlocked = effect.target === "self" ? attackerBerriesBlocked : defenderBerriesBlocked;
        const targetItem = targetBerriesBlocked ? undefined : effect.target === "self" ? attackerItem : defenderItem;
        if (getConfusionCureBerryResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active.confusion;
          consumeItem(target);
          statusCureBerryItemName = targetItem!.name;
          inflictedVolatile = undefined;
        }
      }

      // 멘탈허브: 헤롱헤롱/도발이 걸리는 순간 치료하고 소모된다. 나무열매가 아니라 긴장감
      // (berriesBlocked)의 영향을 받지 않는다.
      if (effect.volatile === "attract" || effect.volatile === "taunt") {
        const targetItem = effect.target === "self" ? attackerItem : defenderItem;
        if (getMentalHerbCureResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active[effect.volatile];
          consumeItem(target);
          statusCureBerryItemName = targetItem!.name;
          inflictedVolatile = undefined;
        }
      }
    }
  }

  // 왕의징표석: 데미지를 주는 데 성공하면 이 확률로 상대에게 추가 풀죽음을 건다. 기술 자체의
  // 풀죽음 확률(있다면)과는 완전히 별개 판정이라, 기술이 이미 풀죽음을 걸었으면 중복으로 다시
  // 걸 필요가 없다(로그에 "풀죽음!"이 두 번 찍히는 것만 방지 — 결과 자체는 어차피 동일).
  // 악취: 왕의징표석과 같은 축의 특성 버전 — 공격측이 이 특성이면 이 확률로 추가 풀죽음.
  const stenchFlinchTriggered =
    attackerAbility?.flinchChanceOnHit !== undefined && random() * 100 < attackerAbility.flinchChanceOnHit;
  if (
    isDamaging &&
    damage > 0 &&
    inflictedVolatile !== "flinch" &&
    !isFainted(defender) &&
    !defenderAbility?.immuneToFlinch &&
    (getExtraFlinchTriggered(attackerItem, random) || stenchFlinchTriggered)
  ) {
    if (defenderAbility?.blocksSecondaryEffects) {
      // 인분: 왕의징표석·악취가 얹는 추가 풀죽음도 추가효과라 무산된다(굴림은 이미 소비 — 결과만 버린다).
      secondaryBlockedByAbilityName = defenderAbility.name;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "flinch", random);
      inflictedVolatile = "flinch";
    }
  }

  // 불굴의마음: 이번 행동에서 풀죽음이 걸렸으면(기술 자체든 왕의징표석이든, 둘 다 위에서
  // 이미 defender.volatile에 반영됨) 그 즉시 지정된 랭크가 오른다.
  if (inflictedVolatile === "flinch" && defenderAbility?.boostsStatOnFlinch) {
    const boost = defenderAbility.boostsStatOnFlinch;
    defender.stages = applyStageDelta(defender.stages, boost.stat, contraryDelta(defender, boost.delta));
  }

  // 상태이상 치료: 물거품아리아처럼 명중 시 대상의 주 상태이상을 없앤다(inflictsStatus의 반대 방향).
  // status가 지정돼 있으면(물거품아리아=화상) 그 상태일 때만 치료 — 다른 상태이상은 안 지운다.
  if (effectiveMove.curesStatus) {
    const { target: cureTarget, status: cureStatus } = effectiveMove.curesStatus;
    const target = cureTarget === "self" ? attacker : defender;
    if (target.status.condition && (!cureStatus || target.status.condition === cureStatus)) {
      curedStatus = target.status.condition;
      curedStatusTarget = cureTarget;
      target.status = { ...NO_STATUS_CONDITION };
    }
  }

  // 얼음 상태의 상대가 불꽃타입 "데미지" 기술(물리/특수)에 맞으면 해제 확률(매턴 25%)과 무관하게
  // 즉시 해동된다 — 본가 규칙. 도깨비불처럼 변화기(status)는 타입이 불꽃이어도 해동시키지 않는다
  // (사용자 확인). curesStatus처럼 특정 기술만 태깅하는 게 아니라 "불꽃타입 데미지 기술이면 전부"
  // 적용되는 일반 규칙이라 별도로 둔다.
  if (
    effectiveMove.type === "불꽃" &&
    effectiveMove.category !== "status" &&
    defender.status.condition === "freeze"
  ) {
    curedStatus = "freeze";
    curedStatusTarget = "opponent";
    defender.status = { ...NO_STATUS_CONDITION };
  }

  // 이번 행동 시작 시점에 자신의 잠듦/얼음이 자연 해제(또는 thawsUserOnUse 강제 해동)됐으면
  // 별도 필드로 넘긴다 — 로그에서 기술 줄보다 먼저 렌더해야 하므로 curedStatus(행동 이후에
  // 일어나는 것들)와 섞지 않는다.
  const selfWokeBeforeMove = selfCuredStatus;

  // 잠자기: 명중(항상 필중)하면 기존 상태이상이 뭐든 지우고 체력을 완전히 회복한 뒤 정확히 2턴간
  // 무조건 재운다 — curesStatus/inflictsStatus의 일반 규칙(이미 상태이상이 있으면 못 걺)과는
  // 다른 별도 경로라 여기서 직접 덮어쓴다. curedStatus 로그는 재우기 전 상태이상이 있었을 때만 채운다.
  let restSlept = false;
  if (effectiveMove.restSleep) {
    if (attacker.status.condition) {
      curedStatus = attacker.status.condition;
      curedStatusTarget = "self";
    }
    attacker.currentHp = attacker.maxHp;
    attacker.status = inflictRestSleep();
    restSlept = true;

    // 리샘열매/유루열매 등을 지닌 채로 잠자기를 쓰면, 회복은 이미 끝난 채로 그 즉시 잠듦만
    // 치료된다(본가 실제 상호작용 — 잠자기 자체가 낭비되지만 회복은 유효하다).
    if (!attackerBerriesBlocked && getStatusCureBerryResult(attackerItem, "sleep", attacker.itemConsumed ?? false)) {
      attacker.status = { ...NO_STATUS_CONDITION };
      consumeItem(attacker);
      statusCureBerryItemName = attackerItem!.name;
      curedStatus = "sleep";
      curedStatusTarget = "self";
      restSlept = false;
    }
  }

  // 즉시 회복형 변화기: 광합성/달빛(날씨 의존)·날개쉬기/게으름피우기(고정 50%)·치유파동(상대 50%).
  // 잠자기는 위에서 이미 별도 처리했으니 여기선 건드리지 않는다.
  let healedAmount = 0;
  let healedTarget: "self" | "opponent" | undefined;
  if (!effectiveMove.restSleep && (effectiveMove.healsFraction !== undefined || effectiveMove.healsWeatherDependent)) {
    healedTarget = effectiveMove.healsTarget ?? "self";
    const healTarget = healedTarget === "self" ? attacker : defender;
    const fraction = effectiveMove.healsWeatherDependent
      ? computeWeatherHealFraction(activeWeather(state))
      : effectiveMove.healsFraction!;
    healedAmount = Math.min(
      healTarget.maxHp - healTarget.currentHp,
      Math.floor(healTarget.maxHp * fraction),
    );
    healTarget.currentHp += healedAmount;
  }

  // 힘흡수(drainsFromTargetAttackStat): 상대의 공격 실능(랭크 반영, -1 적용 전 값)만큼 자신을 회복.
  // 상대 공격 -1은 데이터의 statChanges로 위에서 이미 적용됐지만, 회복량은 랭크 변화 전 실능
  // 기준이라 defenderStagesBeforeMoveChange를 쓴다(본가 규칙).
  if (effectiveMove.drainsFromTargetAttackStat) {
    const targetAtk = Math.floor(
      defender.realStats.atk * rankStageMultiplier(defenderStagesBeforeMoveChange.atk),
    );
    const gain = Math.min(attacker.maxHp - attacker.currentHp, targetAtk);
    attacker.currentHp += gain;
    healedAmount = gain;
    healedTarget = "self";
  }

  // 가드셰어(averagesDefensesWithTarget): 자신·상대의 방어·특방 실능을 각각 더해 반씩 배정(내림).
  // 파워트릭(swapsOwnStats)처럼 realStats를 직접 고쳐 재계산이 필요 없다.
  let averagedDefensesMoveName: string | undefined;
  if (effectiveMove.averagesDefensesWithTarget) {
    const avgDef = Math.floor((attacker.realStats.def + defender.realStats.def) / 2);
    const avgSpd = Math.floor((attacker.realStats.spd + defender.realStats.spd) / 2);
    attacker.realStats = { ...attacker.realStats, def: avgDef, spd: avgSpd };
    defender.realStats = { ...defender.realStats, def: avgDef, spd: avgSpd };
    averagedDefensesMoveName = effectiveMove.name;
  }

  // 스피드스왑(swapsSpeedWithTarget): 자신·상대의 스피드 실능을 서로 맞바꾼다.
  let swappedSpeedMoveName: string | undefined;
  if (effectiveMove.swapsSpeedWithTarget) {
    const aSpe = attacker.realStats.spe;
    attacker.realStats = { ...attacker.realStats, spe: defender.realStats.spe };
    defender.realStats = { ...defender.realStats, spe: aSpe };
    swappedSpeedMoveName = effectiveMove.name;
  }

  // 변신(transformsIntoTarget): 상대로 변신한다. 이미 변신 상태면 실패(1v1이라 배틀 끝까지 유지).
  let transformedIntoName: string | undefined;
  let transformFailed = false;
  if (effectiveMove.transformsIntoTarget) {
    if (attacker.transformed) {
      transformFailed = true;
    } else {
      applyTransform(attacker, defender);
      transformedIntoName = getPokemon(defender.slot.pokemonId)?.name ?? "상대";
    }
  }

  // 뿌리박기/아쿠아링: 이미 걸려있으면 재사용 실패(지속 효과 중복 방지, 필드/트릭룸과 같은 패턴).
  let regenSetFailed = false;
  if (effectiveMove.setsRegenVolatile) {
    if (hasVolatile(attacker.volatile, effectiveMove.setsRegenVolatile)) {
      regenSetFailed = true;
    } else {
      attacker.volatile = inflictVolatile(attacker.volatile, effectiveMove.setsRegenVolatile, random);
    }
  }

  // 씨뿌리기: 풀타입 상대에겐 통하지 않는다(본가 규칙 — 가루 기술과 같은 축의 면역). 그 외에는
  // 상대가 이미 씨앗이 박혀있으면 실패.
  let leechSeedSetFailed = false;
  let leechSeedBlockedByGrass = false;
  if (effectiveMove.setsLeechSeed) {
    if (defender.types.includes("풀")) {
      leechSeedBlockedByGrass = true;
    } else if (hasVolatile(defender.volatile, "leechSeed")) {
      leechSeedSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "leechSeed", random);
    }
  }

  // 조이기·엉겨붙기·집게덫 등(bindsTarget): 데미지를 준 뒤 상대를 4~5턴 속박한다(volatile "bound").
  // 대타를 맞혔거나 이미 속박 중이면 갱신하지 않는다.
  if (
    effectiveMove.bindsTarget &&
    damage > 0 &&
    !hitSubstitute &&
    !isFainted(defender) &&
    !hasVolatile(defender.volatile, "bound")
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "bound", random);
  }

  // 심플빔("단순")·바뀌어라 등(setsTargetAbilityId): 명중 시 상대 특성을 지정 id로 바꾼다.
  // 방어/대타/황금몸/매직미러로 상대 방향 효과가 막혔으면 무발동. 이미 그 특성이면 실패 표기.
  let abilitySwappedTargetToName: string | undefined;
  let abilitySwapFailed = false;
  if (effectiveMove.setsTargetAbilityId && hit && !opponentEffectsBlocked && !isFainted(defender)) {
    if (defender.effectiveAbilityId === effectiveMove.setsTargetAbilityId) {
      abilitySwapFailed = true;
    } else {
      defender.effectiveAbilityId = effectiveMove.setsTargetAbilityId;
      abilitySwappedTargetToName = getAbility(effectiveMove.setsTargetAbilityId)?.name ?? effectiveMove.setsTargetAbilityId;
    }
  }

  // 대타출동: 이미 대타가 있거나, 최대 HP 1/4보다 현재 HP가 많지 않으면(=쓰면 자신이 기절하거나
  // 대타 HP가 0 이하가 되는 경우) 실패한다. 성공하면 그 즉시 HP를 깎고 같은 양만큼의 대타를 세운다.
  let substituteSetFailed = false;
  if (effectiveMove.setsSubstitute) {
    const substituteCost = Math.floor(attacker.maxHp / 4);
    if (attacker.substituteHp !== undefined || attacker.currentHp <= substituteCost) {
      substituteSetFailed = true;
    } else {
      attacker.currentHp -= substituteCost;
      attacker.substituteHp = substituteCost;
    }
  }

  // 사슬묶기: 상대가 "바로 직전에 쓴 기술"(defender.lastMoveId) 하나를 4턴간 봉인한다.
  // 상대가 아직 아무 기술도 안 썼거나(등장 직후) 이미 disable이 걸려있으면 실패한다.
  let setDisabledMoveName: string | undefined;
  let disableSetFailed = false;
  if (effectiveMove.setsDisable) {
    if (!defender.lastMoveId || hasVolatile(defender.volatile, "disable")) {
      disableSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "disable", random, defender.lastMoveId);
      setDisabledMoveName = getMove(defender.lastMoveId)?.name;
      // 멘탈허브: 사슬묶기가 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(defenderItem, defender.itemConsumed ?? false)) {
        defender.volatile = { active: { ...defender.volatile.active } };
        delete defender.volatile.active.disable;
        consumeItem(defender);
        statusCureBerryItemName = defenderItem!.name;
        setDisabledMoveName = undefined;
      }
    }
  }

  // 앙코르: 상대가 "바로 직전에 쓴 기술"만 3턴간 강제로 반복하게 만든다(사슬묶기의 반대 방향).
  // 마찬가지로 상대가 아직 아무 기술도 안 썼거나 이미 encore가 걸려있으면 실패한다.
  let setEncoreMoveName: string | undefined;
  let encoreSetFailed = false;
  if (effectiveMove.setsEncore) {
    if (!defender.lastMoveId || hasVolatile(defender.volatile, "encore")) {
      encoreSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "encore", random, defender.lastMoveId);
      setEncoreMoveName = getMove(defender.lastMoveId)?.name;
      // 멘탈허브: 앙코르가 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(defenderItem, defender.itemConsumed ?? false)) {
        defender.volatile = { active: { ...defender.volatile.active } };
        delete defender.volatile.active.encore;
        consumeItem(defender);
        statusCureBerryItemName = defenderItem!.name;
        setEncoreMoveName = undefined;
      }
    }
  }

  // 파워트릭: 명중 시(항상 자기 자신 대상) 두 실수치를 그 자리에서 맞바꾼다. 킬가르도
  // 배틀스위치가 폼 전환 시 realStats를 직접 교체하는 것과 같은 패턴이라 재계산이 필요 없다.
  let swappedStatsMoveName: string | undefined;
  if (effectiveMove.swapsOwnStats) {
    const [statA, statB] = effectiveMove.swapsOwnStats;
    const valueA = attacker.realStats[statA];
    attacker.realStats = { ...attacker.realStats, [statA]: attacker.realStats[statB], [statB]: valueA };
    swappedStatsMoveName = effectiveMove.name;
  }

  // 방어류(방어/판별/버티기/킹실드): 연속 사용 횟수(protectStreak)에 따라 이번 턴 실제로 발동할
  // 확률이 (1/3)^streak로 줄어든다. 직전에 실패했거나 이력이 없으면(streak 0) 확률 1 = 무조건 발동.
  //
  // §1 G (2차 지시 반영): 굴림에 성공하면 무조건 "방어태세에 들어갔다!"(protectStanceEntered)를 낸다.
  // 그 뒤 상대가 이번 턴 낸 기술이 "이 포켓몬을 겨냥"했으면 실제로 막은 것 → "몸을 지켜냈다!"
  // (protectSucceeded), 자기 대상 기술(칼춤·철벽 등)이라 막을 게 없었으면 → "방어는 실패했다!"
  // (protectFailed). 굴림에 실패하면(연속 사용) 태세 진입 없이 바로 "방어는 실패했다!"만.
  // 버티기(endure)·길동무(destinyBond)는 별도 문구 축이라 protectStanceEntered에서 제외.
  let protectSucceeded = false;
  let protectFailed = false;
  let protectStanceEntered = false;
  // 매직미러 반사 중이면(bounceActive) attacker/defender가 맞바뀐 상태라 이 방어류 블록을 통째로
  // 건너뛴다 — 되돌린 기술은 반사한 쪽(현재 attacker)의 방어 행동이 아니므로 protectStreak도
  // 건드리면 안 된다.
  if (effectiveMove.protectEffect && !bounceActive) {
    const streak = attacker.protectStreak ?? 0;
    const successChance = Math.pow(1 / 3, streak);
    const rollPassed = random() < successChance;
    const targetedSelf =
      effectiveMove.protectEffect === "destinyBond" || isOpponentTargetingMove(defenderMove);
    if (!rollPassed) {
      // 연속 사용 굴림 실패 — 태세 진입도 없이 그대로 실패.
      attacker.protectStreak = 0;
      protectFailed = true;
    } else {
      attacker.protectStreak = streak + 1;
      protectStanceEntered = effectiveMove.protectEffect === "block";
      // 길동무는 activeProtect(매 턴 시작 시 초기화)가 아니라 destinyBondArmed(자신의 다음
      // 행동 전까지 유지)로 별도 추적한다 — 이번 턴 상대 공격을 막는 게 아니기 때문.
      if (effectiveMove.protectEffect === "destinyBond") {
        attacker.destinyBondArmed = true;
        protectSucceeded = true;
      } else {
        attacker.activeProtect = {
          effect: effectiveMove.protectEffect,
          moveName: effectiveMove.name,
          contactPenalty: effectiveMove.protectContactPenalty,
          contactDamageFraction: effectiveMove.protectContactDamageFraction,
        };
        // 태세엔 들어갔지만 상대가 자기 대상 기술만 냈으면 "막을 게 없어" 실패로 표기.
        if (targetedSelf) protectSucceeded = true;
        else protectFailed = true;
      }
    }
  } else if (!bounceActive) {
    attacker.protectStreak = 0;
  }

  // 필드 설치: 이미 다른(또는 같은) 필드가 깔려있으면 실패한다 — 필드를 쓸 때마다 지속 턴수가
  // 갱신되던 버그 수정. 기존 필드가 다 사라지기 전까지는 필드 기술 자체가 실패해야 한다.
  let fieldSetFailed = false;
  if (effectiveMove.setsField) {
    if (state.field) {
      fieldSetFailed = true;
    } else {
      state.field = effectiveMove.setsField;
      state.fieldTurnsRemaining = FIELD_DURATION;
    }
  }

  // 스텔스록: 상대 진영에 설치한다. 이미 그 진영에 깔려 있으면 실패한다(사용자 확인).
  // 매직미러 반사 중이면 바인딩이 맞바뀌어 있으므로 설치 대상 진영은 defenderKey가 아니라
  // 원래 시전자 쪽(actorKey)이다. (교체가 없는 현행 엔진에선 등장 데미지가 없어 실질 효과는
  // "어느 진영 플래그가 켜지나"뿐이지만, 방향은 맞게 기록해 둔다.)
  let stealthRockSetForSide: FighterKey | undefined;
  let spikesSetForSide: FighterKey | undefined;
  let hazardSetFailed = false;
  if (effectiveMove.setsHazard !== undefined) {
    const hazardSide = bounceActive ? actorKey : defenderKey;
    const board = effectiveMove.setsHazard === "spikes" ? state.spikes : state.stealthRock;
    if (board[hazardSide]) {
      // 비검천중파처럼 명중 부가효과로 까는 데미지기는 "이미 깔림"이어도 공격 자체는 성공이라
      // 실패 플래그를 세우지 않는다 — 변화기(압정뿌리기·스텔스록)만 실패로 표시한다.
      if (effectiveMove.category === "status") hazardSetFailed = true;
    } else {
      board[hazardSide] = true;
      if (effectiveMove.setsHazard === "spikes") spikesSetForSide = hazardSide;
      else stealthRockSetForSide = hazardSide;
    }
  }

  // ── 매직미러 반사 구간 끝 ── 바인딩을 원위치한다. 이후 로그·나무열매·매지션·폼 전환 등
  // 후처리는 전부 원래 공격/방어 방향 기준으로 돌아간다.
  if (bounceActive) {
    [attacker, defender] = [defender, attacker];
    [attackerAbility, defenderAbility] = [defenderAbility, attackerAbility];
    [attackerItem, defenderItem] = [defenderItem, attackerItem];
  }

  // 멸망의노래(setsPerishSong, F-4): 장에 있는 양쪽에게 멸망 카운트 3을 건다. 방어·대타·황금몸을
  // 무시하므로 opponentEffectsBlocked로 게이팅하지 않는다. 방음(blocksSound) 특성이나 발동 시점에
  // 차징(공중날기·구멍파기 등)으로 다른 장소 취급인 포켓몬에겐 카운트가 시작되지 않는다.
  // 양쪽 다 이미 카운트 중이면 재사용 실패.
  let perishSongStarted = false;
  let perishSongFailed = false;
  if (effectiveMove.setsPerishSong) {
    const attackerEligible = attacker.perishCount === undefined && !attackerAbility?.blocksSound;
    const defenderEligible =
      defender.perishCount === undefined && !defenderAbility?.blocksSound && defender.chargingMoveId === undefined;
    if (!attackerEligible && !defenderEligible) {
      perishSongFailed = true;
    } else {
      if (attackerEligible) attacker.perishCount = 3;
      if (defenderEligible) defender.perishCount = 3;
      perishSongStarted = true;
    }
  }

  // 아이언롤러: 명중하면 활성 필드를 제거한다. usageCondition: "field-required"로 필드가 없으면
  // 애초에 이 지점까지 오지 못하니(맨 위에서 이미 실패 처리), 여기선 있는 필드를 지우기만 하면 된다.
  let destroyedField: FieldKind | undefined;
  if (effectiveMove.destroysField && state.field) {
    destroyedField = state.field;
    state.field = undefined;
    state.fieldTurnsRemaining = undefined;
  }

  // 트릭룸도 필드와 같은 이유로 이미 걸려있으면 재사용 시 실패 처리한다(지속 턴수 갱신 방지) —
  // 다만 아직 아무 효과도 안 걸린 채로 게임이 끝나는 극단적 경우는 없으니 별 문제 없음.
  let trickRoomSetFailed = false;
  if (effectiveMove.setsTrickRoom) {
    if (state.trickRoomTurnsRemaining !== undefined) {
      trickRoomSetFailed = true;
    } else {
      state.trickRoomTurnsRemaining = TRICK_ROOM_DURATION;
    }
  }

  // 날씨 변화 기술(비바라기 등): 필드/트릭룸과 달리 이미 다른(또는 같은) 날씨가 있어도 실패하지
  // 않고 항상 덮어쓴다 — 실패라는 개념 자체가 없다(본가 규칙). 지속시간은 특성/수동 선택으로
  // 걸렸을 때와 마찬가지로 WEATHER_DURATION(+바위 보너스)으로 다시 채워진다(카운트다운 초기화).
  if (effectiveMove.setsWeather) {
    state.weather = effectiveMove.setsWeather;
    const rockBonus =
      attackerItem?.weatherDurationBonus?.weather === effectiveMove.setsWeather
        ? attackerItem.weatherDurationBonus.bonus
        : 0;
    state.weatherTurnsRemaining = WEATHER_DURATION + rockBonus;
    // 기분파(캐스퐁): 날씨가 바뀌면 그 자리에서 타입을 다시 맞춘다.
    applyForecastForm(state.a, activeWeather(state));
    applyForecastForm(state.b, activeWeather(state));
  }

  // 리플렉터/빛의장막: 자신 쪽에 이미 같은 스크린이 걸려있으면 실패(필드/트릭룸과 같은 패턴).
  // 빛의점토를 지녔으면 지속시간이 늘어난다.
  let screenSetFailed = false;
  if (effectiveMove.setsScreen) {
    if (attacker.screens[effectiveMove.setsScreen] !== undefined) {
      screenSetFailed = true;
    } else {
      const screenBonus = attackerItem?.screenDurationBonus ?? 0;
      attacker.screens = { ...attacker.screens, [effectiveMove.setsScreen]: SCREEN_DURATION + screenBonus };
    }
  }

  // 자뭉열매/오랭열매: 이번 행동으로 생긴 모든 HP 변화(피격/반동/회복 등)가 끝난 뒤, 체력이 최대
  // HP 1/2 이하인 쪽(공격자든 방어자든)이 있으면 자동 발동한다. attacker를 먼저 확인하는 순서는
  // 임의지만, 도구는 각자 한 개씩만 지니므로 서로 간섭하지 않는다.
  let attackerBerryHealAmount = 0;
  let attackerBerryHealItemName: string | undefined;
  if (!isFainted(attacker) && !attackerBerriesBlocked) {
    attackerBerryHealAmount = getHpThresholdBerryHeal(
      attackerItem,
      attacker.currentHp,
      attacker.maxHp,
      attacker.itemConsumed ?? false,
    );
    if (attackerBerryHealAmount > 0) {
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + attackerBerryHealAmount);
      consumeItem(attacker);
      attackerBerryHealItemName = attackerItem!.name;
    }
  }
  let defenderBerryHealAmount = 0;
  let defenderBerryHealItemName: string | undefined;
  if (!isFainted(defender) && !defenderBerriesBlocked) {
    defenderBerryHealAmount = getHpThresholdBerryHeal(
      defenderItem,
      defender.currentHp,
      defender.maxHp,
      defender.itemConsumed ?? false,
    );
    if (defenderBerryHealAmount > 0) {
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + defenderBerryHealAmount);
      consumeItem(defender);
      defenderBerryHealItemName = defenderItem!.name;
    }
  }

  // 자기과신: 자신의 데미지로 상대를 실제로 쓰러뜨렸을 때만 발동. resolveAction은 상대가 이미
  // 쓰러진 상태로는 호출되지 않으므로(runTurn의 break), 여기서 isFainted(defender)가 true라면
  // 이번 행동 중에 쓰러진 것이다 — 데미지를 준 경우로 한정해 상태이상/씨뿌리기 등 무관한 원인은 제외.
  if (isDamaging && damage > 0 && isFainted(defender) && attackerAbility?.boostsStatOnKo) {
    const boost = attackerAbility.boostsStatOnKo;
    attacker.stages = applyStageDelta(attacker.stages, boost.stat, contraryDelta(attacker, boost.delta));
  }

  // 마지막일침(포챔스판): 이 기술의 데미지로 상대를 실제로 쓰러뜨리면 사용자 스탯이 오른다.
  // 자기과신(위)과 완전히 같은 축 — 특성이 아니라 기술 단위라는 점만 다르다.
  if (isDamaging && damage > 0 && isFainted(defender) && effectiveMove.boostsUserStatOnKo) {
    const boost = effectiveMove.boostsUserStatOnKo;
    attacker.stages = applyStageDelta(attacker.stages, boost.stat, contraryDelta(attacker, boost.delta));
  }

  // 레이징불·깨트리기(breaksScreensOnHit): 명중하면 상대 쪽 스크린을 전부 제거한다. 위 데미지
  // 계산은 스크린이 살아있는 상태로 이미 끝났으니(그 턴엔 아직 경감), 여기서 제거만 한다.
  let brokeScreens: ("reflect" | "lightScreen" | "auroraVeil")[] | undefined;
  if (effectiveMove.breaksScreensOnHit) {
    const present = (Object.keys(defender.screens) as ("reflect" | "lightScreen" | "auroraVeil")[]).filter(
      (s) => defender.screens[s] !== undefined,
    );
    if (present.length > 0) {
      defender.screens = {};
      brokeScreens = present;
    }
  }

  // 곡예: 이번 행동 도중 도구가 있었다가(전) 없어졌으면(후 — 나무열매 소모든 매지션에게
  // 강탈당했든 원인 무관) 그 즉시 한 번만 발동해서 배틀 끝까지 스피드 2배를 유지한다. 이미
  // 발동했으면(unburdenActive) 다시 판정하지 않는다.
  let unburdenSelfAbilityName: string | undefined;
  if (
    attackerAbility?.doublesSpeedOnItemLoss &&
    !attacker.unburdenActive &&
    attackerItemIdBeforeAction !== null &&
    attacker.currentItemId === null
  ) {
    attacker.unburdenActive = true;
    unburdenSelfAbilityName = attackerAbility.name;
  }
  let unburdenOpponentAbilityName: string | undefined;
  if (
    defenderAbility?.doublesSpeedOnItemLoss &&
    !defender.unburdenActive &&
    defenderItemIdBeforeAction !== null &&
    defender.currentItemId === null
  ) {
    defender.unburdenActive = true;
    unburdenOpponentAbilityName = defenderAbility.name;
  }

  // 대타에 통째로 막힘: 상대를 겨냥한 기술인데 대타를 실제로 깎지도(hitSubstitute) 못했으면
  // (= 변화기이거나 데미지 0), 본체엔 아무 일도 안 일어난 것이라 "실패" 문구를 낸다.
  const blockedBySubstituteMoveName =
    blockedBySubstitute && !hitSubstitute && isOpponentTargetingMove(effectiveMove) ? effectiveMove.name : undefined;
  const powderBlockedMoveName = blockedByPowderImmunity ? effectiveMove.name : undefined;

  return {
    actor: actorKey,
    move,
    hit: true,
    critical: isCritical,
    damage,
    damagePercent,
    typeEffectiveness,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    inflictedStatus,
    inflictedVolatile,
    opponentStatDrops: opponentStatDrops.length > 0 ? opponentStatDrops : undefined,
    statusInflictFailed: statusInflictFailed || undefined,
    protectStanceEntered: protectStanceEntered || undefined,
    reflectedStatDropAbilityName,
    reflectedStatDrops: reflectedStatDrops.length > 0 ? reflectedStatDrops : undefined,
    crashDamage: crashDamage || undefined,
    selfDamageOnUse: selfDamageOnUse || undefined,
    canceledTargetChargeMoveName,
    endeavorDamage: endeavorDamage || undefined,
    counterDamage: counterDamage || undefined,
    counterFailed: counterFailed || undefined,
    perishSongStarted: perishSongStarted || undefined,
    perishSongFailed: perishSongFailed || undefined,
    curedStatus,
    curedStatusTarget,
    selfWokeBeforeMove,
    blockedBySubstituteMoveName,
    powderBlockedMoveName,
    setField: fieldSetFailed ? undefined : effectiveMove.setsField,
    fieldSetFailed,
    stealthRockSetForSide,
    spikesSetForSide,
    hazardSetFailed,
    abilitySwappedTargetToName,
    abilitySwapFailed: abilitySwapFailed || undefined,
    ateBerryName: stuffCheeksBerryName,
    ateBerryHeal: stuffCheeksBerryHeal || undefined,
    berryEatFailed: berryEatFailed || undefined,
    bouncedMoveName,
    bouncedByAbilityName,
    secondaryBlockedByAbilityName,
    destroyedField,
    setTrickRoom: trickRoomSetFailed ? undefined : effectiveMove.setsTrickRoom,
    trickRoomSetFailed,
    setWeather: effectiveMove.setsWeather,
    setScreen: screenSetFailed ? undefined : effectiveMove.setsScreen,
    screenSetFailed,
    brokeScreens,
    fainted: isFainted(defender),
    selfFainted: isFainted(attacker),
    recoilDamage,
    enduredItemName,
    enduredAbilityName,
    restoredStatsSelfItemName,
    restoredStatsOpponentItemName,
    hitCount,
    itemRecoilDamage: itemRecoilDamage || undefined,
    itemRecoilItemName,
    berryReducedDamageItemName,
    leppaRestoredPpItemName,
    drainHealAmount: drainHealAmount || undefined,
    shellBellHealAmount: shellBellHealAmount || undefined,
    healedAmount: healedAmount || undefined,
    healedTarget,
    restSlept,
    setRegenVolatile: regenSetFailed ? undefined : effectiveMove.setsRegenVolatile,
    regenSetFailed,
    setLeechSeed: leechSeedSetFailed || leechSeedBlockedByGrass ? undefined : effectiveMove.setsLeechSeed,
    leechSeedSetFailed,
    leechSeedBlockedByGrass: leechSeedBlockedByGrass || undefined,
    setSubstitute: substituteSetFailed ? undefined : effectiveMove.setsSubstitute,
    substituteSetFailed,
    setDisabledMoveName,
    disableSetFailed,
    setEncoreMoveName,
    encoreSetFailed,
    swappedStatsMoveName,
    averagedDefensesMoveName,
    swappedSpeedMoveName,
    shellSideArmCategory,
    transformedIntoName,
    transformFailed: transformFailed || undefined,
    sheerForceAbilityName,
    substituteBroke,
    hitSubstitute,
    hitNegatedByAbilityName,
    disguiseRecoilDamage,
    triggeredDestinyBond: destinyBondTriggered || undefined,
    protectSucceeded,
    protectFailed,
    selfStatRises: selfStatRises.length ? selfStatRises : undefined,
    selfStatsAtMax: selfStatsAtMax.length ? selfStatsAtMax : undefined,
    blockedByProtectMoveName,
    enduredProtectMoveName,
    protectContactPenaltyMoveName,
    protectContactDamage: protectContactDamage || undefined,
    followUpHitDamage: followUpHitDamage || undefined,
    pressureExtraPpAbilityName,
    statusCureBerryItemName,
    attackerBerryHealAmount: attackerBerryHealAmount || undefined,
    attackerBerryHealItemName,
    defenderBerryHealAmount: defenderBerryHealAmount || undefined,
    defenderBerryHealItemName,
    abilityInflictedStatusOnAttacker,
    abilityInflictedStatusAbilityName,
    abilityInflictedVolatileOnAttacker,
    abilityInflictedVolatileAbilityName,
    abilityDamageToAttacker: abilityDamageToAttacker || undefined,
    abilityDamageAbilityName,
    abilityDisabledMoveName,
    abilityDisableAbilityName,
    pickpocketStolenItemName,
    pickpocketAbilityName,
    mummifiedAttackerAbilityName,
    abilityRaisedDefenderStatsAbilityName,
    abilityRaisedDefenderStats: abilityRaisedDefenderStats.length ? abilityRaisedDefenderStats : undefined,
    abilityLoweredDefenderStats: abilityLoweredDefenderStats.length ? abilityLoweredDefenderStats : undefined,
    abilityAbsorbedMoveType,
    abilityAbsorbAbilityName,
    soundproofBlockedByAbilityName,
    abilityAbsorbHealAmount: abilityAbsorbHealAmount || undefined,
    resetAllStages: effectiveMove.resetsAllStages || undefined,
    stolenItemName,
    unburdenSelfAbilityName,
    unburdenOpponentAbilityName,
    sleepTalkCalledMoveName,
    changedOwnTypeTo,
    changedOwnTypeAbilityName,
  };
}

export interface RunTurnOutcome {
  /** 이번 턴 결과가 반영된 새 BattleState. prevState는 변형하지 않는다 */
  nextState: BattleState;
  result: TurnResult;
}

/**
 * 한 턴을 진행시킨다. prevState는 변형하지 않고, 복사본에 적용한 새 상태를 nextState로 돌려준다.
 * 우선도 → 실효 스피드(마비 0.5배 포함) → 동속 랜덤 순으로 순서를 정하고,
 * 먼저 움직인 쪽이 상대를 쓰러뜨리면 나중 쪽은 행동하지 않는다.
 * 마지막에 양쪽 다 살아있으면 상태이상 매턴 데미지를 적용한다.
 */
export function runTurn(
  prevState: BattleState,
  moveA: Move,
  moveB: Move,
  random: () => number = Math.random,
): RunTurnOutcome {
  const state: BattleState = {
    a: cloneFighter(prevState.a),
    b: cloneFighter(prevState.b),
    weather: prevState.weather,
    weatherTurnsRemaining: prevState.weatherTurnsRemaining,
    field: prevState.field,
    fieldTurnsRemaining: prevState.fieldTurnsRemaining,
    trickRoomTurnsRemaining: prevState.trickRoomTurnsRemaining,
    stealthRock: { ...prevState.stealthRock },
    spikes: { ...prevState.spikes },
    turnNumber: prevState.turnNumber + 1,
    entryAnnouncements: prevState.entryAnnouncements,
  };

  // 방어류(방어/판별/버티기/킹실드)는 "이번 턴 한정" 효과라 매 턴 시작 시 항상 지운다 —
  // 지난 턴에 세운 게 이번 턴까지 남아있으면 안 된다. 연속 성공 스트릭(protectStreak)은
  // 반대로 배틀 끝까지 유지되는 값이라 여기서 건드리지 않는다.
  state.a.activeProtect = undefined;
  state.b.activeProtect = undefined;
  // 미러코트/카운터/앙갚음/메탈버스트용 — 이번 턴 받은 카테고리별 데미지 누적기를 0으로 초기화한다(F-1).
  state.a.damageTakenThisTurn = { physical: 0, special: 0 };
  state.b.damageTakenThisTurn = { physical: 0, special: 0 };
  // 질투의불꽃용 — 이번 턴이 시작된 시점의 랭크를 스냅샷해 둔다(턴 중 랭크가 올랐는지 판정).
  state.a.statStagesAtTurnStart = { ...state.a.stages };
  state.b.statStagesAtTurnStart = { ...state.b.stages };

  // 기분파(캐스퐁): 턴 시작 시점의 유효 날씨(날씨부정 반영)에 맞춰 타입을 다시 맞춘다.
  applyForecastForm(state.a, activeWeather(state));
  applyForecastForm(state.b, activeWeather(state));

  // 의태(메더): 턴 시작 시점의 필드에 맞춰 타입을 다시 맞춘다. 필드 타입으로 바뀌면 안내한다.
  const turnStartAnnouncements: string[] = [];
  for (const key of ["a", "b"] as const) {
    const changedTo = applyMimicryForm(state[key], state.field);
    if (changedTo) {
      const nm = getPokemon(state[key].slot.pokemonId)?.name ?? "포켓몬";
      turnStartAnnouncements.push(`${nm}${eunNeun(nm)} ${changedTo} 타입이 되었다!`);
    }
  }

  const aAbilityForSpeed = state.a.effectiveAbilityId ? getAbility(state.a.effectiveAbilityId) : undefined;
  const bAbilityForSpeed = state.b.effectiveAbilityId ? getAbility(state.b.effectiveAbilityId) : undefined;
  // 서투름: 구애스카프 등 스피드 관련 도구 효과도 예외 없이 무효화된다.
  const aItem = aAbilityForSpeed?.disablesOwnItemEffects
    ? undefined
    : state.a.currentItemId
      ? getItem(state.a.currentItemId)
      : undefined;
  const bItem = bAbilityForSpeed?.disablesOwnItemEffects
    ? undefined
    : state.b.currentItemId
      ? getItem(state.b.currentItemId)
      : undefined;
  // 엽록소·쓱쓱·모래헤치기: 날씨가 일치할 때만 곱해진다(그 외엔 1)
  const getWeatherSpeedMultiplier = (ability: Ability | undefined): number => {
    const boost = ability?.weatherSpeedMultiplier;
    return boost && boost.weather === activeWeather(state) ? boost.multiplier : 1;
  };
  // 구애스카프(1.5)·검은철구(0.5) — 상태이상 배율과 별개로 곱해진다
  // 곡예: 도구를 잃은 뒤로 배틀 끝까지 유지되는 2배 배율(unburdenActive)도 여기서 같이 곱한다.
  const speedA =
    state.a.realStats.spe *
    computeStatusSpeedMultiplier(state.a.status.condition) *
    getItemSpeedMultiplier(aItem) *
    getWeatherSpeedMultiplier(aAbilityForSpeed) *
    (state.a.unburdenActive ? 2 : 1);
  const speedB =
    state.b.realStats.spe *
    computeStatusSpeedMultiplier(state.b.status.condition) *
    getItemSpeedMultiplier(bItem) *
    getWeatherSpeedMultiplier(bAbilityForSpeed) *
    (state.b.unburdenActive ? 2 : 1);

  // 트릭룸 판정은 이번 턴이 시작된 시점(=아직 이번 턴 행동을 하나도 반영하지 않은 상태)의 값을
  // 쓴다 — 이번 턴에 트릭룸을 새로 걸어도 그 즉시 같은 턴의 순서 계산에는 영향을 주지 않는다
  // (본가 규칙: 순서는 행동 전에 이미 정해짐).
  const trickRoomActive = state.trickRoomTurnsRemaining !== undefined;
  // 그래스슬라이더처럼 필드 조건부로 우선도가 오르는 기술은, 순서를 정하는 이 시점의 필드
  // 상태(=이번 턴 시작 시점)를 기준으로 반영한다. 짓궂은마음(변화기 우선도 +1)도 같이 더한다.
  // compareTurnOrder는 move.priority만 보므로 우선도만 조정한 얕은 복사본을 넘긴다.
  const priorityAdjustedMoveA = {
    ...moveA,
    priority: getFieldAdjustedPriority(moveA, state.field) + getAbilityPriorityBoost(moveA, aAbilityForSpeed),
  };
  const priorityAdjustedMoveB = {
    ...moveB,
    priority: getFieldAdjustedPriority(moveB, state.field) + getAbilityPriorityBoost(moveB, bAbilityForSpeed),
  };

  // 선제공격손톱: 실제 우선도가 같을 때만 끼어든다(더 높은 우선도는 이 효과와 무관하게 항상 이김).
  // 양쪽 다 발동하면(둘 다 이 도구를 지녔고 둘 다 확률에 성공) 서로 상쇄되어 정상적인 스피드
  // 비교로 넘어간다 — 어느 한쪽만 발동했을 때만 그쪽이 확정으로 먼저 움직인다.
  const priorityTied = priorityAdjustedMoveA.priority === priorityAdjustedMoveB.priority;
  const aQuickClaw = priorityTied && getQuickClawTriggered(aItem, random);
  const bQuickClaw = priorityTied && getQuickClawTriggered(bItem, random);
  const quickClawWinner: FighterKey | undefined =
    aQuickClaw && !bQuickClaw ? "a" : bQuickClaw && !aQuickClaw ? "b" : undefined;

  const firstIsA = quickClawWinner
    ? quickClawWinner === "a"
    : compareTurnOrder(
        {
          realSpeed: speedA,
          move: priorityAdjustedMoveA,
          stages: state.a.stages,
          movesLast: aAbilityForSpeed?.movesLastInPriorityBracket,
        },
        {
          realSpeed: speedB,
          move: priorityAdjustedMoveB,
          stages: state.b.stages,
          movesLast: bAbilityForSpeed?.movesLastInPriorityBracket,
        },
        random,
        trickRoomActive,
      ) === 0;

  const order: [FighterKey, FighterKey] = firstIsA ? ["a", "b"] : ["b", "a"];
  const moves: Record<FighterKey, Move> = { a: moveA, b: moveB };

  const actions: ActionLogEntry[] = [];
  let winner: FighterKey | "draw" | undefined;

  for (const key of order) {
    if (isFainted(state[key])) continue; // 이미 쓰러진 쪽은 행동 못 함
    if (isFainted(state[opponentKey(key)])) break; // 상대가 이미 쓰러졌으면 더 진행할 필요 없음
    // 포커스렌즈 판정용 — 이번 턴 order 기준으로 상대보다 늦게 움직이는 쪽인지
    const movesSecond = order[1] === key;
    const action = resolveAction(state, key, moves[key], random, movesSecond, moves[opponentKey(key)]);
    actions.push(action);

    // 발버둥 반동이나 자폭류로 "상대를 쓰러뜨리면서 자신도 같이 쓰러지는" 행동 하나 안에서는
    // resolveAction이 항상 상대 데미지를 먼저 적용한 뒤에 반동/자멸을 적용하도록 순서를 지킨다
    // (위 코드 참고) — 즉 상대가 이 행동으로 먼저 쓰러진 뒤에 자신이 쓰러진 것이므로, 실제
    // 게임처럼 이 행동을 한 쪽이 승자가 된다. 무승부가 아니다.
    if (action.fainted && action.selfFainted) {
      winner = key;
      break;
    }
  }

  const endOfTurn: EndOfTurnLogEntry[] = [];
  // 멸망의노래로 이번 턴 종료에 쓰러진 쪽(F-4) — 양쪽 다면 스피드 느린 쪽이 승리한다.
  const perishFaintedKeys = new Set<FighterKey>();

  // winner가 이미 액션 중 자폭 콤보로 정해졌으면, 배틀이 그 시점에 끝난 것이니
  // 턴 종료 회복/상태이상 데미지는 더 진행하지 않는다(실제 게임에서도 배틀이 이미 끝났다).
  if (!winner && !isFainted(state.a) && !isFainted(state.b)) {
    for (const key of (["a", "b"] as const)) {
      const fighter = state[key];

      // 멸망의노래 카운트(F-4): 매 턴 종료 시 현재 카운트를 로그로 찍고 1 줄인다. 0에서
      // 다음 감소 시점에 HP가 0이 된다("3턴 후 기절" = 건 턴 포함 4번째 턴 종료).
      if (fighter.perishCount !== undefined && !isFainted(fighter)) {
        if (fighter.perishCount <= 0) {
          fighter.currentHp = 0;
          perishFaintedKeys.add(key);
          endOfTurn.push({ actor: key, damage: 0, remainingHp: 0, fainted: true, perishFainted: true });
          continue; // 이미 쓰러졌으니 이 포켓몬의 나머지 턴 종료 처리(회복 등)는 건너뛴다
        }
        endOfTurn.push({
          actor: key,
          damage: 0,
          remainingHp: fighter.currentHp,
          fainted: false,
          perishCount: fighter.perishCount,
        });
        fighter.perishCount -= 1;
      }

      // 그래스필드: 매 턴 종료 시 최대 HP 1/16 회복
      const fieldHeal = computeFieldEndOfTurnHeal(state.field, fighter.maxHp);
      if (fieldHeal > 0) {
        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + fieldHeal);
        endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, fieldHeal });
      }

      // 서투름: 턴 종료 시 발동하는 도구 효과(먹다남은음식 등)도 예외 없이 무효화된다.
      const fighterAbilityForItem = fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
      const fighterItem = fighterAbilityForItem?.disablesOwnItemEffects
        ? undefined
        : fighter.currentItemId
          ? getItem(fighter.currentItemId)
          : undefined;
      // 긴장감: 상대가 이 특성이면 이 포켓몬의 나무열매(자뭉열매/오랭열매 등)가 막힌다 —
      // 먹다남은음식은 나무열매가 아니라서 이 플래그와 무관하게 그대로 발동한다.
      const opponentAbilityForItem = state[opponentKey(key)].effectiveAbilityId
        ? getAbility(state[opponentKey(key)].effectiveAbilityId!)
        : undefined;
      const fighterBerriesBlocked = !!opponentAbilityForItem?.preventsOpponentBerries;

      // 먹다남은음식: 턴 종료 시 항상(생존해 있으면) 최대 HP의 1/6 회복
      if (fighterItem?.endOfTurnHealDenominator) {
        const itemHeal = Math.min(
          fighter.maxHp - fighter.currentHp,
          Math.floor(fighter.maxHp / fighterItem.endOfTurnHealDenominator),
        );
        if (itemHeal > 0) {
          fighter.currentHp += itemHeal;
          endOfTurn.push({
            actor: key,
            damage: 0,
            remainingHp: fighter.currentHp,
            fainted: false,
            itemHeal,
            itemHealItemName: fighterItem.name,
          });
        }
      }

      // 젖은접시: 이 특성을 지닌 쪽은 날씨가 조건과 일치하는 동안 매 턴 종료 시 최대 HP의
      // 1/denominator 회복. 먹다남은음식과 별개 축이라 같은 턴에 둘 다 발동할 수 있다.
      const fighterAbility = fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
      const weatherHealBoost = fighterAbility?.weatherEndOfTurnHealDenominator;
      if (weatherHealBoost && weatherHealBoost.weather === activeWeather(state)) {
        const abilityWeatherHeal = Math.min(
          fighter.maxHp - fighter.currentHp,
          Math.floor(fighter.maxHp / weatherHealBoost.denominator),
        );
        if (abilityWeatherHeal > 0) {
          fighter.currentHp += abilityWeatherHeal;
          endOfTurn.push({
            actor: key,
            damage: 0,
            remainingHp: fighter.currentHp,
            fainted: false,
            abilityWeatherHeal,
            abilityWeatherHealAbilityName: fighterAbility!.name,
          });
        }
      }

      // 건조피부: 쾌청(강한 햇살)일 때 매 턴 종료 시 최대 HP의 1/8 피해. weatherEndOfTurnHealDenominator
      // (비 회복)와 반대 축이며, 한 특성이 날씨에 따라 회복/피해를 나눠 갖는다.
      const weatherDamageBoost = fighterAbility?.weatherEndOfTurnDamageDenominator;
      if (
        weatherDamageBoost &&
        weatherDamageBoost.weather === activeWeather(state) &&
        !isFainted(fighter) &&
        !fighterAbility?.negatesIndirectDamage
      ) {
        const dmg = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / weatherDamageBoost.denominator));
        if (dmg > 0) {
          fighter.currentHp -= dmg;
          endOfTurn.push({
            actor: key,
            damage: dmg,
            remainingHp: fighter.currentHp,
            fainted: isFainted(fighter),
            abilityWeatherDamage: dmg,
            abilityWeatherDamageAbilityName: fighterAbility!.name,
          });
        }
      }

      // 뿌리박기/아쿠아링: 걸려있는 동안 매 턴 종료 시 최대 HP 1/16 회복(큰뿌리 소지 시 1.3배)
      const regenSource = hasVolatile(fighter.volatile, "ingrain")
        ? "ingrain"
        : hasVolatile(fighter.volatile, "aquaRing")
          ? "aquaRing"
          : undefined;
      if (regenSource) {
        const regenHeal = Math.min(
          fighter.maxHp - fighter.currentHp,
          Math.floor((fighter.maxHp / 16) * getDrainHealMultiplier(fighterItem)),
        );
        if (regenHeal > 0) {
          fighter.currentHp += regenHeal;
          endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, regenHeal, regenSource });
        }
      }

      // 씨뿌리기: 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃고, 상대가 그만큼(+상대의 큰뿌리 배율)
      // 회복한다. 상대가 이미 기절해 있으면(동시에 둘 다 씨앗이 걸린 극단적 경우 등) 회복은 스킵.
      // 매직가드: 걸린 쪽이 매직가드면 HP를 잃지 않고, 따라서 상대 회복도 없다(본가 규칙).
      if (hasVolatile(fighter.volatile, "leechSeed") && !fighterAbility?.negatesIndirectDamage) {
        const seedDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / 8));
        fighter.currentHp -= seedDamage;
        endOfTurn.push({
          actor: key,
          damage: 0,
          remainingHp: fighter.currentHp,
          fainted: isFainted(fighter),
          leechSeedDamage: seedDamage,
        });
        const healer = state[opponentKey(key)];
        if (seedDamage > 0 && !isFainted(healer)) {
          const healerAbilityForItem = healer.effectiveAbilityId ? getAbility(healer.effectiveAbilityId) : undefined;
          const healerItem = healerAbilityForItem?.disablesOwnItemEffects
            ? undefined
            : healer.currentItemId
              ? getItem(healer.currentItemId)
              : undefined;
          const leechSeedHealAmount = Math.min(
            healer.maxHp - healer.currentHp,
            Math.floor(seedDamage * getDrainHealMultiplier(healerItem)),
          );
          if (leechSeedHealAmount > 0) {
            healer.currentHp += leechSeedHealAmount;
            endOfTurn.push({
              actor: opponentKey(key),
              damage: 0,
              remainingHp: healer.currentHp,
              fainted: false,
              leechSeedHealAmount,
            });
          }
        }
      }

      // 속박(bound): 조이기·엉겨붙기·집게덫류에 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃고,
      // 턴 종료마다 카운터가 1씩 줄어 0에서 자동 해제된다. 매직가드면 데미지 면제(카운터는 진행).
      if (hasVolatile(fighter.volatile, "bound")) {
        if (!fighterAbility?.negatesIndirectDamage) {
          const bindDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / 8));
          fighter.currentHp -= bindDamage;
          if (bindDamage > 0) {
            endOfTurn.push({
              actor: key,
              damage: bindDamage,
              remainingHp: fighter.currentHp,
              fainted: isFainted(fighter),
              boundDamage: true,
            });
          }
        }
        fighter.volatile = consumeVolatileTurn(fighter.volatile, "bound");
      }

      // 희망사항: drowsy와 같은 2턴 카운터 패턴 — 쓴 다음 턴 종료에 최대 HP 절반을 회복한다.
      const wishEntry = fighter.volatile.active.wish;
      if (wishEntry) {
        const triggersNow = wishEntry.turnsRemaining <= 1;
        fighter.volatile = consumeVolatileTurn(fighter.volatile, "wish");
        if (triggersNow && !isFainted(fighter)) {
          const wishHeal = Math.min(fighter.maxHp - fighter.currentHp, Math.floor(fighter.maxHp * 0.5));
          if (wishHeal > 0) {
            fighter.currentHp += wishHeal;
            endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, wishHeal });
          }
        }
      }

      // 하품(졸음): 2턴 카운터가 1(=이번이 마지막 소모)이면 이번 턴 종료에 실제로 잠듦을 시도한다.
      // 그 사이 다른 상태이상이 걸렸거나 타입/필드로 잠듦 면역이 생겼으면 조용히 무산된다(본가 규칙).
      const drowsyEntry = fighter.volatile.active.drowsy;
      if (drowsyEntry) {
        const triggersNow = drowsyEntry.turnsRemaining <= 1;
        fighter.volatile = consumeVolatileTurn(fighter.volatile, "drowsy");
        if (
          triggersNow &&
          !fighter.status.condition &&
          !isImmuneToStatus("sleep", fighter.types, fighterAbility?.immuneToStatuses) &&
          !isStatusBlockedByField(state.field, "sleep")
        ) {
          fighter.status = inflictStatus(fighter.status, "sleep");
          endOfTurn.push({
            actor: key,
            damage: 0,
            remainingHp: fighter.currentHp,
            fainted: false,
            inflictedDelayedStatus: "sleep",
          });
        }
      }

      // 모래바람 틱 데미지(§1 F-3): 바위/땅/강철 타입이 아니면 매 턴 종료 시 최대 HP 1/16.
      // 매직가드·모래 관련 특성(모래숨기/모래의힘/모래날림/모래헤치기) 보유 시 면제.
      // (본가의 방진 특성·방진고글 도구는 포챔스에 없어 제외. 싸라기눈 틱도 없음.)
      if (
        activeWeather(state) === "모래바람" &&
        !isFainted(fighter) &&
        !fighter.types.some((t) => t === "바위" || t === "땅" || t === "강철") &&
        !fighterAbility?.negatesIndirectDamage &&
        !SANDSTORM_IMMUNE_ABILITY_NAMES.has(fighterAbility?.name ?? "")
      ) {
        const sandDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / 16));
        fighter.currentHp -= sandDamage;
        if (sandDamage > 0) {
          endOfTurn.push({
            actor: key,
            damage: sandDamage,
            remainingHp: fighter.currentHp,
            fainted: isFainted(fighter),
            sandstormDamage: true,
          });
        }
      }

      if (fighter.status.condition) {
        const statusCondition = fighter.status.condition;
        // 포이즌힐: 독·맹독 상태면 지속 데미지 대신 최대 HP의 1/denominator를 회복한다. 맹독
        // 카운터(advanceStatusTurn)는 그대로 누적된다.
        const poisonHealDenom = fighterAbility?.healsFromPoisonEachTurnDenominator;
        if (
          poisonHealDenom &&
          (statusCondition === "poison" || statusCondition === "badly-poisoned") &&
          !isFainted(fighter)
        ) {
          const heal = Math.min(fighter.maxHp - fighter.currentHp, Math.floor(fighter.maxHp / poisonHealDenom));
          fighter.currentHp += heal;
          fighter.status = advanceStatusTurn(fighter.status);
          if (heal > 0) {
            endOfTurn.push({
              actor: key,
              damage: 0,
              remainingHp: fighter.currentHp,
              fainted: false,
              poisonHealAmount: heal,
              poisonHealAbilityName: fighterAbility!.name,
            });
          }
        } else {
          // 매직가드: 독·맹독·화상의 지속 데미지만 0으로 막는다 — 상태이상에 "걸린" 상태 자체와
          // 맹독 카운터 누적(advanceStatusTurn)은 그대로 진행된다.
          const damage = fighterAbility?.negatesIndirectDamage
            ? 0
            : computeStatusEndOfTurnDamage(fighter.status, fighter.maxHp);
          fighter.currentHp = Math.max(0, fighter.currentHp - damage);
          fighter.status = advanceStatusTurn(fighter.status);
          // 잠듦/얼음/마비는 매턴 데미지가 없다(항상 0) — "상태이상 데미지 0"만 찍는 무의미한 줄을
          // 막기 위해 실제로 데미지가 있을 때만 로그에 남긴다.
          if (damage > 0) {
            endOfTurn.push({
              actor: key,
              damage,
              remainingHp: fighter.currentHp,
              fainted: isFainted(fighter),
              statusCondition,
            });
          }
        }
      }

      // 탈피: 턴 종료 시점(=위 상태이상 데미지 틱까지 끝난 뒤)에 이 확률로 자신의 주 상태이상을
      // 치료한다. 이미 기절했으면 발동할 이유가 없다.
      if (fighter.status.condition && fighterAbility?.curesOwnStatusChance && !isFainted(fighter)) {
        if (random() * 100 < fighterAbility.curesOwnStatusChance) {
          const abilityCuredStatus = fighter.status.condition;
          fighter.status = { ...NO_STATUS_CONDITION };
          endOfTurn.push({
            actor: key,
            damage: 0,
            remainingHp: fighter.currentHp,
            fainted: false,
            abilityCuredStatus,
            abilityCuredStatusAbilityName: fighterAbility.name,
          });
        }
      }

      // 가속(Speed Boost): 매 턴 종료 시 스피드 1랭크 상승. 본가는 "교체로 나온 턴"엔 발동하지
      // 않지만, 이 시뮬레이터는 교체가 없는 1대1 대면 전용이라 첫 턴도 "등장한 턴"이 아니다 —
      // 그래서 첫 턴 종료부터 발동시킨다(사용자 확인, Phase 6.5 §6-2 ①). 파티 선출·교체가
      // 도입되면 그때 "교체로 나온 턴" 예외를 되살린다. 기절했으면(이 턴 데미지로 방금 쓰러졌어도)
      // 발동하지 않는다.
      if (fighterAbility?.boostsSpeedEachTurnEnd && !isFainted(fighter)) {
        const speBefore = fighter.stages.spe;
        fighter.stages = applyStageDelta(fighter.stages, "spe", contraryDelta(fighter, 1));
        endOfTurn.push({
          actor: key,
          damage: 0,
          remainingHp: fighter.currentHp,
          fainted: false,
          speedBoostAbilityName: fighterAbility.name,
          speedBoostAtCap: fighter.stages.spe === speBefore || undefined,
        });
      }

      // 변덕쟁이(Moody): 매 턴 종료 시 5스탯 중 하나를 랜덤으로 +2, 그와 다른 하나를 -1.
      if (fighterAbility?.moodyRandomStages && !isFainted(fighter)) {
        const MOODY_STATS: BattleStatKey[] = ["atk", "def", "spa", "spd", "spe"];
        const raised = MOODY_STATS[Math.floor(random() * MOODY_STATS.length)];
        const lowerPool = MOODY_STATS.filter((s) => s !== raised);
        const lowered = lowerPool[Math.floor(random() * lowerPool.length)];
        fighter.stages = applyStageDelta(fighter.stages, raised, contraryDelta(fighter, 2));
        fighter.stages = applyStageDelta(fighter.stages, lowered, contraryDelta(fighter, -1));
        endOfTurn.push({
          actor: key,
          damage: 0,
          remainingHp: fighter.currentHp,
          fainted: false,
          moodyRaisedStat: raised,
          moodyLoweredStat: lowered,
          moodyAbilityName: fighterAbility.name,
        });
      }

      // 자뭉열매/오랭열매: 턴 종료 시점까지의 모든 HP 변화(필드 회복/먹다남은음식/씨뿌리기/상태이상
      // 데미지 등)가 끝난 뒤에도 다시 한번 확인한다 — 액션 중엔 안 걸렸다가 턴 종료 데미지로
      // 뒤늦게 1/2 이하가 되는 경우를 놓치지 않기 위해서다.
      if (!isFainted(fighter) && !fighterBerriesBlocked) {
        const berryHeal = getHpThresholdBerryHeal(fighterItem, fighter.currentHp, fighter.maxHp, fighter.itemConsumed ?? false);
        if (berryHeal > 0) {
          fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + berryHeal);
          consumeItem(fighter);
          endOfTurn.push({
            actor: key,
            damage: 0,
            remainingHp: fighter.currentHp,
            fainted: false,
            berryHeal,
            berryHealItemName: fighterItem!.name,
          });
        }
      }
    }
  }

  // 멸망의노래로 양쪽이 동시에 쓰러졌으면 무승부가 아니라 스피드가 느린 쪽이 승리한다(F-4) —
  // 빠른 쪽이 먼저 쓰러지는 것으로 취급. 랭크 반영 실효 스피드로 비교(트릭룸은 무관).
  if (!winner && perishFaintedKeys.size === 2) {
    const effSpeedA = speedA * rankStageMultiplier(state.a.stages.spe);
    const effSpeedB = speedB * rankStageMultiplier(state.b.stages.spe);
    winner = effSpeedA <= effSpeedB ? "a" : "b";
  }

  // 턴 종료 상태이상 데미지로 양쪽이 동시에 0이 되는 경우만 진짜 무승부로 남는다 — 이건 어느 한
  // 쪽이 상대를 쓰러뜨린 게 아니라 각자 자기 상태이상으로 따로 쓰러진 것이라 인과관계가 없다.
  if (!winner) {
    if (isFainted(state.a) && isFainted(state.b)) winner = "draw";
    else if (isFainted(state.a)) winner = "b";
    else if (isFainted(state.b)) winner = "a";
  }

  // 필드 지속 턴 카운트다운. 0이 되면 이번 턴을 끝으로 필드가 사라진다.
  let fieldExpired = false;
  if (state.field && state.fieldTurnsRemaining !== undefined) {
    state.fieldTurnsRemaining -= 1;
    if (state.fieldTurnsRemaining <= 0) {
      state.field = undefined;
      state.fieldTurnsRemaining = undefined;
      fieldExpired = true;
    }
  }

  // 트릭룸도 같은 방식으로 카운트다운한다.
  let trickRoomExpired = false;
  if (state.trickRoomTurnsRemaining !== undefined) {
    state.trickRoomTurnsRemaining -= 1;
    if (state.trickRoomTurnsRemaining <= 0) {
      state.trickRoomTurnsRemaining = undefined;
      trickRoomExpired = true;
    }
  }

  // 날씨도 같은 방식으로 카운트다운한다. weatherTurnsRemaining은 날씨가 아예 없을 때만
  // undefined이고, 특성/수동/기술 어느 경로로 걸렸든 항상 유한 턴수를 갖는다(챔피언스 규칙).
  let weatherExpired = false;
  if (state.weatherTurnsRemaining !== undefined) {
    state.weatherTurnsRemaining -= 1;
    if (state.weatherTurnsRemaining <= 0) {
      state.weather = undefined;
      state.weatherTurnsRemaining = undefined;
      weatherExpired = true;
      // 기분파(캐스퐁): 날씨가 사라지면 노말로 되돌린다.
      applyForecastForm(state.a, activeWeather(state));
      applyForecastForm(state.b, activeWeather(state));
    }
  }

  // 리플렉터/빛의장막은 필드/날씨와 달리 "양쪽 다 따로" 걸릴 수 있어 각자 카운트다운한다.
  const expiredScreens: { actor: FighterKey; screen: "reflect" | "lightScreen" | "auroraVeil" }[] = [];
  for (const key of (["a", "b"] as const)) {
    const fighter = state[key];
    for (const screenType of ["reflect", "lightScreen", "auroraVeil"] as const) {
      const remaining = fighter.screens[screenType];
      if (remaining === undefined) continue;
      const next = remaining - 1;
      if (next <= 0) {
        fighter.screens = { ...fighter.screens, [screenType]: undefined };
        expiredScreens.push({ actor: key, screen: screenType });
      } else {
        fighter.screens = { ...fighter.screens, [screenType]: next };
      }
    }
  }

  return {
    nextState: state,
    result: {
      turnNumber: state.turnNumber,
      order,
      actions,
      endOfTurn,
      winner,
      field: state.field,
      fieldTurnsRemaining: state.fieldTurnsRemaining,
      fieldExpired,
      trickRoomTurnsRemaining: state.trickRoomTurnsRemaining,
      trickRoomExpired,
      weatherTurnsRemaining: state.weatherTurnsRemaining,
      weatherExpired,
      expiredScreens,
      turnStartAnnouncements,
    },
  };
}
