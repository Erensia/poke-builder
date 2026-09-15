import { type Move } from "@/types/move";
import { type WeatherKind } from "@/types/weather";
import { type FieldKind } from "@/types/field";
import { type PokemonType } from "@/types/pokemon-type";
import { type PokemonGender, type StanceChangeForms } from "@/types/pokemon";
import { type FighterKey, type HazardState } from "@/types/battle";
import { BATTLE_STAT_KEYS, NEUTRAL_ACCURACY_STAGES, NEUTRAL_CRIT_STAGE, NEUTRAL_STAGES, type AccuracyEvasionStages, type BattleStatKey, type CritStage, type StatStages } from "@/types/battleStats";
import { NO_STATUS_CONDITION, NO_VOLATILE_CONDITIONS, type StatusCondition, type StatusConditionState, type VolatileConditionState } from "@/types/status";
import { type Ability } from "@/types/ability";
import { getAbility, getItem, getMove, getPokemon } from "@/lib/data";
import { eulReul, eunNeun, roEuro } from "@/lib/josa";
import { findMegaFormByStone, getEffectiveAbilityId, getEffectiveForm, getEffectiveGender } from "@/lib/pokemonForm";
import { computeRealStats } from "@/lib/statCalculator";
import { computeStatusSpeedMultiplier } from "@/lib/statusConditions";
import { CONFUSION_SELF_HIT_POWER, hasVolatile } from "@/lib/volatileConditions";
import { getEffectiveness } from "@/lib/typeEffectiveness";
import { gyroBallPowerFromSpeeds, rankStageMultiplier } from "@/lib/battlePower";
import { FIELD_DURATION } from "@/lib/fieldEffects";
import { getItemSpeedMultiplier } from "@/lib/itemEffects";
import { type BaseStats } from "@/types/stats";
import { type EvaluatorSlot } from "@/lib/matchupEvaluator";
import { applyIntimidateWithReaction, computeIllusionTarget, triggerTerrainSeeds } from "./switching";

export const MIN_DAMAGE_ROLL = 0.85;

/** 트릭룸 지속 턴 수. 필드(FIELD_DURATION)와 같은 5턴 */
export const TRICK_ROOM_DURATION = 5;

/** 날씨 기본 지속 턴 수(뜨거운바위 등 맞는 바위를 지녔으면 +3 = 8턴) */
export const WEATHER_DURATION = 5;

/** 리플렉터/빛의장막 기본 지속 턴 수(빛의점토를 지녔으면 +3 = 8턴) */
export const SCREEN_DURATION = 5;

/**
 * 록블라스트류(2~5회, multiHitPowers 없는 다단히트)의 타수를 확률표대로 뽑는다.
 * 록블라스트/독침/봉인구슬 등 moves.json에 이미 적힌 확률(2/3회 각 35%, 4/5회 각 15%) 기준.
 * minHits===maxHits(더블어택 등 고정 2타)면 확률 없이 그대로 그 값을 쓴다.
 * 2~5 외의 범위는 지금 로스터에 없어서, 혹시 생기면 균등분포로 근사한다(문서에 기록).
 */
export function rollMultiHitCount(minHits: number, maxHits: number, random: () => number): number {
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
export const CONFUSION_SELF_HIT_MOVE: Move = {
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
   * 일루전(Illusion, 조로아크류): 위장 중이면 위장 대상 포켓몬의 종 id. 등장 시 세팅되고
   * (파티 마지막 슬롯 = 자신 아님·안 쓰러짐), 기술 데미지를 받는 순간 undefined로 풀린다(§6-1).
   * 타입·실능·특성 계산엔 전혀 영향을 주지 않는다 — UI 이름/아이콘 표시에만 쓴다.
   */
  illusionAs?: string;
  /**
   * 메가진화(백로그 §4): 장착한 메가스톤 item id. 있으면 이 포켓몬은 배틀 시작 시 기본 폼으로
   * 나오고(굳히지 않음), 턴에 메가진화를 선언하면 그 턴 행동 전에 폼이 바뀐다.
   */
  megaStone?: string;
  /** 이 배틀에서 이미 메가진화했으면 true. 교체로 물러났다 다시 나와도 유지(본가 규칙). */
  hasMegaEvolved?: boolean;
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
    effect: "block" | "endure" | "blockPriority";
    /** 로그 문구용 — 실제로 성공시킨 기술 이름(방어/판별/버티기/킹실드 중 하나) */
    moveName: string;
    /** 킹실드가 접촉기를 막았을 때만 채워서 아래에서 상대에게 적용한다 */
    contactPenalty?: { stat: BattleStatKey; delta: number };
    /** 니들가드가 접촉기를 막았을 때 공격자에게 줄 최대 HP 비율 데미지(니들가드=1/8) */
    contactDamageFraction?: number;
    /** 토치카가 접촉기를 막았을 때 공격자에게 걸 주 상태이상(토치카=poison) */
    contactStatus?: StatusCondition;
  };
  /**
   * 방어류 기술의 연속 성공 횟수. 다음 시도 성공 확률은 (1/3)^protectStreak. 계열이 아닌
   * 다른 기술을 쓰거나 이번 시도가 실패하면 0으로 리셋된다(undefined와 0은 동일하게 취급).
   */
  protectStreak?: number;
  /**
   * 숲의저주(풀)·핼러윈(고스트)으로 추가된 타입. 배틀 끝까지 유지되며, types에 이미 반영돼 있다 —
   * 의태(applyMimicryForm)·기분파(applyForecastForm)가 타입을 재계산할 때 이 값을 다시 붙인다.
   */
  addedType?: PokemonType;
  /**
   * 수확: 이번 배틀에서 이 포켓몬이 소비한 마지막 나무열매 id. 턴 종료 시 이 열매를 확률로
   * 되돌린다. 되돌린 뒤에도 값은 남겨 둔다(다시 먹고 다시 되돌릴 수 있음).
   */
  consumedBerryId?: string;
  /**
   * 볼주머니: consumeItem이 나무열매 소비를 감지해 추가 회복을 적용했을 때 그 회복량을 잠깐
   * 담아 둔다. resolveAction 반환 시(액션 중 소비) 또는 턴 종료 처리 시(EOT 소비) 로그로 옮기고 지운다.
   */
  pendingCheekPouchHeal?: number;
  /**
   * 송전(Move.changesTargetMoveTypeThisTurn): 이번 턴에 한해 이 포켓몬이 쓰는 기술의 타입이
   * 이 값으로 강제된다. runTurn이 턴 종료 시 지운다.
   */
  moveTypeOverrideThisTurn?: PokemonType;
  /**
   * 꼬르륵스위치(모르페코): 배부른모양(full)/배고픈모양(hangry). 매 턴 종료 시 토글되고, 오라휠의
   * 타입이 이 값에 따라 전기/악으로 갈린다. 비-모르페코는 항상 "full"로 두면 아무 영향이 없다.
   */
  hungerMode?: "full" | "hangry";
  /**
   * 전기로바꾸기(Electromorphosis): 기술 데미지를 받아 충전된 상태. 다음에 쓰는 전기타입 기술의
   * 위력이 2배가 되고 그 즉시 false로 돌아간다(1회 한정).
   */
  electroChargedForElectric?: boolean;
  /**
   * 분노의주먹(Move.rageFistPower): 이번 배틀에서 이 포켓몬이 기술로 데미지를 받은 누적 횟수.
   * 다단히트는 타수만큼 센다(applyDamageToDefender에서 amount>0마다 +1). 교체 초기화는 미도입.
   */
  timesHitByMoves?: number;
  /**
   * 거대해머(Move.cannotUseConsecutively): 직전에 이 기술로 행동을 개시했으면 그 기술 id와,
   * "다음 턴 번호"(= 사용한 턴 + 1)를 함께 기록한다. resolveAction이 (move.id 일치 && 기록된
   * 턴 번호 == 현재 턴 번호)면 실패시킨다 — 그 다음 턴부터는 자연히 조건이 어긋나 다시 쓸 수 있다.
   */
  consecutiveLockMoveId?: string;
  consecutiveLockUntilTurn?: number;
  /**
   * 이번 턴에 "자기 의지로" 교체해서 나왔으면 true(Phase 8 §8). 가속(Speed Boost)이 이 턴
   * 종료에 발동하지 않게 막는 데 쓴다. runTurn이 매 턴 시작 시 지우고, 교체 선처리에서 자발적
   * 교체에만 세운다 — 기절 후 강제 교체(applySwitch)로 나온 경우엔 세우지 않는다(가속 발동).
   */
  switchedInThisTurn?: boolean;
  /**
   * 이 포켓몬이 필드에 등장한 뒤 이미 자기 행동(resolveAction)을 한 번이라도 개시했으면 true.
   * 속이기(first-turn-only)는 이게 false일 때만 성공한다 — 등장 첫 행동 턴에만. 행동이 막혀도
   * (마비·풀죽음 등) 소진되고(본가 동일), 유턴 등으로 턴 중 들어와 그 턴에 행동을 못 했으면
   * 다음 턴까지 false로 남는다. 등장(배틀 시작·performSwitch) 시 초기화.
   */
  hasActedSinceSwitchIn?: boolean;
  /**
   * 변환자재/리베로가 이번 등장 스탠스에서 이미 발동했으면 true. 발동은 등장당 1회
   * (본가 9세대) — 기술을 실제로 사용한 순간에만 소진되므로 행동이 막히면 유지된다.
   * 이미 바뀐 타입 자체는 계속 유지(재발동만 막는다). 등장 시 초기화.
   */
  proteanActivatedSinceSwitchIn?: boolean;
  /**
   * 대검돌격(Move.glaiveRush): 이 포켓몬이 대검돌격을 쓴 뒤 "다음 자기 행동 개시 전까지"
   * 켜지는 자기 약점 플래그 — 이 상태의 포켓몬을 겨냥한 상대 기술은 반드시 명중하고 데미지가
   * 2배가 된다. resolveAction 최상단에서 이 포켓몬이 다시 행동을 개시하면 지워지고(destinyBondArmed와
   * 같은 패턴), 교체로 물러나도 지워진다.
   */
  glaiveRushVulnerable?: boolean;
}

/** 빈 설치물 상태 */
export function emptyHazardState(): HazardState {
  return { stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false };
}

/**
 * 한 진영(편). 선출된 파티(배틀타워 = 3마리, 길이는 고정 안 함) + 지금 나와 있는 슬롯 인덱스 +
 * 그 편에 깔린 설치물. 기절·상태이상·랭크·도구 소모·연속기 카운터는 전부 `party[i]`(슬롯)별로
 * 유지된다. Phase 8 §1.
 */
export interface BattleSide {
  party: BattleFighterState[];
  activeIndex: number;
  hazards: HazardState;
  /**
   * 리플렉터(물리 반감)/빛의장막(특수 반감)/오로라베일(양쪽 반감) — 이 편 전체에 걸려 있는
   * 스크린과 각각의 남은 턴 수(백로그 §6-3). 편 단위 효과라 교체해도 남는다. 설치물(hazards)과
   * 같은 축.
   */
  screens: Partial<Record<"reflect" | "lightScreen" | "auroraVeil", number>>;
  /**
   * 신비의부적(세이프가드) — 이 편이 "상대가 거는" 주요 상태이상을 막는 보호막의 남은 턴 수
   * (백로그 §1-9). 스크린과 같은 축(편 단위, 교체해도 유지)이지만 종류가 하나뿐이라 number만.
   */
  safeguardTurnsRemaining?: number;
  /**
   * 희망사항(Wish) 예약 — 이 편에 하나만 걸 수 있다(백로그 §6-2). 본가처럼 "쓴 포켓몬"이 아니라
   * 2턴 뒤 그 자리(활성)에 있는 포켓몬을 회복시키므로, fighter가 아니라 편에 큐로 둔다. 교체해도
   * 유지된다. healAmount는 시전 시점 시전자 최대 HP의 절반(고정).
   */
  wish?: { turnsRemaining: number; healAmount: number };
  /** 메가진화는 팀당 1회(백로그 §4). 이 편이 이미 썼으면 true. */
  megaUsed?: boolean;
}

/**
 * 두 진영(a/b)을 마주 세운 배틀 상태.
 *
 * `a` / `b`는 **각 진영의 현재 활성 파이터**를 가리키는 포인터로, 항상
 * `sideA.party[sideA.activeIndex]` / `sideB.party[sideB.activeIndex]`와 **동일 객체 참조**다.
 * 엔진 로직 대부분이 "지금 나와 있는 포켓몬 1마리"만 보므로 이 축을 유지한다 — 교체(§3)는
 * `performSwitch` 한 곳에서만 `activeIndex`를 바꾸고 `a`/`b`를 다시 물린다.
 */
export interface BattleState {
  a: BattleFighterState;
  b: BattleFighterState;
  sideA: BattleSide;
  sideB: BattleSide;
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

/** 편(side) 객체를 키로 구한다 */
export function sideOf(state: BattleState, key: FighterKey): BattleSide {
  return key === "a" ? state.sideA : state.sideB;
}

/** 상대 키를 구한다 */
export function opponentKey(key: FighterKey): FighterKey {
  return key === "a" ? "b" : "a";
}

/** fighter의 현재 특성 객체(effectiveAbilityId 기준). 없으면 undefined */
export function abilityOf(fighter: BattleFighterState): Ability | undefined {
  return fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
}

/**
 * 날씨부정(에어록/날씨부정): 양쪽 중 누구든 이 특성이면 날씨의 "부가효과"는 전부 무시된다.
 * state.weather 자체와 weatherTurnsRemaining(지속 턴)은 그대로 두고, 데미지 배율·조건 특성·
 * 웨더볼·틱 데미지 등 효과를 읽는 지점에서만 이 함수를 거쳐 undefined로 만든다.
 */
export function activeWeather(state: BattleState): WeatherKind | undefined {
  if (abilityOf(state.a)?.negatesWeather || abilityOf(state.b)?.negatesWeather) return undefined;
  return state.weather;
}

/**
 * 심술꾸러기(Contrary): fighter가 이 특성이면 랭크 변화 delta의 부호를 반전한다(그 외엔 그대로).
 * 위협·EOT 랭크업·hitTrigger 자기 랭크변화 등 applyStageDelta를 직접 부르는 지점에서 delta를 감싼다.
 */
export function contraryDelta(fighter: BattleFighterState, delta: number): number {
  return abilityOf(fighter)?.invertsStatChanges ? -delta : delta;
}

/** 주 상태이상 6종 — 플라워베일 등 "상태이상 전부 면역"을 표현할 때 쓴다 */
const ALL_MAJOR_STATUS_CONDITIONS: StatusCondition[] = [
  "burn",
  "poison",
  "badly-poisoned",
  "paralysis",
  "sleep",
  "freeze",
];
/**
 * 플라워베일(Phase 8 §7)이 지금 이 fighter에게 실제로 발동하는지 — 이 특성 보유 + 자신이 풀타입.
 * 본가는 아군 풀타입까지 보호하나 3v3 싱글엔 동시 아군이 없어 자기 자신만 대상.
 */
function hasFlowerVeil(fighter: BattleFighterState, ability: Ability | undefined): boolean {
  return !!ability?.grassVeil && fighter.types.includes("풀");
}

/** 특성 기반 상태이상 면역 목록 — 유연류(immuneToStatuses) + 플라워베일(풀타입이면 전부) */
export function statusImmunitiesOf(
  fighter: BattleFighterState,
  ability: Ability | undefined,
): StatusCondition[] | undefined {
  if (hasFlowerVeil(fighter, ability)) return ALL_MAJOR_STATUS_CONDITIONS;
  return ability?.immuneToStatuses;
}

/** 상대발 랭크 하락을 막는 스탯 목록 — 클리어바디류(blocksOpponentStatDropsForStats) + 플라워베일(풀타입이면 5스탯) */
export function statDropBlockStatsOf(
  fighter: BattleFighterState,
  ability: Ability | undefined,
): BattleStatKey[] | undefined {
  if (hasFlowerVeil(fighter, ability)) return BATTLE_STAT_KEYS;
  return ability?.blocksOpponentStatDropsForStats;
}

/**
 * 심술꾸러기: fighter가 대상이 되는 기술 랭크 변화(statChanges)의 delta/setTo 부호를 반전한 기술
 * 복사본을 돌려준다. Contrary가 아니거나 statChanges가 없으면 원본을 그대로 반환한다.
 * applyMoveStatChanges / applyMoveAccuracyEvasionChanges 둘 다에 이 결과를 넘기면 5스탯·명중/회피가 함께 반전된다.
 */
export function contraryMoveFor(move: Move, fighter: BattleFighterState): Move {
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
export function applyForecastForm(fighter: BattleFighterState, weather: WeatherKind | undefined): void {
  if (fighter.transformed) return;
  if (!abilityOf(fighter)?.weatherFormChange) return;
  const next = (weather && FORECAST_TYPE_BY_WEATHER[weather]) || "노말";
  fighter.types = fighter.addedType ? [next, fighter.addedType] : [next];
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
export function applyMimicryForm(fighter: BattleFighterState, field: FieldKind | undefined): PokemonType | undefined {
  if (fighter.transformed) return undefined;
  if (!abilityOf(fighter)?.terrainTypeChange) return undefined;
  const baseTypes = getPokemon(fighter.slot.pokemonId)?.types ?? fighter.types;
  const next: PokemonType[] = field ? [MIMICRY_TYPE_BY_FIELD[field]] : [...baseTypes];
  if (fighter.addedType && !next.includes(fighter.addedType)) next.push(fighter.addedType);
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

  // 메가진화는 배틀 시작 시 굳히지 않는다(§4) — 스톤을 들어도 기본 폼으로 시작하고, 턴에
  // 선언될 때 runTurn이 폼을 바꾼다. 다만 어떤 메가폼으로 갈지는 스톤으로 미리 파악해 둔다.
  const form = getEffectiveForm(pokemon, slot, { ignoreMega: true });
  const megaForm =
    pokemon.megaEvolutions?.find((m) => m.form === slot.activeMegaForm) ??
    findMegaFormByStone(pokemon, slot.item);
  // 킬가르도(배틀스위치): pokemon.baseStats에 이미 실드폼 수치를 그대로 채워뒀으므로, 등장 시점
  // 실수치는 별도 분기 없이 그대로 계산된다 — currentForm/stanceChangeForms만 같이 들고 다니다가
  // resolveAction에서 기술 카테고리에 따라 필요할 때 realStats를 다시 계산한다.
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);

  return {
    slot,
    types: form.types,
    gender: getEffectiveGender(pokemon, slot),
    effectiveAbilityId: getEffectiveAbilityId(form, slot.ability),
    megaStone: megaForm?.megaStone,
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
    ownMoveTypeBoosts: {},
    stanceChangeForms: pokemon.stanceChangeForms,
    currentStanceForm: pokemon.stanceChangeForms ? "shield" : undefined,
    hungerMode: "full",
  };
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
export const SANDSTORM_IMMUNE_ABILITY_NAMES = new Set(["모래숨기", "모래의힘", "모래날림", "모래헤치기"]);

/**
 * 자이로볼(Move.gyroBallPower)의 실효 스피드 산출 — 실능 × 스피드 랭크 배율 × 마비 배율 ×
 * 도구 배율(구애스카프·검은철구). 엽록소류 날씨 스피드 특성은 미반영(후속). 최종 위력 공식은
 * battlePower.gyroBallPowerFromSpeeds가 담당한다.
 */
export function gyroBallPowerValue(
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

export function hasSheerForceSecondaryEffect(move: Move): boolean {
  if (move.power === null && move.fixedDamage === undefined) return false;
  if (move.inflictsStatus && move.inflictsStatus.length > 0) return true; // 이 스키마에서 대상은 항상 상대
  if (move.inflictsVolatile?.some((v) => v.target === "opponent")) return true;
  if (move.statChanges?.some((s) => s.target === "opponent")) return true;
  if (move.statChanges?.some((s) => s.target === "self" && (s.delta ?? 0) > 0)) return true;
  // 소금절이·시럽봄: 상대에게 지속 상태(saltCure/syrupCoat)를 거는 데미지 기술 — 부가효과 취급.
  if (move.setsSaltCure || move.setsSyrupCoat) return true;
  return false;
}

/**
 * 1회용 도구(나무열매·하양허브 등)가 이번에 소모됐음을 기록한다. itemConsumed(같은 도구 재발동
 * 방지)와 currentItemId(곡예가 "도구를 잃음"을 판정하는 기준)를 항상 같이 갱신해야 해서 헬퍼로
 * 묶었다 — 둘 중 하나만 갱신하면 곡예가 오작동한다(예: itemConsumed만 세팅하면 나무열매를 쓴
 * 뒤에도 currentItemId가 그대로 남아있어 곡예가 영영 발동하지 않는다).
 */
export function consumeItem(fighter: BattleFighterState): void {
  const consumedId = fighter.currentItemId;
  fighter.itemConsumed = true;
  fighter.currentItemId = null;

  // 공생(Ability.passesItemToConsumingAlly, Phase 8 §7): 본가라면 여기서 "같은 편 다른 활성
  // 포켓몬이 공생 보유 + 무도구면 그 포켓몬의 도구를 이 fighter에게 넘긴다"를 처리한다. 3v3
  // 싱글 교체에는 필드에 동시 아군이 없어 이 조건이 성립하는 순간이 없으므로 배선하지 않는다.

  // 나무열매(이름이 "열매"로 끝나는 도구)를 소비했을 때만:
  //  - 수확: 소비한 열매 id를 기록해 둔다(턴 종료 시 확률로 되돌림).
  //  - 볼주머니: 그 열매 고유 효과와 별개로 최대 HP의 berryHealFraction만큼 추가 회복한다.
  if (!consumedId) return;
  const item = getItem(consumedId);
  if (!item || !item.name.endsWith("열매")) return;
  fighter.consumedBerryId = consumedId;
  const frac = abilityOf(fighter)?.berryHealFraction;
  if (frac && fighter.currentHp > 0 && fighter.currentHp < fighter.maxHp) {
    const heal = Math.min(fighter.maxHp - fighter.currentHp, Math.max(1, Math.floor(fighter.maxHp * frac)));
    fighter.currentHp += heal;
    fighter.pendingCheekPouchHeal = (fighter.pendingCheekPouchHeal ?? 0) + heal;
  }
}

/**
 * 이 날씨에 맞는 바위(뜨거운바위 등)를 지닌 쪽이 있으면 그 보너스 턴수를, 없으면 0을 반환한다.
 * 양쪽 다 지닐 일은 없지만(도구는 하나씩) 방어적으로 둘 다 확인해서 더 큰 쪽을 쓴다.
 */
export function weatherRockBonus(weather: WeatherKind, aSlot: EvaluatorSlot, bSlot: EvaluatorSlot): number {
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
export function applyTransform(self: BattleFighterState, target: BattleFighterState): void {
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
    !bAbility?.revealsStrongestOpponentMoveOnEntry &&
    !aAbility?.clearsAllScreensOnEntry &&
    !bAbility?.clearsAllScreensOnEntry &&
    !aAbility?.lowersOpponentEvasionOnEntry &&
    !bAbility?.lowersOpponentEvasionOnEntry
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

  // 배리어프리(Screen Cleaner)의 스크린 제거는 배틀 시작 시점엔 스크린이 없어 무의미하다.
  // 교체로 등장할 때는 applyEntryAbilityOnSwitchIn이 편(side) 스크린을 지운다(§6-3).

  for (const { slot, fighter, ability, opponent, opponentSlot } of order) {
    if (!ability) continue;
    const pokemonName = getPokemon(slot.pokemonId)?.name ?? "포켓몬";

    if (ability.lowersOpponentStatOnEntry) {
      const opponentName = getPokemon(opponentSlot.pokemonId)?.name ?? "상대";
      applyIntimidateWithReaction(
        opponent,
        ability.lowersOpponentStatOnEntry,
        pokemonName,
        ability.name,
        opponentName,
        announcements,
      );
    }
    // 감미로운꿀(포챔스판): 등장 시 상대의 회피율을 1랭크 떨어뜨린다(위협의 회피율 버전).
    if (ability.lowersOpponentEvasionOnEntry !== undefined) {
      const opponentName = getPokemon(opponentSlot.pokemonId)?.name ?? "상대";
      const before = opponent.accuracyStages.evasion;
      const raw = before + contraryDelta(opponent, ability.lowersOpponentEvasionOnEntry);
      opponent.accuracyStages = {
        ...opponent.accuracyStages,
        evasion: Math.max(-6, Math.min(6, raw)),
      };
      announcements.push(`${pokemonName}의 꿀에서 달콤한 향기가 나고 있다!`);
      if (opponent.accuracyStages.evasion !== before) {
        announcements.push(`${opponentName}의 회피율이 떨어졌다!`);
      }
    }
    if (ability.setsFieldOnEntry) {
      if (field) {
        announcements.push(`${pokemonName}의 ${ability.name}! 하지만 이미 다른 필드가 있어 실패했다!`);
      } else {
        field = ability.setsFieldOnEntry;
        fieldTurnsRemaining = FIELD_DURATION;
        announcements.push(`${pokemonName}의 ${ability.name}! 필드가 ${field}${roEuro(field)} 바뀌었다!`);
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

/** 한 진영의 초기 구성. 배틀타워는 slots 3개, 향후 다른 포맷을 위해 길이는 고정하지 않는다. */
export interface SideInit {
  slots: EvaluatorSlot[];
  /** slots와 같은 순서의 기술 목록. movesList[i]가 slots[i]의 지닌 기술. */
  movesList: Move[][];
  /** 선봉(리드) 인덱스. 생략 시 0 = 첫 슬롯이 리드. */
  leadIndex?: number;
}

export function createBattleState(init: { a: SideInit; b: SideInit; weather?: WeatherKind }): BattleState {
  const leadA = init.a.leadIndex ?? 0;
  const leadB = init.b.leadIndex ?? 0;
  const partyA = init.a.slots.map((slot, i) => createFighterState(slot, init.a.movesList[i] ?? []));
  const partyB = init.b.slots.map((slot, i) => createFighterState(slot, init.b.movesList[i] ?? []));
  const aSlot = init.a.slots[leadA];
  const bSlot = init.b.slots[leadB];
  const fighterA = partyA[leadA];
  const fighterB = partyB[leadB];
  const {
    weather: resolvedWeather,
    weatherTurnsRemaining,
    announcements: weatherAnnouncements,
  } = resolveEntryWeather(aSlot, fighterA, bSlot, fighterB, init.weather);
  const {
    field: entryField,
    fieldTurnsRemaining,
    announcements: abilityAnnouncements,
  } = resolveEntryAbilityEffects(aSlot, fighterA, bSlot, fighterB);

  const state: BattleState = {
    a: fighterA,
    b: fighterB,
    sideA: { party: partyA, activeIndex: leadA, hazards: emptyHazardState(), screens: {} },
    sideB: { party: partyB, activeIndex: leadB, hazards: emptyHazardState(), screens: {} },
    weather: resolvedWeather,
    weatherTurnsRemaining,
    field: entryField,
    fieldTurnsRemaining,
    turnNumber: 0,
    entryAnnouncements: [...weatherAnnouncements, ...abilityAnnouncements],
  };
  // 기분파(캐스퐁): 등장 시점의 유효 날씨(날씨부정 반영)에 맞춰 타입을 맞춰둔다.
  applyForecastForm(state.a, activeWeather(state));
  applyForecastForm(state.b, activeWeather(state));
  // 의태(메더): 등장 시점 필드에 맞춰 타입을 맞춰둔다(첫 턴 시작 훅이 안내는 따로 낸다).
  applyMimicryForm(state.a, state.field);
  applyMimicryForm(state.b, state.field);

  // 시드류: 배틀 시작 시점에 이미 필드가 깔려 있으면(등장 특성으로 방금 깔린 경우 포함) 발동.
  state.entryAnnouncements.push(...triggerTerrainSeeds(state));

  // 일루전(§6-1): 리드가 조로아크류면 배틀 시작 시점부터 파티 마지막 슬롯 모습으로 위장한다.
  for (const key of ["a", "b"] as const) {
    const f = state[key];
    if (f.effectiveAbilityId && getAbility(f.effectiveAbilityId)?.illusion) {
      const s = sideOf(state, key);
      f.illusionAs = computeIllusionTarget(s.party, s.activeIndex);
    }
  }
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

export function isFainted(fighter: BattleFighterState): boolean {
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
    ownMoveTypeBoosts: { ...fighter.ownMoveTypeBoosts },
  };
}

/** 편(side) 전체를 깊은 복사한다 — 파티 슬롯 전원 + 설치물 + 스크린. runTurn이 prevState를 안 건드리게 쓴다. */
export function cloneSide(side: BattleSide): BattleSide {
  return {
    party: side.party.map(cloneFighter),
    activeIndex: side.activeIndex,
    hazards: { ...side.hazards },
    screens: { ...side.screens },
    safeguardTurnsRemaining: side.safeguardTurnsRemaining,
    wish: side.wish ? { ...side.wish } : undefined,
    megaUsed: side.megaUsed,
  };
}

/** 편에 활성 슬롯 말고 아직 안 쓰러진 슬롯이 하나라도 있으면 true(파티 길이 1이면 항상 false) */
export function hasLivingReserve(side: BattleSide): boolean {
  return side.party.some((f, i) => i !== side.activeIndex && !isFainted(f));
}

/**
 * 드래곤테일·울부짖기류의 강제 교체가 이 대상에게 막히는지. 흡반(preventsForcedSwitch)은 기술·도구
 * 불문 강제 교체 저항, 뿌리박기(ingrain)는 땅에 붙어 밀려나지 않는다. 울부짖기의 방음(소리 차단)은
 * 기술 자체가 무효라 여기가 아니라 resolveAction 단계에서 걸러진다.
 */
export function isForcedSwitchBlocked(target: BattleFighterState): boolean {
  if (abilityOf(target)?.preventsForcedSwitch) return true;
  if (hasVolatile(target.volatile, "ingrain")) return true;
  return false;
}

/**
 * 문어굳히기(octolock)·물고버티기(jawLock)에 걸려 "자기 의지로 교체할 수 없는" 상태인지.
 * 고스트타입은 항상 예외(본가 — 도망봉인류가 안 통한다). 기절 후 강제 교체(applySwitch)는
 * 이 함수를 보지 않는다 — 어디까지나 유저가 교체를 "고를 수 있는지"만 판정한다(UI + runTurn
 * 액션 검증에서 참조). fighter가 fainted면 판정 의미가 없어 false.
 */
