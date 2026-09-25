// 배틀 엔진의 "로그/결과" 타입 모음 — lib/battleSimulator.ts에서 추출(ver.1.5 §4).
// BattleFighterState/BattleSide/BattleState 등 "살아있는 배틀 상태" 축은 EvaluatorSlot
// (lib/matchupEvaluator.ts)에 의존해서 여기로 옮기면 types/ -> lib/ 역전이 그대로 남으므로
// battleSimulator.ts에 남겨뒀다 — 이 파일은 그 의존이 없는 로그/결과 타입만 담는다.
import type { Move } from "./move";
import type { WeatherKind } from "./weather";
import type { FieldKind } from "./field";
import type { PokemonType } from "./pokemon-type";
import type { AccuracyEvasionKey, BattleStatKey } from "./battleStats";
import type { StatusConditionState, VolatileCondition } from "./status";

/**
 * 진영(side)에 붙는 설치물 상태. 슬롯이 아니라 편에 붙으므로 교체해도 유지된다.
 * Phase 8 §1: 스칼라 `{a,b}` 불리언에서 진영별 구조체로 승격. 스택 처리(압정뿌리기 층수·
 * 독압정 층수)는 §6에서 채운다 — S1 시점엔 스텔스록·압정뿌리기만 기존 불리언과 1:1 대응
 * (`spikesLayers`는 0 또는 1).
 */
export interface HazardState {
  /** 스텔스록(1장 고정). 등장 시 바위 상성 배율로 데미지(§6). */
  stealthRock: boolean;
  /** 압정뿌리기 층수 0~3. 등장 시 1→1/16 · 2→1/8 · 3→1/4 데미지(§6). 비접지는 무시. */
  spikesLayers: number;
  /** 독압정 층수 0~2. 1→독 · 2→맹독(§6). 독타입 등장 시 해제. 비접지는 무시. */
  toxicSpikesLayers: number;
  /** 끈적끈적네트(1장 고정). 접지 상태로 등장 시 스피드 -1(§6). */
  stickyWeb: boolean;
}

export type FighterKey = "a" | "b";

/** 이번 턴 행동이 왜 못 나갔는지. 있으면 hit/damage 등은 의미 없다 */
export type ActionBlockReason =
  | "status"
  | "flinch"
  | "recharge"
  | "confusion"
  | "attract"
  | "psychicFieldPriority"
  | "queenlyMajesty"
  | "usageCondition"
  | "moveRestricted";

/**
 * 다단히트 한 타에서 방어측 on-hit 특성이 한 일(지구력·깨어진갑옷=랭크 변화 / 까칠한피부·철가시=
 * 반격 데미지 / 미끈미끈·점착=공격자 랭크↓ / 정전기·불꽃몸=상태이상 / 헤롱헤롱바디=헤롱헤롱 /
 * 저주받은바디=기술 봉인 / 나쁜손버릇·미라·떠도는영혼·모래뿜기). 랭크류·반격뎀은 타마다,
 * 나머지는 실제 발동한 그 타에 한 번만 담긴다. 단타 기술은 이 구조를 안 쓰고 기존 집계 필드 사용.
 */
export interface HitAbilityEvent {
  /** 이 이벤트를 일으킨 방어측 특성 이름 */
  abilityName: string;
  statusOnAttacker?: StatusConditionState["condition"];
  volatileOnAttacker?: VolatileCondition;
  /** 까칠한피부·철가시·유폭·내용물분출 등으로 공격자가 이 타에 입은 데미지 합 */
  damageToAttacker?: number;
  raisedDefenderStats?: { stat: BattleStatKey; delta: number }[];
  loweredDefenderStats?: { stat: BattleStatKey; delta: number }[];
  loweredAttackerStats?: { stat: BattleStatKey; delta: number }[];
  disabledMoveName?: string;
  pickpocketStolenItemName?: string;
  mummifiedAttackerAbilityName?: string;
  wanderingSpiritSwapped?: boolean;
  sandSpitWeather?: WeatherKind;
  /** 넘치는씨: 피격으로 필드가 이 값으로 바뀌었으면 그 필드 */
  setFieldOnHit?: FieldKind;
}

/** 한 번의 기술 사용 결과 로그 */
export interface ActionLogEntry {
  actor: FighterKey;
  /** 이 행동을 한 포켓몬 종 id(일루전 위장 시 위장 대상). 유턴류 턴 중간 교체로 한 카드 안에서
   *  활성이 바뀌므로, 로그는 turn.activePokemonIds(턴 끝 스냅샷)가 아니라 이 값으로 이름을 쓴다. */
  actorPokemonId: string;
  /** 이 행동의 대상(상대 활성) 포켓몬 종 id — 위 이유로 같이 스냅샷한다. */
  defenderPokemonId: string;
  move: Move;
  /** 주 상태이상(잠듦/얼음/마비)이나 행동방해(풀죽음/반동/혼란 자멸)로 기술을 못 썼으면 채워진다 */
  blockedReason?: ActionBlockReason;
  /** blockedReason이 "status"일 때, 정확히 어떤 상태이상 때문인지(마비/잠듦/얼음) — UI가 "몸이 저려서"/"쿨쿨 잠들어"/"얼어 버려서" 문구를 골라 쓰는 데 필요 */
  blockedByStatus?: StatusConditionState["condition"];
  /** blockedReason이 "moveRestricted"일 때, 도발/사슬묶기/앙코르 중 무엇 때문에 막혔는지 */
  moveRestrictionKind?: "taunt" | "disable" | "encore" | "torment" | "imprison" | "gravity";
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
  /** 시드류(Item.terrainSeedBoost)가 이번 행동으로 새로 깔린 필드에 반응해 발동한 안내 문구 */
  terrainSeedMessages?: string[];
  /** 스텔스록을 어느 진영에 깔았으면 그 진영 키(a/b). 로그 문구용 */
  stealthRockSetForSide?: FighterKey;
  /** 압정뿌리기(스파이크)를 어느 진영에 새 층을 깔았으면 그 진영 키(a/b). 비검천중파·암석액스·압정뿌리기 */
  spikesSetForSide?: FighterKey;
  /** 독압정을 어느 진영에 새 층을 깔았으면 그 진영 키(a/b) */
  toxicSpikesSetForSide?: FighterKey;
  /** 끈적끈적네트를 어느 진영에 깔았으면 그 진영 키(a/b) */
  stickyWebSetForSide?: FighterKey;
  /** 설치기를 깔려 했으나 이미 최대라 실패했으면 true */
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
  /** 트릭룸이 걸린 중에 다시 써서 해제했다(트랙 M4) */
  trickRoomEnded?: boolean;
  /** 원더룸·매직룸을 걸었거나(on) 다시 써서 해제했다(트랙 M4) */
  roomChange?: { room: "wonderRoom" | "magicRoom"; on: boolean };
  /** 떨어뜨리기(트랙 M4): 공중에 있던 상대를 땅에 떨어뜨렸다 */
  smackedDownTarget?: boolean;
  gravitySet?: boolean;
  gravitySetFailed?: boolean;
  magnetRiseSet?: boolean;
  magnetRiseFailed?: boolean;
  /** 이 행동으로 날씨가 바뀌었으면(비바라기 등) 그 날씨. 이미 같은 날씨라 실패했으면 비어 있다 */
  setWeather?: WeatherKind;
  /** 날씨 기술을 썼지만 이미 같은 날씨라 실패했으면 true(본가 규칙, 사용자 확인) */
  weatherSetFailed?: boolean;
  /** 이 행동으로 리플렉터/빛의장막이 자신 쪽에 새로 걸렸으면 채워진다 */
  setScreen?: "reflect" | "lightScreen" | "auroraVeil";
  /** 리플렉터/빛의장막을 썼지만 이미 같은 스크린이 걸려있어서 실패했으면 true */
  screenSetFailed?: boolean;
  /** 이 행동으로 신비의부적(세이프가드)이 자신 쪽에 새로 걸렸으면 true */
  setSafeguard?: boolean;
  /** 신비의부적을 썼지만 이미 걸려있어서 실패했으면 true */
  safeguardSetFailed?: boolean;
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
  /**
   * 다단히트 기술의 타별 내역(명중한 타수만큼, 순서대로). UI가 타마다 데미지 줄을 따로 찍는다.
   * `damagePercent`는 그 한 타 데미지 ÷ 대상 최대 HP(누적 아님), `critical`은 그 타의 급소 여부,
   * `abilityEvent`는 그 타에서 방어측 on-hit 특성(지구력·깨어진갑옷·까칠한피부·정전기 등)이 한 일.
   */
  hits?: {
    damage: number;
    damagePercent: number;
    critical: boolean;
    abilityEvent?: HitAbilityEvent;
  }[];
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
  /** 노말주얼 등 타입 젬: 이번 기술로 소모되며 위력을 올렸으면 그 도구 이름 */
  ateGemItemName?: string;
  /** 풍선: 데미지를 받아 터져서 소모됐으면 그 도구 이름 */
  balloonPoppedItemName?: string;
  /** 흡수기(Move.drainFraction)로 회복한 양(큰뿌리 배율 반영 후) */
  drainHealAmount?: number;
  /** 해감액: 흡수기가 회복 대신 공격측에게 입힌 데미지 */
  liquidOozeDamage?: number;
  /** liquidOozeDamage를 일으킨 방어측 특성 이름 */
  liquidOozeAbilityName?: string;
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
  /** 꼬리자르기로 대타(최대 HP 1/2)를 세운 것 — 교체는 switches 배열로 별도 렌더된다 */
  shedTailSucceeded?: boolean;
  /** 꼬리자르기를 썼지만 HP 절반 이하·대타 보유·예비 없음으로 실패했으면 true */
  shedTailFailed?: boolean;
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
  /** 가드스왑·파워스왑으로 자신·상대의 랭크 변화를 맞바꿨으면 그 기술 이름 */
  swappedStagesMoveName?: string;
  /** 가드셰어로 자신·상대의 방어·특방 실능을 평균냈으면 그 기술 이름 */
  averagedDefensesMoveName?: string;
  /** 스피드스왑으로 자신·상대의 스피드 실능을 맞바꿨으면 그 기술 이름 */
  swappedSpeedMoveName?: string;
  /** 트릭·바꿔치기(트랙 M1): 바꾼 뒤 시전자가 얻은 도구 이름 / 상대가 얻은 도구 이름(없으면 빈 칸) */
  swappedItems?: { userGotName?: string; targetGotName?: string };
  /** 트릭·바꿔치기가 실패(둘 다 무도구·메가스톤·점착)했으면 true */
  itemSwapFailed?: boolean;
  /** 아픔나누기(트랙 M1)로 둘이 나눠 가진 HP(각자 최대 HP로 잘리기 전 값) */
  painSplitHp?: number;
  /** 순풍(트랙 M1)을 일으켰으면 true / 이미 불고 있어 실패했으면 true */
  tailwindSet?: boolean;
  tailwindSetFailed?: boolean;
  /** 꿀꺽(트랙 M1)이 비축이 없어 실패했으면 true */
  stockpileHealFailed?: boolean;
  /** 리사이클(트랙 M1)로 되찾은 도구 이름 / 되찾을 도구가 없어 실패했으면 true */
  recycledItemName?: string;
  recycleFailed?: boolean;
  /** 자기암시(트랙 M2): 랭크 변화를 복사해 온 상대 이름 */
  copiedStagesFromName?: string;
  /** 파워셰어(트랙 M2): 공격·특공을 나눠 가졌으면 기술 이름 */
  averagedAttacksMoveName?: string;
  /** 원한(트랙 M2): PP를 줄인 상대 기술과 줄인 양 */
  spitePp?: { moveName: string; amount: number };
  spiteFailed?: boolean;
  /** 경혈찌르기(트랙 M2): 무작위로 오른 능력과 오른 칸 수 */
  acupressureRaised?: { stat: BattleStatKey | AccuracyEvasionKey; delta: number };
  acupressureFailed?: boolean;
  /** 트랙 M3: 마이페이스(혼란)·둔감(헤롱헤롱·도발)으로 막힌 행동방해. self면 시전자 자신에게 걸려던 것 */
  /** 트랙 M3: 스킬스왑(swap)·동료만들기(give)·역할(copy)·위액(suppress) 성공. abilityName은 건넨/복사한 특성 */
  abilityChange?: { kind: "swap" | "give" | "copy" | "suppress"; abilityName?: string };
  abilityChangeFailed?: boolean;
  /** 미러타입(트랙 M3): 복사한 타입 */
  copiedTypes?: PokemonType[];
  volatileBlockedByAbility?: { abilityName: string; volatile: VolatileCondition; self: boolean };
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
   * 골드러시·오버히트·용성군 등이 자기 자신의 랭크를 실제로 내린 것(§4-6). delta는 내려간
   * 칸 수(양수) — opponentStatDrops와 같은 포맷, 주어만 항상 actorName. 확정 하락만(확률
   * 부가효과 제외).
   */
  selfStatDrops?: { stat: BattleStatKey; delta: number }[];
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
  /** 울퉁불퉁멧: 접촉기로 공격해 온 공격자가 입은 데미지 합(다단히트면 타수 합산) */
  rockyHelmetDamage?: number;
  /** rockyHelmetDamage를 준 도구 이름 */
  rockyHelmetItemName?: string;
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
  /** 방탄처럼 방어측 특성이 이 구슬·폭탄 기술을 완전히 무효화했으면 그 특성 이름 */
  bulletproofBlockedByAbilityName?: string;
  /** 아로마베일처럼 방어측 특성이 헤롱헤롱·도발·기술봉인·앙코르를 막았으면 그 특성 이름 */
  mentalMoveBlockedByAbilityName?: string;
  /** 황금몸처럼 방어측 특성이 명중한 변화기의 효과를 전부 무효화했으면 그 특성 이름 */
  goodAsGoldBlockedByAbilityName?: string;
  /** 뒤집어엎기로 상대의 능력 랭크 변화를 전부 반전시켰으면 true */
  invertedTargetStages?: boolean;
  /** 숲의저주·핼러윈으로 상대에게 추가한 타입 (배틀 끝까지 유지) */
  addedTypeToTarget?: PokemonType;
  /** 송전으로 이번 턴 상대 기술 타입을 이 타입으로 바꿨으면 그 타입 */
  targetMoveTypeOverride?: PokemonType;
  /** 미끈미끈·점착처럼 방어측 특성이 접촉한 공격자의 랭크를 내렸으면 그 특성 이름 */
  abilityLoweredAttackerStatsAbilityName?: string;
  /** abilityLoweredAttackerStatsAbilityName이 바꾼 스탯·폭 */
  abilityLoweredAttackerStats?: { stat: BattleStatKey; delta: number }[];
  /** 볼주머니 — 나무열매를 먹어 추가 회복이 발동했으면 그 회복량 */
  cheekPouchHeal?: number;
  /** 부리캐논 가열 중 접촉기로 맞아 공격자가 화상을 입었으면 true */
  beakBlastBurnedAttacker?: boolean;
  /** 토치카가 접촉기를 막아 공격자에게 건 주 상태이상(poison) */
  protectContactInflictedStatus?: StatusConditionState["condition"];
  /** 발끈 — 상대 기술 데미지로 HP 절반 이하가 되어 방어측 특수공격이 올랐으면 true */
  angerPointRaisedSpa?: boolean;
  /** angerPointRaisedSpa를 발동시킨 특성 이름 */
  angerPointAbilityName?: string;
  /** 소울비트 — HP를 소비했으면 그 소비량 */
  soulBeatHpCost?: number;
  /** 소울비트 — 현재 HP가 소비량 이하라 실패했으면 true */
  soulBeatFailed?: boolean;
  /** 떠도는영혼 — 접촉 피격으로 공격자와 특성을 맞바꿨으면 true */
  wanderingSpiritSwapped?: boolean;
  /** 모래뿜기 — 피격으로 날씨를 바꿨으면 그 날씨 */
  sandSpitWeather?: WeatherKind;
  /** 넘치는씨 — 피격으로 필드를 바꿨으면 그 필드 */
  seedSowerField?: FieldKind;
  /** 마법가루 — 상대의 타입을 이 타입 하나로 덮어썼으면 그 타입 */
  overwroteTargetType?: PokemonType;
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
  /** 일격기(트랙 M5): 옹골참으로 막혔으면 그 특성 이름 / 면역 타입(절대영도 → 얼음)이라 안 통했으면 true */
  ohkoBlockedByAbilityName?: string;
  ohkoImmune?: boolean;
  /** 흉내쟁이(트랙 M2)로 대신 나간 기술 이름 */
  copycatCalledMoveName?: string;
  /** 변환자재로 자신의 타입이 이번 기술의 타입으로 바뀌었으면 그 타입 */
  changedOwnTypeTo?: PokemonType;
  /** changedOwnTypeTo를 발동시킨 특성 이름 */
  changedOwnTypeAbilityName?: string;
  /** 전광쌍격(Move.losesTypeAfterUse): 사용 후 사라진 자신의 타입(명중·빗나감 무관) */
  lostTypeAfterUse?: PokemonType;
  /** 대검돌격(Move.glaiveRush): 이 기술을 써서 "다음 행동 전까지 피격 필중·피해 2배" 상태가 됐으면 true */
  glaiveRushArmed?: boolean;
  /** 코트체인지(Move.swapsSideEffects): 양쪽 진영의 설치물·스크린을 맞바꿨으면 true */
  courtChangeDone?: boolean;
  /** 회생의기도(Move.revivesFaintedAlly): 부활시킨 교대 포켓몬 이름 */
  revivedPartyName?: string;
  /** 회생의기도를 썼지만 부활시킬 대상(기절한 교대 포켓몬)이 없었으면 true */
  reviveFailed?: boolean;
  /** 문어굳히기(Move.octolock): 상대를 도망봉인 상태로 만들었으면 true */
  octolockApplied?: boolean;
  /** 물고버티기(Move.jawLock): 양쪽을 도망봉인 상태로 만들었으면 true */
  jawLockApplied?: boolean;
  /** 위기회피: 이번 행동으로 방어측 HP가 절반 이하로 떨어져 방어측이 물러나야 하면 true */
  triggersDefenderEmergencyExit?: boolean;
  /** triggersDefenderEmergencyExit를 일으킨 방어측 특성 이름 */
  emergencyExitAbilityName?: string;
  /** 탈(Disguise)처럼 방어측 특성이 이번 데미지를 통째로 무효화했으면 그 특성 이름 */
  hitNegatedByAbilityName?: string;
  /** hitNegatedByAbilityName이 발동하며(=탈이 벗겨지며) 방어측이 입은 반동 데미지 */
  disguiseRecoilDamage?: number;
  /** 일루전(§6-1): 이 행동으로 방어측 조로아크의 위장이 풀렸으면 그 조로아크의 진짜 종 id(로그 문구용) */
  illusionBrokenSpeciesId?: string;
  /**
   * 길동무: 이 행동(공격측의 공격)으로 상대가 쓰러졌는데, 상대가 길동무 예약 상태였어서
   * 공격측도 같이 쓰러졌으면 true. fainted/selfFainted 둘 다 이미 true로 채워지지만, UI가
   * "왜 같이 쓰러졌는지" 전용 문구를 보여줄 수 있게 별도 플래그로 남긴다.
   */
  triggeredDestinyBond?: boolean;
  /** 편승 — 상대가 이번 기술로 올린 랭크를 그대로 복사해 자신도 올렸으면 그 목록 */
  opportunistCopiedStats?: { stat: BattleStatKey; delta: number }[];
  /** opportunistCopiedStats를 발동시킨 특성 이름 */
  opportunistAbilityName?: string;
  /** 전기로바꾸기 — 충전 상태라 이번 전기 기술의 위력이 2배가 됐으면 그 특성 이름 */
  electromorphosisEmpoweredAbilityName?: string;
  /** 변덕레이저 — 확률 발동으로 위력이 2배가 됐으면 true */
  fickleBeamEmpowered?: boolean;
  /** 정리정돈 — 명중해서 설치물·대타를 정리했으면 true ("정리정돈 끝!" 문구용) */
  tidyUpDone?: boolean;
  /** 소금절이 — 명중해서 상대를 소금절이 상태로 만들었으면 true */
  saltCureApplied?: boolean;
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
  /** 해감액: 씨뿌리기 흡수가 회복 대신 데미지로 반사됐으면 true(damage에 실제 수치) */
  liquidOozeDamage?: boolean;
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
  /** 소금절이 지속 데미지면 true (damage에 실제 수치). 강철/물 타입이라 1/8이었으면 saltCureHeavy도 true */
  saltCureDamage?: boolean;
  saltCureHeavy?: boolean;
  /** 물엿범벅(시럽봄): 턴 종료 시 스피드가 1랭크 떨어졌으면 true */
  syrupCoatDrop?: boolean;
  /** 문어굳히기(octolock): 턴 종료 시 방어·특수방어가 1랭크씩 떨어졌으면 true */
  octolockDrop?: boolean;
  /** 멸망의노래 카운트 안내(F-4) — 이번 턴 종료 시점의 남은 카운트(3→2→1) */
  perishCount?: number;
  /** 멸망의노래 카운트가 0에 도달해 이번 턴 종료에 쓰러졌으면 true */
  perishFainted?: boolean;
  /** 볼주머니: 턴 종료 시 나무열매를 먹어 발동한 추가 회복량 */
  cheekPouchHeal?: number;
  /** 수확: 턴 종료 시 되돌린 나무열매 이름 */
  harvestRestoredBerryName?: string;
  /** 꼬르륵스위치: 턴 종료 시 바뀐 모양 */
  hungerModeChangedTo?: "full" | "hangry";
}

export interface TurnResult {
  turnNumber: number;
  /** 이번 턴 실제로 먼저 행동한 쪽 */
  order: [FighterKey, FighterKey];
  /**
   * 이번 턴에 실제로 행동한(=교체 선처리 직후 활성이던) 포켓몬 종 id. 로그에서 "누가 이 기술을
   * 썼나"를 현재 활성이 아니라 그 턴 기준으로 표시하려고 스냅샷해 둔다(Phase 8 §3 — 교체 이후
   * 과거 턴 로그가 현재 활성 이름으로 잘못 표시되던 문제).
   */
  activePokemonIds: Record<FighterKey, string>;
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
  /** 이번 턴에 신비의부적(세이프가드)이 5턴을 다 채우고 사라진 편 목록 — 양쪽 다 걸려있을 수 있어 배열 */
  expiredSafeguard: FighterKey[];
  /** 순풍(트랙 M1)이 이번 턴 종료로 멈춘 편 */
  expiredTailwind?: FighterKey[];
  /** 트랙 M4: 이번 턴 끝에 끝난 원더룸·매직룸·중력 */
  expiredFieldEffects?: ("wonderRoom" | "magicRoom" | "gravity")[];
  /** 트랙 M4: 이번 턴 끝에 전자부유가 끝난 쪽 */
  expiredMagnetRise?: FighterKey[];
  /** 턴 시작 시점에 발생한 안내 문구(의태 타입 변화 등). 없으면 빈 배열 */
  turnStartAnnouncements: string[];
  /**
   * 이번 턴 처리된 교체(Phase 8 §3). 한쪽 교체면 1개, 양쪽 교체면 2개, 교체 없으면 빈 배열.
   * 교체 우선도상 항상 기술보다 먼저 처리되므로 로그에서도 actions 앞에 놓는다.
   */
  switches: SwitchLogEntry[];
}

/** 이번 턴 한 편에서 일어난 교체(플레이어 선택) — 로그 문구용 */
export interface SwitchLogEntry {
  side: FighterKey;
  fromIndex: number;
  toIndex: number;
  /** 물러난 포켓몬 종 id */
  outPokemonId: string;
  /** 새로 나온 포켓몬 종 id */
  inPokemonId: string;
  /** 이 교체로 발생한 등장/퇴장 안내(재생력·자연회복·위협·날씨 등, Phase 8 §4). 없으면 빈 배열 */
  entryMessages: string[];
  /**
   * 유턴·볼트체인지·배턴터치로 "사용측 기술 뒤"에 일어난 자체 교체면 true(§7-2). 로그에서 이
   * 교체는 그 편의 기술 줄 다음에 놓는다(선처리 교체는 actions 앞).
   */
  afterMove?: boolean;
  /**
   * 드래곤테일·울부짖기류로 상대가 강제로 끌려나온 교체면 true. `side`는 기술을 맞은(끌려나온)
   * 편이고 `afterMove`도 함께 true다. 로그 문구를 "돌아와!"가 아니라 강제 교체용으로 바꿔 쓴다.
   */
  forced?: boolean;
  /**
   * 꼬리자르기로 세운 대타를 넘기며 물러난 교체면 true(§4-1). `afterMove`도 함께 true.
   * 로그에서 통상 "돌아와! ○○!"·"가라! ○○!" 두 줄 **앞에** "○○은 트레이너의 곁으로
   * 돌아간다!" 줄을 추가로 붙인다(대체가 아니라 추가 — BattleTurnLog.tsx 참고).
   */
  shedTail?: boolean;
  /**
   * 썰렁개그(Move.selfSwitchAfterUse)로 물러난 교체면 true. `afterMove`도 함께 true. 꼬리자르기처럼
   * "○○은(는) 트레이너의 곁으로 돌아간다!" 줄을 앞에 붙인다(대타 인계는 없음).
   */
  returnsToTrainer?: boolean;
  /**
   * 레드카드로 강제 교체됐으면 그 도구 이름. `forced`도 함께 true지만, 드래곤테일과 달리 `side`가
   * "상대에게 도구를 맞은 공격자"(자기 자신의 편) — 끌려나온 쪽이 기술 시전자의 반대가 아니라
   * 시전자 자신이라는 게 다르다. UI가 이 필드 유무로 두 케이스를 가른다.
   */
  redCardItemName?: string;
}

/** 한 편이 이번 턴에 하는 행동. 교체는 항상 기술보다 먼저 처리된다(Phase 8 §3). */
export type TurnAction =
  | {
      kind: "move";
      move: Move;
      /**
       * 메가진화 선언(백로그 §4). true면 이 턴의 행동 직전(턴 순서 계산 전)에 메가진화가 처리된다.
       * 스톤이 없거나·이미 메가진화했거나·그 편이 이미 이번 배틀에서 메가진화를 썼으면 무시된다.
       */
      mega?: boolean;
    }
  | { kind: "switch"; toIndex: number };
