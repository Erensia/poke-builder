import type { Move } from "../types/move";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { PokemonType } from "../types/pokemon-type";
import {
  NEUTRAL_ACCURACY_STAGES,
  NEUTRAL_CRIT_STAGE,
  NEUTRAL_STAGES,
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
import { getEffectiveForm, getEffectiveAbilityId } from "./pokemonForm";
import { computeRealStats } from "./statCalculator";
import { applyMoveStatChanges, applyStageDelta, clampStagesToNonNegative } from "./statStages";
import { hitTriggerMatchesMove } from "./abilityHitTriggers";
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
  CONFUSION_SELF_HIT_CHANCE,
  CONFUSION_SELF_HIT_POWER,
  consumeVolatileTurn,
  hasVolatile,
  inflictVolatile,
} from "./volatileConditions";
import { resolveMoveContext } from "./moveContext";
import { computeDamage } from "./battlePower";
import { getWeatherDamageMultiplier, computeWeatherHealFraction } from "./weatherEffects";
import {
  FIELD_DURATION,
  applyFieldPulse,
  computeFieldEndOfTurnHeal,
  getFieldAdjustedPriority,
  getFieldDamageMultiplier,
  getFieldPowerMultiplier,
  isConfusionBlockedByField,
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
  /** 나무열매(카리열매 등)처럼 대전 중 1회만 발동하는 지닌 도구를 이미 썼으면 true */
  itemConsumed?: boolean;
  /**
   * 리플렉터(물리)/빛의장막(특수) — 이 포켓몬 쪽에 걸려있는 스크린과 각각의 남은 턴 수.
   * "아군이 받는 데미지 감소"라 1v1에서는 이 포켓몬 자신이 상대 공격을 맞을 때 적용된다.
   */
  screens: Partial<Record<"reflect" | "lightScreen", number>>;
  /**
   * 타오르는불꽃처럼 "이 타입 기술을 무효화한 이후로 자신이 쓰는 그 타입 기술 위력이 오른다"는
   * 특성이 실제로 발동한 적 있으면 그 배수가 채워진다(교체가 없는 1v1이라 배틀 끝까지 유지).
   * 정적 데이터(Ability.absorbsType)만으로는 "발동한 적 있는지"를 표현할 수 없어 런타임 상태로 분리했다.
   */
  ownMoveTypeBoosts: Partial<Record<PokemonType, number>>;
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
  turnNumber: number;
  /** 배틀 시작 시점에 특성으로 날씨가 자동으로 바뀌었으면("○○의 잔비!") 그 안내 문구 */
  entryAnnouncements: string[];
}

export type FighterKey = "a" | "b";

/** 상대 키를 구한다 */
export function opponentKey(key: FighterKey): FighterKey {
  return key === "a" ? "b" : "a";
}

/**
 * 파티 슬롯과 보유 기술 목록으로 초기 배틀 상태를 만든다. HP는 만HP로 시작하고,
 * 랭크·명중/회피/급소 카운터·상태이상은 전부 중립, PP는 각 기술의 최대치로 채운다.
 */
export function createFighterState(slot: EvaluatorSlot, moves: Move[]): BattleFighterState {
  const pokemon = getPokemon(slot.pokemonId);
  if (!pokemon) throw new Error(`알 수 없는 포켓몬: ${slot.pokemonId}`);

  const form = getEffectiveForm(pokemon, slot);
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);

  return {
    slot,
    types: form.types,
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
    screens: {},
    ownMoveTypeBoosts: {},
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
    announcements,
  } = resolveEntryWeather(a, fighterA, b, fighterB, weather);

  return {
    a: fighterA,
    b: fighterB,
    weather: resolvedWeather,
    weatherTurnsRemaining,
    turnNumber: 0,
    entryAnnouncements: announcements,
  };
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
  | "psychicFieldPriority"
  | "usageCondition";

/** 한 번의 기술 사용 결과 로그 */
export interface ActionLogEntry {
  actor: FighterKey;
  move: Move;
  /** 주 상태이상(잠듦/얼음/마비)이나 행동방해(풀죽음/반동/혼란 자멸)로 기술을 못 썼으면 채워진다 */
  blockedReason?: ActionBlockReason;
  /** blockedReason이 "status"일 때, 정확히 어떤 상태이상 때문인지(마비/잠듦/얼음) — UI가 "몸이 저려서"/"쿨쿨 잠들어"/"얼어 버려서" 문구를 골라 쓰는 데 필요 */
  blockedByStatus?: StatusConditionState["condition"];
  /** 회피/빗나감 여부. 필중기는 항상 true. blockedReason이 있으면 의미 없음 */
  hit: boolean;
  critical: boolean;
  damage: number;
  damagePercent: number;
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
  /** 이 행동으로 defender가 쓰러졌으면 true */
  fainted: boolean;
  /** 혼란 자멸로 스스로 쓰러졌으면 true */
  selfFainted: boolean;
  /** 이 행동으로 필드가 새로 깔렸으면(그래스필드 등) 채워진다 */
  setField?: FieldKind;
  /** 필드 기술을 썼지만 이미 다른 필드가 깔려있어서 실패했으면 true */
  fieldSetFailed?: boolean;
  /** 아이언롤러처럼 필드를 파괴하는 기술이 명중해서 활성 필드가 없어졌으면, 없어지기 직전의 필드 종류 */
  destroyedField?: FieldKind;
  /** 이 행동으로 트릭룸이 새로 걸렸으면 true */
  setTrickRoom?: boolean;
  /** 트릭룸을 썼지만 이미 걸려있어서 실패했으면 true */
  trickRoomSetFailed?: boolean;
  /** 이 행동으로 날씨가 바뀌었으면(비바라기 등) 그 날씨. 실패라는 개념이 없어 항상 성공 시 채워진다 */
  setWeather?: WeatherKind;
  /** 이 행동으로 리플렉터/빛의장막이 자신 쪽에 새로 걸렸으면 채워진다 */
  setScreen?: "reflect" | "lightScreen";
  /** 리플렉터/빛의장막을 썼지만 이미 같은 스크린이 걸려있어서 실패했으면 true */
  screenSetFailed?: boolean;
  /**
   * 불꽃세례·웨이브태클·브레이브버드·양날박치기(Move.recoilFraction)로 입은 반동 데미지.
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
  /** 까칠한피부처럼 방어측 특성이 발동해 공격자에게 고정 데미지를 줬으면 그 양 */
  abilityDamageToAttacker?: number;
  /** abilityDamageToAttacker를 준 특성 이름 */
  abilityDamageAbilityName?: string;
  /** 저주받은바디처럼 방어측 특성이 발동해 공격자가 방금 쓴 기술을 봉인(PP 0)했으면 그 기술 이름 */
  abilityDisabledMoveName?: string;
  /** abilityDisabledMoveName을 봉인시킨 특성 이름 */
  abilityDisableAbilityName?: string;
  /** 타오르는불꽃/피뢰침처럼 방어측 특성이 이 기술의 타입을 통째로 무효화했으면 그 타입 */
  abilityAbsorbedMoveType?: PokemonType;
  /** abilityAbsorbedMoveType을 무효화한 특성 이름 */
  abilityAbsorbAbilityName?: string;
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
  expiredScreens: { actor: FighterKey; screen: "reflect" | "lightScreen" }[];
}

function isFainted(fighter: BattleFighterState): boolean {
  return fighter.currentHp <= 0;
}

function cloneFighter(fighter: BattleFighterState): BattleFighterState {
  return {
    ...fighter,
    stages: { ...fighter.stages },
    accuracyStages: { ...fighter.accuracyStages },
    status: { ...fighter.status },
    volatile: { active: { ...fighter.volatile.active } },
    remainingPp: { ...fighter.remainingPp },
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
  const attacker = state[actorKey];
  const defender = state[defenderKey];

  // 차지 기술 2턴째: 준비 턴에 저장해둔 기술을 이번 턴 실제로 고른 기술과 무관하게 강제로
  // 재실행한다(본가 규칙 — UI에서도 이 경우 선택을 요구하지 않는다). PP는 준비 턴에 이미
  // 소모했으니 여기선 다시 깎지 않는다.
  const releasingCharge = attacker.chargingMoveId !== undefined;
  if (releasingCharge) {
    const storedMove = getMove(attacker.chargingMoveId!);
    if (storedMove) move = storedMove;
    attacker.chargingMoveId = undefined;
  }

  // 일찍기상(잠듦 해제 확률 스케줄에 필요)은 상태이상 판정이 이 아래(0번 사용조건 이후)에서
  // 바로 일어나서, 아래쪽에서 별도로 조회하는 attackerAbility보다 먼저 필요하다.
  const attackerHasEarlyBird = attacker.effectiveAbilityId === "일찍기상";

  // PP 소모는 행동 여부와 무관하게 발생(단, 차지 기술 2턴째는 위에서 이미 스킵 처리)
  let leppaRestoredPpItemName: string | undefined;
  if (!releasingCharge && attacker.remainingPp[move.id] !== undefined) {
    const ppBefore = attacker.remainingPp[move.id];
    attacker.remainingPp[move.id] = Math.max(0, ppBefore - 1);
    // 과사열매: 이번 사용으로 PP가 정확히 0이 됐을 때(원래 0이던 걸 또 쓴 게 아니라)만 발동한다.
    if (ppBefore > 0 && attacker.remainingPp[move.id] === 0 && !attacker.itemConsumed) {
      const itemForPp = attacker.slot.item ? getItem(attacker.slot.item) : undefined;
      if (itemForPp?.restoresPpOnZero) {
        attacker.remainingPp[move.id] = Math.min(move.pp, itemForPp.restoresPpOnZero);
        attacker.itemConsumed = true;
        leppaRestoredPpItemName = itemForPp.name;
      }
    }
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
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    fainted: false,
    selfFainted: isFainted(attacker),
    recoilDamage: 0,
    leppaRestoredPpItemName,
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

  // 2-1) 사이코필드: 우선도 +1 이상인 기술로 상대를 노리면 그 기술 자체가 실패한다
  if (isPriorityMoveBlockedByField(state.field, move.priority)) {
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

  // 4) 차지 기술 1턴째(공중날기 등): 준비만 하고 이번 턴엔 데미지를 주지 않는다. 맑음 날씨의
  // 솔라빔처럼 chargeSkipWeather가 현재 날씨와 일치하면 준비 없이 곧장 2턴째처럼 실행한다.
  // releasingCharge면 이미 2턴째(위에서 move를 저장된 기술로 바꿔치기했음)라 여기 안 들어온다.
  if (move.chargeTurn && !releasingCharge) {
    const skipsCharge = move.chargeSkipWeather !== undefined && state.weather === move.chargeSkipWeather;
    if (!skipsCharge) {
      attacker.chargingMoveId = move.id;
      return {
        actor: actorKey,
        move,
        hit: true,
        critical: false,
        damage: 0,
        damagePercent: 0,
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

  const attackerAbility = attacker.effectiveAbilityId ? getAbility(attacker.effectiveAbilityId) : undefined;
  const defenderAbility = defender.effectiveAbilityId ? getAbility(defender.effectiveAbilityId) : undefined;
  const attackerItem = attacker.slot.item ? getItem(attacker.slot.item) : undefined;
  const defenderItem = defender.slot.item ? getItem(defender.slot.item) : undefined;

  // 필드 조건부 타입/위력 변경(대지의파동=fieldPulse, 미스트버스트·와이드포스·라이징볼트=
  // powerMultiplierInField)을 특성 배율 계산보다 먼저 반영한다 — 타입이 바뀐 상태여야
  // resolveMoveContext 안의 상성 계산(getEffectiveness)에도 바뀐 타입이 들어간다. 둘 중
  // 한 기술이 두 속성을 동시에 갖는 경우는 없어서(대지의파동만 fieldPulse, 나머지 셋만
  // powerMultiplierInField) 순서·중복 곱셈 걱정 없이 그냥 합쳐도 안전하다.
  const fieldPulse = applyFieldPulse(move, state.field);
  const fieldPowerMultiplier = getFieldPowerMultiplier(move, state.field);
  const fieldAdjustedMove: Move = {
    ...move,
    type: fieldPulse.type,
    power: fieldPulse.power === null ? null : Math.round(fieldPulse.power * fieldPowerMultiplier),
  };

  // evaluateSlotMatchup(1턴 스냅샷 판정)과 같은 로직을 공유 — 특성 배율/타입 변경/자속/상대 상성
  const {
    effectiveMove,
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
    state.weather,
    defenderItem,
    attacker.currentHp / attacker.maxHp,
    defender.currentHp === defender.maxHp,
    defender.status.condition !== null,
  );

  // 타오르는불꽃 발동 이후로 자신(=현재 공격자)이 쓰는 그 타입 기술의 위력이 올라있으면 반영.
  // 절대 타입이 null인 기술(발버둥 등)은 boosts 조회 자체를 건너뛴다.
  const ownMoveTypeBoostMultiplier =
    (effectiveMove.type ? attacker.ownMoveTypeBoosts[effectiveMove.type] : undefined) ?? 1;

  // 메트로놈(연속 같은 기술 위력 증가)용 스트릭 갱신 — 여기까지 왔다는 건 앞의 모든 행동방해
  // 판정(상태이상/풀죽음/반동/혼란/차지 등)을 통과해서 실제로 이 기술을 쓴다는 뜻이라, 명중 여부와
  // 무관하게 여기서 갱신한다(본가 규칙 — 빗나가도 스트릭은 유지되고, 다른 기술을 쓰면 끊긴다).
  attacker.lastMoveStreak = attacker.lastMoveId === effectiveMove.id ? (attacker.lastMoveStreak ?? 1) + 1 : 1;
  attacker.lastMoveId = effectiveMove.id;

  // 반짝가루(방어측 0.9배)·광각렌즈(공격측 1.1배)·포커스렌즈(공격측, 늦게 움직일 때 1.2배)·
  // 모래숨기(방어측, 날씨 조건부 0.8배)를 전부 한 배율로 곱한다.
  const weatherAccuracyBoost = defenderAbility?.weatherOpponentAccuracyMultiplier;
  const abilityAccuracyMultiplier =
    weatherAccuracyBoost && weatherAccuracyBoost.weather === state.weather ? weatherAccuracyBoost.multiplier : 1;
  const accuracyExtraMultiplier =
    getItemAccuracyMultiplier(attackerItem, defenderItem, movesSecond) * abilityAccuracyMultiplier;
  // 날카로운눈: 공격측이 이 특성이면 상대의 회피율 상승분을 무시한다(원문 "상대의 회피율을
  // 무시하고 공격한다") — 다만 회피율이 마이너스인 경우(오히려 공격측에게 유리)는 그대로
  // 존중한다. 0 이하로 클램프하지 않고 min(evasion, 0)만 적용하면 두 조건을 동시에 만족한다.
  const effectiveDefenderEvasion = attackerAbility?.ignoresOpponentEvasionBoost
    ? Math.min(defender.accuracyStages.evasion, 0)
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
  const defenderHideType = defender.chargingMoveId ? getMove(defender.chargingMoveId)?.chargeHideType : undefined;
  const evadedByCharge = !!defenderHideType && !(effectiveMove.bypassesHiding ?? []).includes(defenderHideType);

  const hit = evadedByCharge ? false : hitChance === null ? true : random() < hitChance;

  if (!hit) {
    // 자폭류(대폭발 등)는 빗나가도 사용자가 반드시 기절한다 (본가 규칙). 데미지가 아예 없는
    // 경로라 승자 판정에 영향을 줄 순서 문제도 없다 — 그냥 여기서 바로 처리해도 된다.
    if (effectiveMove.selfFaints) {
      attacker.currentHp = 0;
    }
    return {
      actor: actorKey,
      move,
      hit,
      critical: false,
      damage: 0,
      damagePercent: 0,
      defenderRemainingHp: defender.currentHp,
      selfDamage: 0,
      attackerRemainingHp: attacker.currentHp,
      fainted: false,
      selfFainted: isFainted(attacker),
      recoilDamage: 0,
      evadedByCharge,
      leppaRestoredPpItemName,
    };
  }

  // 타오르는불꽃/피뢰침: 명중한 시점에 카테고리 무관(상태이상 기술도 포함)으로 발동한다 — 위에서
  // 이미 typeEffectiveness를 0으로 덮어써놨으니 데미지 계산 쪽은 자연히 0이 되고, 여기서는
  // 그 즉시 랭크 변화 + (있다면) 자기 타입 기술 위력 상승 플래그만 별도로 적용하면 된다.
  let abilityAbsorbedMoveType: PokemonType | undefined;
  let abilityAbsorbAbilityName: string | undefined;
  if (absorbedByDefenderAbility && defenderAbility?.absorbsType) {
    const absorb = defenderAbility.absorbsType;
    abilityAbsorbedMoveType = absorb.type;
    abilityAbsorbAbilityName = defenderAbility.name;
    if (absorb.selfStatChanges) {
      for (const change of absorb.selfStatChanges) {
        defender.stages = applyStageDelta(defender.stages, change.stat, change.delta);
      }
    }
    if (absorb.boostsOwnMoveTypeMultiplier) {
      defender.ownMoveTypeBoosts = { ...defender.ownMoveTypeBoosts, [absorb.type]: absorb.boostsOwnMoveTypeMultiplier };
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
  let abilityDamageToAttacker = 0;
  let abilityDamageAbilityName: string | undefined;
  let abilityDisabledMoveName: string | undefined;
  let abilityDisableAbilityName: string | undefined;

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
    const critical =
      effectiveMove.alwaysCrit ||
      random() < critChance(attacker.critStage + getItemCritStageBonus(attackerItem), effectiveMove.highCritRatio);
    const ignoreBurnPenalty = ignoresBurnAttackPenalty(attackerAbility?.id, effectiveMove.id);
    const statusAttackMultiplier = computeStatusAttackMultiplier(
      attacker.status.condition,
      effectiveMove.category,
      ignoreBurnPenalty,
    );
    const weatherMultiplier = getWeatherDamageMultiplier(state.weather, effectiveMove.type);
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
      defenderItem,
      effectiveMove.type,
      typeEffectiveness,
      defender.itemConsumed ?? false,
    );
    if (berryResult.consumed) {
      defender.itemConsumed = true;
      berryReducedDamageItemName = defenderItem?.name;
    }

    // 리플렉터(물리)/빛의장막(특수): 방어측 자기 스크린이 걸려있으면 데미지 반감. 급소는
    // 스크린을 무시한다(본가 규칙) — bulkMultiplier는 나눗셈이라 2를 곱하면 절반이 된다.
    const screenType = effectiveMove.category === "physical" ? "reflect" : "lightScreen";
    const screenMultiplier = !critical && defender.screens[screenType] !== undefined ? 2 : 1;

    const result = computeDamage(attacker.realStats, defender.realStats, attacker.types, hitMove, {
      typeEffectiveness,
      abilityMultiplier:
        abilityOffenseMultiplier * statusAttackMultiplier * hidingBypassMultiplier * ownMoveTypeBoostMultiplier,
      weatherMultiplier,
      fieldMultiplier,
      itemMultiplier,
      stabMultiplier,
      attackerStages: attacker.stages,
      defenderStages: defender.stages,
      bulkMultiplier: abilityDefenseMultiplier * berryResult.bulkMultiplier * screenMultiplier,
      isCritical: critical,
      randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
    });
    return { damage: result?.damage ?? 0, isCritical: critical };
  }

  // 기합의띠(최대 HP 상태에서만, 1회)·기합의머리띠(조건 없이 매번 확률): 이번 데미지로 정확히
  // 기절했을 때만(currentHp가 0이 됐을 때만) 판정 대상이 된다. preHp는 이번 데미지를 받기
  // 직전 HP — 기합의띠의 "최대 HP 상태" 조건과 애초에 죽어있던 게 아니었는지 확인에 쓴다.
  // 다단히트 루프 안에서 타수마다 호출되므로, 한 타에서 버텨도 다음 타에서 다시 죽을 수 있고
  // (기합의머리띠는 매번 재판정, 기합의띠는 이미 소모돼 두 번은 못 버팀) 그건 본가와 동일하다.
  let enduredItemName: string | undefined;
  let enduredAbilityName: string | undefined;
  function applyEndurance(preHp: number): void {
    if (defender.currentHp > 0 || preHp <= 0) return;
    const result = getEnduranceResult(defenderItem, preHp, defender.maxHp, defender.itemConsumed ?? false, random);
    if (result.survives) {
      defender.currentHp = 1;
      enduredItemName = defenderItem?.name;
      if (result.consumes) defender.itemConsumed = true;
      return;
    }
    // 옹골참: 기합의띠와 조건은 같지만(최대 HP 상태) 소모되지 않아 매번 다시 판정한다.
    if (defenderAbility?.survivesLethalAtFullHp && preHp === defender.maxHp) {
      defender.currentHp = 1;
      enduredAbilityName = defenderAbility.name;
    }
  }

  /**
   * 방어측 hitTrigger 특성 한 번의 "타격"에 대한 판정. 다단히트 기술은 타수마다 이 함수를
   * 다시 호출해서 확률(chance)을 매번 새로 굴린다 — 정전기/불꽃몸이 트리플악셀 3타에 각각
   * 별도로 마비/화상을 노릴 수 있고, 까칠한피부/저주받은바디도 타수만큼 반복 발동한다.
   * hitDamage가 0(면역 등)이면 애초에 판정하지 않는다. 공격자가 이미 기절했으면(예: 앞선
   * 타에서 까칠한피부 반동으로 죽었으면) 더 이상 판정하지 않는다.
   */
  function triggerAbilityHitEffect(hitDamage: number): void {
    if (hitDamage <= 0 || isFainted(attacker)) return;
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
    if (trigger.damagesAttackerFraction) {
      const amount = Math.floor(attacker.maxHp * trigger.damagesAttackerFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      abilityDamageToAttacker += amount;
      abilityDamageAbilityName = defenderAbility!.name;
    }
    if (trigger.selfStatChanges) {
      for (const change of trigger.selfStatChanges) {
        defender.stages = applyStageDelta(defender.stages, change.stat, change.delta);
      }
    }
    if (trigger.disablesAttackerMove && attacker.remainingPp[move.id] !== undefined) {
      attacker.remainingPp[move.id] = 0;
      abilityDisabledMoveName = move.name;
      abilityDisableAbilityName = defenderAbility!.name;
    }
  }

  if (isDamaging && effectiveMove.fixedDamage !== undefined) {
    // 나이트헤드류: 방어/랭크/특성/도구/급소를 전부 무시하고 고정 수치만 깎는다.
    // 타입 상성 면역(0배)만은 그대로 존중 — 반감/2배는 적용하지 않는다.
    damage = typeEffectiveness === 0 ? 0 : effectiveMove.fixedDamage;
    damagePercent = damage / defender.realStats.hp;
    {
      const preHp = defender.currentHp;
      defender.currentHp = Math.max(0, defender.currentHp - damage);
      applyEndurance(preHp);
      triggerAbilityHitEffect(damage);
    }
  } else if (isDamaging && effectiveMove.minHits !== undefined && effectiveMove.maxHits !== undefined) {
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
      defender.currentHp = Math.max(0, defender.currentHp - hitResult.damage);
      applyEndurance(preHp);
      triggerAbilityHitEffect(hitResult.damage);
      if (isFainted(defender)) break; // 상대가 쓰러지면 남은 타수는 진행하지 않는다
    }
    damagePercent = damage / defender.realStats.hp;
    hitCount = landed;
  } else if (isDamaging) {
    const hitResult = resolveHit(effectiveMove);
    damage = hitResult.damage;
    isCritical = hitResult.isCritical;
    damagePercent = damage / defender.realStats.hp;
    const preHp = defender.currentHp;
    defender.currentHp = Math.max(0, defender.currentHp - damage);
    applyEndurance(preHp);
    triggerAbilityHitEffect(damage);
  }

  // 발버둥 반동: 필중이라 항상 이 지점까지 오고, 명중/기절 여부와 무관하게 사용자가
  // 최대 HP의 1/4만큼 반동 데미지를 입는다 (상대 데미지와는 별개 계산).
  let selfDamage = 0;
  if (move.id === STRUGGLE_MOVE.id) {
    selfDamage = Math.floor(attacker.maxHp / 4);
    attacker.currentHp = Math.max(0, attacker.currentHp - selfDamage);
  }

  // 반동(recoil): 불꽃세례·웨이브태클·브레이브버드·양날박치기. 상대에게 준 데미지(damage)의
  // 일정 비율만큼 사용자도 입는다 — damage가 0(면역 등)이면 반동도 자연히 0이 된다.
  let recoilDamage = 0;
  if (effectiveMove.recoilFraction !== undefined && damage > 0) {
    recoilDamage = Math.floor(damage * effectiveMove.recoilFraction);
    attacker.currentHp = Math.max(0, attacker.currentHp - recoilDamage);
  }

  // 생명의구슬: 데미지를 실제로 준(damage > 0) 공격이 성공할 때마다 최대 HP의 1/10만큼 자신도
  // 반동을 입는다 — 다단히트도 타수 수와 무관하게 이번 행동에 한 번만 적용(본가 규칙).
  let itemRecoilDamage = 0;
  let itemRecoilItemName: string | undefined;
  if (isDamaging && damage > 0 && attackerItem?.selfRecoilFractionOfMaxHp) {
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

  // 자폭류(대폭발 등): 명중했으면 반드시 데미지를 먼저 입힌 "다음" 사용자가 기절한다.
  // 순서가 중요하다 — 이 데미지로 상대가 이미 쓰러졌다면, 실제 게임처럼 "상대를 먼저 쓰러뜨린 뒤
  // 반동으로 자신도 쓰러진 것"으로 취급되어야 승자 판정(runTurn)이 이 행동의 주체를 승자로 잡는다.
  if (effectiveMove.selfFaints) {
    attacker.currentHp = 0;
  }

  // 기술 자신의 랭크/명중회피/급소 변화 적용 (칼춤, 그림자분신, 기충전 등).
  // attacker/defender는 state.a/state.b를 그대로 참조하고 있어 여기서 바꾼 값이 state에도 반영된다.
  const attackerStagesBeforeMoveChange = attacker.stages;
  const defenderStagesBeforeMoveChange = defender.stages;
  attacker.stages = applyMoveStatChanges(attacker.stages, effectiveMove, "self", { userTypes: attacker.types });
  defender.stages = applyMoveStatChanges(defender.stages, effectiveMove, "opponent", { userTypes: attacker.types });

  // 클리어바디(전체)·괴력집게(공격만)·미러아머(반사): 방금 적용된 opponent 랭크변화 중 실제로
  // 내려간 스탯만(-6 클램프로 변화가 없었던 건 자연히 제외) 골라서, 막을 스탯이면 원래 값으로
  // 되돌리고, 반사 특성이면 원래 값으로 되돌린 뒤 그만큼을 공격측에게 대신 적용한다. "상대의
  // 기술로" 내려간 것만 대상이라 방금 위에서 적용한 opponent 방향 변화만 비교하면 충분하다.
  const blockedStats = defenderAbility?.blocksOpponentStatDropsForStats;
  const reflects = defenderAbility?.reflectsOpponentStatDrops;
  if (blockedStats || reflects) {
    for (const stat of Object.keys(defender.stages) as BattleStatKey[]) {
      const dropAmount = defenderStagesBeforeMoveChange[stat] - defender.stages[stat];
      if (dropAmount <= 0) continue;
      if (reflects) {
        defender.stages = { ...defender.stages, [stat]: defenderStagesBeforeMoveChange[stat] };
        attacker.stages = applyStageDelta(attacker.stages, stat, -dropAmount);
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
    attacker.itemConsumed = true;
    restoredStatsSelfItemName = attackerItem?.name;
  }
  if (shouldTriggerWhiteHerb(defenderItem, defender.stages, defender.itemConsumed ?? false)) {
    defender.stages = clampStagesToNonNegative(defender.stages);
    defender.itemConsumed = true;
    restoredStatsOpponentItemName = defenderItem?.name;
  }

  attacker.accuracyStages = applyMoveAccuracyEvasionChanges(attacker.accuracyStages, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  const defenderAccuracyBeforeChange = defender.accuracyStages.accuracy;
  defender.accuracyStages = applyMoveAccuracyEvasionChanges(defender.accuracyStages, effectiveMove, "opponent", {
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
  defender.critStage = applyMoveCritStageChanges(defender.critStage, effectiveMove, "opponent", {
    userTypes: attacker.types,
  });

  let inflictedStatus: StatusConditionState["condition"] | undefined;
  if (effectiveMove.inflictsStatus) {
    for (const effect of effectiveMove.inflictsStatus) {
      if (isImmuneToStatus(effect.status, defender.types, defenderAbility?.immuneToStatuses)) continue;
      if (isStatusBlockedByField(state.field, effect.status)) continue;
      // 쾌청(강한 햇살) 날씨에서는 얼음 상태에 걸리지 않는다 — 타입 면역과는 다른 축이라 별도 확인
      if (effect.status === "freeze" && state.weather === "쾌청") continue;
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() < chance) {
        const before = defender.status.condition;
        defender.status = inflictStatus(defender.status, effect.status);
        if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
        break; // 주 상태이상은 한 번에 하나만 걸린다 (중첩 없음)
      }
    }
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
    !(inflictedStatus === "freeze" && state.weather === "쾌청")
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
  let statusCureBerryItemName: string | undefined;
  if (inflictedStatus && getStatusCureBerryResult(defenderItem, inflictedStatus, defender.itemConsumed ?? false)) {
    defender.status = { ...NO_STATUS_CONDITION };
    defender.itemConsumed = true;
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
      const target = effect.target === "self" ? attacker : defender;
      // 하품(졸음): 대상이 이미 다른 주 상태이상이거나 이미 졸음 상태면 실패한다(본가 규칙) —
      // 실제 잠듦 여부(타입/필드 면역)는 2턴 뒤 트리거 시점에 따로 확인한다.
      if (effect.volatile === "drowsy" && (target.status.condition || hasVolatile(target.volatile, "drowsy"))) {
        continue;
      }
      // 희망사항: 이미 예약돼 있으면 재사용 실패(본가 규칙 — 필드/트릭룸과 같은 패턴)
      if (effect.volatile === "wish" && hasVolatile(target.volatile, "wish")) continue;
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
        const targetItem = effect.target === "self" ? attackerItem : defenderItem;
        if (getConfusionCureBerryResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active.confusion;
          target.itemConsumed = true;
          statusCureBerryItemName = targetItem!.name;
          inflictedVolatile = undefined;
        }
      }
    }
  }

  // 왕의징표석: 데미지를 주는 데 성공하면 이 확률로 상대에게 추가 풀죽음을 건다. 기술 자체의
  // 풀죽음 확률(있다면)과는 완전히 별개 판정이라, 기술이 이미 풀죽음을 걸었으면 중복으로 다시
  // 걸 필요가 없다(로그에 "풀죽음!"이 두 번 찍히는 것만 방지 — 결과 자체는 어차피 동일).
  if (
    isDamaging &&
    damage > 0 &&
    inflictedVolatile !== "flinch" &&
    !isFainted(defender) &&
    !defenderAbility?.immuneToFlinch &&
    getExtraFlinchTriggered(attackerItem, random)
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "flinch", random);
    inflictedVolatile = "flinch";
  }

  // 불굴의마음: 이번 행동에서 풀죽음이 걸렸으면(기술 자체든 왕의징표석이든, 둘 다 위에서
  // 이미 defender.volatile에 반영됨) 그 즉시 지정된 랭크가 오른다.
  if (inflictedVolatile === "flinch" && defenderAbility?.boostsStatOnFlinch) {
    const boost = defenderAbility.boostsStatOnFlinch;
    defender.stages = applyStageDelta(defender.stages, boost.stat, boost.delta);
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

  // 이번 행동에서 자신의 상태이상이 자연 해제(잠듦/얼음) 또는 강제 해동(thawsUserOnUse)됐으면
  // 그쪽을 우선한다 — 위 두 케이스(치료 기술/불꽃 피격)와 동시에 발생하는 건 극히 드문 경우다.
  if (selfCuredStatus) {
    curedStatus = selfCuredStatus;
    curedStatusTarget = "self";
  }

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
    if (getStatusCureBerryResult(attackerItem, "sleep", attacker.itemConsumed ?? false)) {
      attacker.status = { ...NO_STATUS_CONDITION };
      attacker.itemConsumed = true;
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
      ? computeWeatherHealFraction(state.weather)
      : effectiveMove.healsFraction!;
    healedAmount = Math.min(
      healTarget.maxHp - healTarget.currentHp,
      Math.floor(healTarget.maxHp * fraction),
    );
    healTarget.currentHp += healedAmount;
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

  // 씨뿌리기: 상대가 이미 씨앗이 박혀있으면 실패.
  let leechSeedSetFailed = false;
  if (effectiveMove.setsLeechSeed) {
    if (hasVolatile(defender.volatile, "leechSeed")) {
      leechSeedSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "leechSeed", random);
    }
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
  if (!isFainted(attacker)) {
    attackerBerryHealAmount = getHpThresholdBerryHeal(
      attackerItem,
      attacker.currentHp,
      attacker.maxHp,
      attacker.itemConsumed ?? false,
    );
    if (attackerBerryHealAmount > 0) {
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + attackerBerryHealAmount);
      attacker.itemConsumed = true;
      attackerBerryHealItemName = attackerItem!.name;
    }
  }
  let defenderBerryHealAmount = 0;
  let defenderBerryHealItemName: string | undefined;
  if (!isFainted(defender)) {
    defenderBerryHealAmount = getHpThresholdBerryHeal(
      defenderItem,
      defender.currentHp,
      defender.maxHp,
      defender.itemConsumed ?? false,
    );
    if (defenderBerryHealAmount > 0) {
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + defenderBerryHealAmount);
      defender.itemConsumed = true;
      defenderBerryHealItemName = defenderItem!.name;
    }
  }

  // 자기과신: 자신의 데미지로 상대를 실제로 쓰러뜨렸을 때만 발동. resolveAction은 상대가 이미
  // 쓰러진 상태로는 호출되지 않으므로(runTurn의 break), 여기서 isFainted(defender)가 true라면
  // 이번 행동 중에 쓰러진 것이다 — 데미지를 준 경우로 한정해 상태이상/씨뿌리기 등 무관한 원인은 제외.
  if (isDamaging && damage > 0 && isFainted(defender) && attackerAbility?.boostsStatOnKo) {
    const boost = attackerAbility.boostsStatOnKo;
    attacker.stages = applyStageDelta(attacker.stages, boost.stat, boost.delta);
  }

  return {
    actor: actorKey,
    move,
    hit: true,
    critical: isCritical,
    damage,
    damagePercent,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    inflictedStatus,
    inflictedVolatile,
    curedStatus,
    curedStatusTarget,
    setField: fieldSetFailed ? undefined : effectiveMove.setsField,
    fieldSetFailed,
    destroyedField,
    setTrickRoom: trickRoomSetFailed ? undefined : effectiveMove.setsTrickRoom,
    trickRoomSetFailed,
    setWeather: effectiveMove.setsWeather,
    setScreen: screenSetFailed ? undefined : effectiveMove.setsScreen,
    screenSetFailed,
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
    setLeechSeed: leechSeedSetFailed ? undefined : effectiveMove.setsLeechSeed,
    leechSeedSetFailed,
    statusCureBerryItemName,
    attackerBerryHealAmount: attackerBerryHealAmount || undefined,
    attackerBerryHealItemName,
    defenderBerryHealAmount: defenderBerryHealAmount || undefined,
    defenderBerryHealItemName,
    abilityInflictedStatusOnAttacker,
    abilityInflictedStatusAbilityName,
    abilityDamageToAttacker: abilityDamageToAttacker || undefined,
    abilityDamageAbilityName,
    abilityDisabledMoveName,
    abilityDisableAbilityName,
    abilityAbsorbedMoveType,
    abilityAbsorbAbilityName,
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
    turnNumber: prevState.turnNumber + 1,
    entryAnnouncements: prevState.entryAnnouncements,
  };

  const aItem = state.a.slot.item ? getItem(state.a.slot.item) : undefined;
  const bItem = state.b.slot.item ? getItem(state.b.slot.item) : undefined;
  const aAbilityForSpeed = state.a.effectiveAbilityId ? getAbility(state.a.effectiveAbilityId) : undefined;
  const bAbilityForSpeed = state.b.effectiveAbilityId ? getAbility(state.b.effectiveAbilityId) : undefined;
  // 엽록소·쓱쓱·모래헤치기: 날씨가 일치할 때만 곱해진다(그 외엔 1)
  const getWeatherSpeedMultiplier = (ability: Ability | undefined): number => {
    const boost = ability?.weatherSpeedMultiplier;
    return boost && boost.weather === state.weather ? boost.multiplier : 1;
  };
  // 구애스카프(1.5)·검은철구(0.5) — 상태이상 배율과 별개로 곱해진다
  const speedA =
    state.a.realStats.spe *
    computeStatusSpeedMultiplier(state.a.status.condition) *
    getItemSpeedMultiplier(aItem) *
    getWeatherSpeedMultiplier(aAbilityForSpeed);
  const speedB =
    state.b.realStats.spe *
    computeStatusSpeedMultiplier(state.b.status.condition) *
    getItemSpeedMultiplier(bItem) *
    getWeatherSpeedMultiplier(bAbilityForSpeed);

  // 트릭룸 판정은 이번 턴이 시작된 시점(=아직 이번 턴 행동을 하나도 반영하지 않은 상태)의 값을
  // 쓴다 — 이번 턴에 트릭룸을 새로 걸어도 그 즉시 같은 턴의 순서 계산에는 영향을 주지 않는다
  // (본가 규칙: 순서는 행동 전에 이미 정해짐).
  const trickRoomActive = state.trickRoomTurnsRemaining !== undefined;
  // 그래스슬라이더처럼 필드 조건부로 우선도가 오르는 기술은, 순서를 정하는 이 시점의 필드
  // 상태(=이번 턴 시작 시점)를 기준으로 반영한다. compareTurnOrder는 move.priority만 보므로
  // 우선도만 조정한 얕은 복사본을 넘긴다.
  const priorityAdjustedMoveA = { ...moveA, priority: getFieldAdjustedPriority(moveA, state.field) };
  const priorityAdjustedMoveB = { ...moveB, priority: getFieldAdjustedPriority(moveB, state.field) };

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
        { realSpeed: speedA, move: priorityAdjustedMoveA, stages: state.a.stages },
        { realSpeed: speedB, move: priorityAdjustedMoveB, stages: state.b.stages },
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

  // winner가 이미 액션 중 자폭 콤보로 정해졌으면, 배틀이 그 시점에 끝난 것이니
  // 턴 종료 회복/상태이상 데미지는 더 진행하지 않는다(실제 게임에서도 배틀이 이미 끝났다).
  if (!winner && !isFainted(state.a) && !isFainted(state.b)) {
    for (const key of (["a", "b"] as const)) {
      const fighter = state[key];

      // 그래스필드: 매 턴 종료 시 최대 HP 1/16 회복
      const fieldHeal = computeFieldEndOfTurnHeal(state.field, fighter.maxHp);
      if (fieldHeal > 0) {
        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + fieldHeal);
        endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, fieldHeal });
      }

      const fighterItem = fighter.slot.item ? getItem(fighter.slot.item) : undefined;

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
      if (weatherHealBoost && weatherHealBoost.weather === state.weather) {
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
      if (hasVolatile(fighter.volatile, "leechSeed")) {
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
          const healerItem = healer.slot.item ? getItem(healer.slot.item) : undefined;
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

      if (fighter.status.condition) {
        const statusCondition = fighter.status.condition;
        const damage = computeStatusEndOfTurnDamage(fighter.status, fighter.maxHp);
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

      // 자뭉열매/오랭열매: 턴 종료 시점까지의 모든 HP 변화(필드 회복/먹다남은음식/씨뿌리기/상태이상
      // 데미지 등)가 끝난 뒤에도 다시 한번 확인한다 — 액션 중엔 안 걸렸다가 턴 종료 데미지로
      // 뒤늦게 1/2 이하가 되는 경우를 놓치지 않기 위해서다.
      if (!isFainted(fighter)) {
        const berryHeal = getHpThresholdBerryHeal(fighterItem, fighter.currentHp, fighter.maxHp, fighter.itemConsumed ?? false);
        if (berryHeal > 0) {
          fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + berryHeal);
          fighter.itemConsumed = true;
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
    }
  }

  // 리플렉터/빛의장막은 필드/날씨와 달리 "양쪽 다 따로" 걸릴 수 있어 각자 카운트다운한다.
  const expiredScreens: { actor: FighterKey; screen: "reflect" | "lightScreen" }[] = [];
  for (const key of (["a", "b"] as const)) {
    const fighter = state[key];
    for (const screenType of ["reflect", "lightScreen"] as const) {
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
    },
  };
}
