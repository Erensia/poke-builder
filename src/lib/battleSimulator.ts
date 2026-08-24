import type { Move } from "../types/move";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { PokemonType } from "../types/pokemon-type";
import {
  NEUTRAL_ACCURACY_STAGES,
  NEUTRAL_CRIT_STAGE,
  NEUTRAL_STAGES,
  type AccuracyEvasionStages,
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
import { getPokemon, getAbility, getMove, getItem } from "./data";
import { getEffectiveForm, getEffectiveAbilityId } from "./pokemonForm";
import { computeRealStats } from "./statCalculator";
import { applyMoveStatChanges } from "./statStages";
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
import { getWeatherDamageMultiplier } from "./weatherEffects";
import {
  FIELD_DURATION,
  computeFieldEndOfTurnHeal,
  getFieldDamageMultiplier,
  isConfusionBlockedByField,
  isPriorityMoveBlockedByField,
  isStatusBlockedByField,
} from "./fieldEffects";
import { getBerryDefenseResult, getItemOffenseMultiplier, getItemAccuracyMultiplier } from "./itemEffects";
import { compareTurnOrder } from "./turnOrder";
import type { BaseStats } from "../types/stats";
import type { EvaluatorSlot } from "./matchupEvaluator";

/** 데미지 난수 하한. computeDamage의 randomRoll에 매턴 0.85~1.00 사이 값을 뽑아 넘길 때 쓴다 */
const MIN_DAMAGE_ROLL = 0.85;

/** 트릭룸 지속 턴 수. 필드(FIELD_DURATION)와 같은 5턴 */
const TRICK_ROOM_DURATION = 5;

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
}

/** 두 포켓몬(a/b)을 마주 세운 배틀 상태 */
export interface BattleState {
  a: BattleFighterState;
  b: BattleFighterState;
  weather?: WeatherKind;
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
 * 사용자가 날씨를 직접 고르지 않았을 때, 양쪽 특성(가뭄/잔비/모래날림 등 setsWeather)을 확인해서
 * 배틀 시작과 동시에 날씨를 자동으로 바꾼다. 양쪽 다 날씨 특성이면 실효 스피드가 빠른 쪽이 이긴다
 * (참고할 다른 기준이 없어 간이화한 규칙 — Phase 3 문서 "확인 필요" 항목).
 */
function resolveEntryWeather(
  aSlot: EvaluatorSlot,
  aFighter: BattleFighterState,
  bSlot: EvaluatorSlot,
  bFighter: BattleFighterState,
  manualWeather: WeatherKind | undefined,
): { weather: WeatherKind | undefined; announcements: string[] } {
  if (manualWeather) return { weather: manualWeather, announcements: [] };

  const aAbility = aFighter.effectiveAbilityId ? getAbility(aFighter.effectiveAbilityId) : undefined;
  const bAbility = bFighter.effectiveAbilityId ? getAbility(bFighter.effectiveAbilityId) : undefined;
  if (!aAbility?.setsWeather && !bAbility?.setsWeather) {
    return { weather: manualWeather, announcements: [] };
  }

  const aWins =
    !!aAbility?.setsWeather && (!bAbility?.setsWeather || aFighter.realStats.spe >= bFighter.realStats.spe);
  const winnerSlot = aWins ? aSlot : bSlot;
  const winnerAbility = (aWins ? aAbility : bAbility)!;
  const weather = winnerAbility.setsWeather!;
  const pokemonName = getPokemon(winnerSlot.pokemonId)?.name ?? "포켓몬";

  return {
    weather,
    announcements: [`${pokemonName}의 ${winnerAbility.name}! 날씨가 ${weather}${roEuro(weather)} 바뀌었다!`],
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
  const { weather: resolvedWeather, announcements } = resolveEntryWeather(a, fighterA, b, fighterB, weather);

  return {
    a: fighterA,
    b: fighterB,
    weather: resolvedWeather,
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
  /** 이 행동으로 트릭룸이 새로 걸렸으면 true */
  setTrickRoom?: boolean;
  /** 트릭룸을 썼지만 이미 걸려있어서 실패했으면 true */
  trickRoomSetFailed?: boolean;
  /**
   * 불꽃세례·웨이브태클·브레이브버드·양날박치기(Move.recoilFraction)로 입은 반동 데미지.
   * selfDamage(혼란 자멸/발버둥 반동)와는 계산 기준이 달라 별도 필드로 분리했다 — 준 데미지가
   * 0(면역 등)이면 반동도 자연히 0.
   */
  recoilDamage: number;
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
  /** damage가 상태이상 매턴 데미지일 때(독/맹독/화상) 어떤 상태이상인지 — UI가 문구를 골라 쓰는 데 필요 */
  statusCondition?: StatusConditionState["condition"];
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

  // PP 소모는 행동 여부와 무관하게 발생(단, 차지 기술 2턴째는 위에서 이미 스킵 처리)
  if (!releasingCharge && attacker.remainingPp[move.id] !== undefined) {
    attacker.remainingPp[move.id] = Math.max(0, attacker.remainingPp[move.id] - 1);
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
    ...extra,
  });

  // 0) 사용 조건이 있는 기술(코골기=잠든 상태 전용, 속이기=첫 턴 전용). 상태이상/행동방해
  // 판정보다 먼저 확인한다 — 조건 자체를 못 채우면 애초에 시도조차 안 한 것으로 취급.
  // 첫 턴 전용은 1v1 시뮬레이터에 교체가 없으니 배틀 전체의 1턴째로 취급한다.
  if (move.usageCondition === "first-turn-only" && state.turnNumber !== 1) {
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
    const wakeCheck = checkStatusActionBlock(attacker.status, random);
    attacker.status = wakeCheck.nextState;
    // 이 판정으로 잠에서 깼다면 이번 턴은 이미 깬 상태이므로 사용 조건이 깨진 것으로 처리한다.
    if (attacker.status.condition !== "sleep") return blocked("usageCondition");
  } else {
    const statusCheck = checkStatusActionBlock(attacker.status, random);
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
      };
    }
  }

  const attackerAbility = attacker.effectiveAbilityId ? getAbility(attacker.effectiveAbilityId) : undefined;
  const defenderAbility = defender.effectiveAbilityId ? getAbility(defender.effectiveAbilityId) : undefined;
  const attackerItem = attacker.slot.item ? getItem(attacker.slot.item) : undefined;
  const defenderItem = defender.slot.item ? getItem(defender.slot.item) : undefined;

  // evaluateSlotMatchup(1턴 스냅샷 판정)과 같은 로직을 공유 — 특성 배율/타입 변경/자속/상대 상성
  const { effectiveMove, abilityOffenseMultiplier, abilityDefenseMultiplier, stabMultiplier, typeEffectiveness } =
    resolveMoveContext(attackerAbility, move, defender.types, defenderAbility, state.weather);

  // 메트로놈(연속 같은 기술 위력 증가)용 스트릭 갱신 — 여기까지 왔다는 건 앞의 모든 행동방해
  // 판정(상태이상/풀죽음/반동/혼란/차지 등)을 통과해서 실제로 이 기술을 쓴다는 뜻이라, 명중 여부와
  // 무관하게 여기서 갱신한다(본가 규칙 — 빗나가도 스트릭은 유지되고, 다른 기술을 쓰면 끊긴다).
  attacker.lastMoveStreak = attacker.lastMoveId === effectiveMove.id ? (attacker.lastMoveStreak ?? 1) + 1 : 1;
  attacker.lastMoveId = effectiveMove.id;

  // 반짝가루(방어측 0.9배)·광각렌즈(공격측 1.1배)·포커스렌즈(공격측, 늦게 움직일 때 1.2배).
  // 모래숨기 같은 특성 쪽 배율은 아직 없음 (TODO: 특성 데이터 보강)
  const accuracyExtraMultiplier = getItemAccuracyMultiplier(attackerItem, defenderItem, movesSecond);
  const hitChance = computeHitChance(
    effectiveMove.accuracy,
    attacker.accuracyStages.accuracy,
    defender.accuracyStages.evasion,
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
    };
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
      effectiveMove.alwaysCrit || random() < critChance(attacker.critStage, effectiveMove.highCritRatio);
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

    const result = computeDamage(attacker.realStats, defender.realStats, attacker.types, hitMove, {
      typeEffectiveness,
      abilityMultiplier: abilityOffenseMultiplier * statusAttackMultiplier * hidingBypassMultiplier,
      weatherMultiplier,
      fieldMultiplier,
      itemMultiplier,
      stabMultiplier,
      attackerStages: attacker.stages,
      defenderStages: defender.stages,
      bulkMultiplier: abilityDefenseMultiplier * berryResult.bulkMultiplier,
      isCritical: critical,
      randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
    });
    return { damage: result?.damage ?? 0, isCritical: critical };
  }

  if (isDamaging && effectiveMove.fixedDamage !== undefined) {
    // 나이트헤드류: 방어/랭크/특성/도구/급소를 전부 무시하고 고정 수치만 깎는다.
    // 타입 상성 면역(0배)만은 그대로 존중 — 반감/2배는 적용하지 않는다.
    damage = typeEffectiveness === 0 ? 0 : effectiveMove.fixedDamage;
    damagePercent = damage / defender.realStats.hp;
    defender.currentHp = Math.max(0, defender.currentHp - damage);
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
      defender.currentHp = Math.max(0, defender.currentHp - hitResult.damage);
      if (isFainted(defender)) break; // 상대가 쓰러지면 남은 타수는 진행하지 않는다
    }
    damagePercent = damage / defender.realStats.hp;
    hitCount = landed;
  } else if (isDamaging) {
    const hitResult = resolveHit(effectiveMove);
    damage = hitResult.damage;
    isCritical = hitResult.isCritical;
    damagePercent = damage / defender.realStats.hp;
    defender.currentHp = Math.max(0, defender.currentHp - damage);
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

  // 자폭류(대폭발 등): 명중했으면 반드시 데미지를 먼저 입힌 "다음" 사용자가 기절한다.
  // 순서가 중요하다 — 이 데미지로 상대가 이미 쓰러졌다면, 실제 게임처럼 "상대를 먼저 쓰러뜨린 뒤
  // 반동으로 자신도 쓰러진 것"으로 취급되어야 승자 판정(runTurn)이 이 행동의 주체를 승자로 잡는다.
  if (effectiveMove.selfFaints) {
    attacker.currentHp = 0;
  }

  // 기술 자신의 랭크/명중회피/급소 변화 적용 (칼춤, 그림자분신, 기충전 등).
  // attacker/defender는 state.a/state.b를 그대로 참조하고 있어 여기서 바꾼 값이 state에도 반영된다.
  attacker.stages = applyMoveStatChanges(attacker.stages, effectiveMove, "self", { userTypes: attacker.types });
  defender.stages = applyMoveStatChanges(defender.stages, effectiveMove, "opponent", { userTypes: attacker.types });

  attacker.accuracyStages = applyMoveAccuracyEvasionChanges(attacker.accuracyStages, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  defender.accuracyStages = applyMoveAccuracyEvasionChanges(defender.accuracyStages, effectiveMove, "opponent", {
    userTypes: attacker.types,
  });
  attacker.critStage = applyMoveCritStageChanges(attacker.critStage, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  defender.critStage = applyMoveCritStageChanges(defender.critStage, effectiveMove, "opponent", {
    userTypes: attacker.types,
  });

  let inflictedStatus: StatusConditionState["condition"] | undefined;
  if (effectiveMove.inflictsStatus) {
    for (const effect of effectiveMove.inflictsStatus) {
      if (isImmuneToStatus(effect.status, defender.types)) continue;
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

  let inflictedVolatile: VolatileCondition | undefined;
  if (effectiveMove.inflictsVolatile) {
    for (const effect of effectiveMove.inflictsVolatile) {
      if (effect.volatile === "confusion" && isConfusionBlockedByField(state.field)) continue;
      const target = effect.target === "self" ? attacker : defender;
      // 하품(졸음): 대상이 이미 다른 주 상태이상이거나 이미 졸음 상태면 실패한다(본가 규칙) —
      // 실제 잠듦 여부(타입/필드 면역)는 2턴 뒤 트리거 시점에 따로 확인한다.
      if (effect.volatile === "drowsy" && (target.status.condition || hasVolatile(target.volatile, "drowsy"))) {
        continue;
      }
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() >= chance) continue;
      if (effect.target === "self") {
        attacker.volatile = inflictVolatile(attacker.volatile, effect.volatile, random);
      } else {
        defender.volatile = inflictVolatile(defender.volatile, effect.volatile, random);
      }
      inflictedVolatile = effect.volatile;
    }
  }

  // 상태이상 치료: 물거품아리아처럼 명중 시 대상의 주 상태이상을 없앤다(inflictsStatus의 반대 방향).
  // status가 지정돼 있으면(물거품아리아=화상) 그 상태일 때만 치료 — 다른 상태이상은 안 지운다.
  let curedStatus: StatusConditionState["condition"] | undefined;
  let curedStatusTarget: "self" | "opponent" | undefined;
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
    setTrickRoom: trickRoomSetFailed ? undefined : effectiveMove.setsTrickRoom,
    trickRoomSetFailed,
    fainted: isFainted(defender),
    selfFainted: isFainted(attacker),
    recoilDamage,
    hitCount,
    itemRecoilDamage: itemRecoilDamage || undefined,
    itemRecoilItemName,
    berryReducedDamageItemName,
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
    field: prevState.field,
    fieldTurnsRemaining: prevState.fieldTurnsRemaining,
    trickRoomTurnsRemaining: prevState.trickRoomTurnsRemaining,
    turnNumber: prevState.turnNumber + 1,
    entryAnnouncements: prevState.entryAnnouncements,
  };

  const speedA = state.a.realStats.spe * computeStatusSpeedMultiplier(state.a.status.condition);
  const speedB = state.b.realStats.spe * computeStatusSpeedMultiplier(state.b.status.condition);

  // 트릭룸 판정은 이번 턴이 시작된 시점(=아직 이번 턴 행동을 하나도 반영하지 않은 상태)의 값을
  // 쓴다 — 이번 턴에 트릭룸을 새로 걸어도 그 즉시 같은 턴의 순서 계산에는 영향을 주지 않는다
  // (본가 규칙: 순서는 행동 전에 이미 정해짐).
  const trickRoomActive = state.trickRoomTurnsRemaining !== undefined;
  const firstIsA =
    compareTurnOrder(
      { realSpeed: speedA, move: moveA, stages: state.a.stages },
      { realSpeed: speedB, move: moveB, stages: state.b.stages },
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
    const action = resolveAction(state, key, moves[key], random, movesSecond);
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

      // 하품(졸음): 2턴 카운터가 1(=이번이 마지막 소모)이면 이번 턴 종료에 실제로 잠듦을 시도한다.
      // 그 사이 다른 상태이상이 걸렸거나 타입/필드로 잠듦 면역이 생겼으면 조용히 무산된다(본가 규칙).
      const drowsyEntry = fighter.volatile.active.drowsy;
      if (drowsyEntry) {
        const triggersNow = drowsyEntry.turnsRemaining <= 1;
        fighter.volatile = consumeVolatileTurn(fighter.volatile, "drowsy");
        if (
          triggersNow &&
          !fighter.status.condition &&
          !isImmuneToStatus("sleep", fighter.types) &&
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

      if (!fighter.status.condition) continue;
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
    },
  };
}
