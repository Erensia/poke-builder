import type { PokemonType } from "./pokemon-type";
import type { EffectStatKey, BattleStatKey } from "./battleStats";
import type { StatusCondition, StatusInflictEffect, VolatileInflictEffect } from "./status";
import type { FieldKind } from "./field";
import type { WeatherKind } from "./weather";

/** 2턴 차지 기술이 준비 턴 동안 숨는 방식. bypassesHiding이 이 값을 포함한 기술만 예외적으로 맞힐 수 있다 */
export type ChargeHideType = "underground" | "sky" | "underwater" | "hidden";

export type MoveCategory = "physical" | "special" | "status";

/** 기술 분류 태그 (챔피언스 기술표 기준). 특성 상호작용(메가런처=파동, 촉촉보이스=소리 등) 판별에 쓴다 */
export type MoveClassification =
  | "구슬/폭탄"
  | "물기"
  | "베기"
  | "펀치"
  | "소리"
  | "파동"
  | "춤"
  | "바람";

export interface StatChangeEffect {
  target: "self" | "opponent";
  /** 기존 5스탯(atk/def/spa/spd/spe) + 명중률/회피율 + 급소율("critStage")까지 대상이 될 수 있다 */
  stat: EffectStatKey;
  /** 상대적 증감 (칼춤: +2, 아이언테일: 상대 def -1) */
  delta?: number;
  /** 절댓값으로 고정 (배북: 공격을 +6으로 설정) */
  setTo?: number;
  /** 확률(%). 생략하면 100% 확정 */
  chance?: number;
  /** 사용자 자신이 이 타입일 때만 적용 (예: 저주 - 고스트 타입이면 다른 효과로 갈림) */
  userIsType?: PokemonType;
  /** 사용자 자신이 이 타입이 아닐 때만 적용 */
  userIsNotType?: PokemonType;
}

export interface Move {
  id: string;
  name: string;
  /** 아직 수치를 확인하지 못한 TODO 기술은 null */
  type: PokemonType | null;
  category: MoveCategory | null;
  /** 변화기는 위력이 없으므로 null */
  power: number | null;
  /** 필중기는 accuracy가 없으므로 null */
  accuracy: number | null;
  pp: number;
  /** 우선도. 0이 기본, 도우미(+5)처럼 빠르면 양수, 트릭룸 대상 기술처럼 느리면 음수 */
  priority: number;
  effect: string;
  /** 랭크 변화가 있는 기술만 채운다. 없으면 생략 */
  statChanges?: StatChangeEffect[];
  /**
   * 상대(또는 자신)에게 상태이상을 거는 기술만 채운다. 독가스처럼 상태이상 전용기는 chance 생략(100%),
   * 화염방사처럼 부가효과면 chance를 채운다. 대상은 항상 상대로 취급 — 자신에게 거는 기술(휴식 등
   * 자힐+수면)은 아직 스키마 밖이라 데이터 보강 시 필요하면 target 필드를 추가한다.
   */
  inflictsStatus?: StatusInflictEffect[];
  /**
   * 상대(또는 자신)에게 행동방해 효과(풀죽음/반동/혼란)를 거는 기술만 채운다.
   * 기가임팩트류는 target: "self"로 반동(recharge)을 자신에게 건다.
   */
  inflictsVolatile?: VolatileInflictEffect[];
  /** 분류 태그가 없는 기술이 대부분이라 선택 필드. 파동탄처럼 2개 이상 붙는 경우도 있어 배열 */
  classification?: MoveClassification[];
  /** 접촉기 여부. 확인 안 된 기술은 생략 (단정하지 않음) */
  makesContact?: boolean;
  /**
   * 트리플악셀처럼 맞을 때마다 위력이 달라지는 다단히트 기술의 타수별 위력.
   * [1타 위력, 2타 위력, 3타 위력, ...]. power는 이 배열의 첫 값과 같다.
   */
  multiHitPowers?: number[];
  /**
   * 한 번 사용 시 몇 번 공격하는지. 다단히트 기술만 채운다 (없으면 1회).
   * 더블어택처럼 횟수가 고정이면 min과 max가 같다.
   * 록블라스트처럼 2~5회 랜덤이면 min=2, max=5 (확률은 2/3회 각 35%, 4/5회 각 15%,
   * 스킬링크 특성이면 항상 max회, 속임수주사위 소지 시 최소 4회 고정).
   * 집단구타는 max가 파티 마리 수(최대 6)로 가변적이고, 타수별 위력도 고정이 아니라
   * effect 설명에 별도로 적어둔다.
   */
  minHits?: number;
  maxHits?: number;
  /** 자폭·대폭발처럼 명중/기절 여부와 무관하게 사용자가 반드시 기절하는 기술만 채운다 */
  selfFaints?: boolean;
  /**
   * 나이트헤드처럼 상대의 방어(특방)·랭크·특성·도구·급소를 전부 무시하고 고정 수치만 HP에서 직접
   * 깎는 기술만 채운다. 챔피언스는 레벨 50 고정이라 "사용자의 레벨만큼"은 곧 50으로 고정된다.
   * 타입 상성 면역(0배)만은 그대로 존중한다.
   */
  fixedDamage?: number;
  /** 그래스필드/미스트필드/사이코필드/일렉트릭필드처럼 필드를 새로 까는 기술만 채운다 */
  setsField?: FieldKind;
  /**
   * 스텔스록처럼 상대 진영에 설치물을 까는 기술만 채운다. 현행 시뮬레이터는 교체가 없어 "등장 시
   * 데미지"는 미구현 — 설치 상태와 로그·환경 UI 표시만 반영한다(Phase 6.5 §6-2 ④, 나머지는 §8).
   */
  setsHazard?: "stealthRock";
  /** 트릭룸: 5턴간 우선도가 같으면 스피드가 느린 쪽이 먼저 움직이도록 순서를 뒤집는 기술만 채운다 */
  setsTrickRoom?: boolean;
  /**
   * 불꽃세례·웨이브태클·브레이브버드·양날박치기처럼 준 데미지의 일정 비율만큼 사용자도 반동
   * 데미지를 입는 기술만 채운다(예: 1/3). 상대에게 준 데미지가 0(면역 등)이면 반동도 0이다 —
   * 발버둥의 "최대 HP의 1/4 고정 반동"과는 계산 기준이 다르므로 별도 필드로 분리했다.
   */
  recoilFraction?: number;
  /**
   * 섀도클로·스톤에지·메가톤킥·블레이즈킥·크로스촙·사이코커터·에어커터처럼 "급소에 맞을 확률이
   * 높다"(하이 크리티컬)고 표시된 기술만 채운다. statChanges의 critStage 랭크업(기충전 등)과
   * 달리 지속 효과가 아니라 이 기술을 쓰는 순간에만 급소율에 +1단계를 임시로 얹는다.
   */
  highCritRatio?: boolean;
  /** 트릭플라워처럼 반드시 급소에 맞는 기술만 채운다. */
  alwaysCrit?: boolean;
  /**
   * 특정 조건에서만 사용할 수 있는 기술만 채운다. "sleep-only"(코골기 — 잠든 상태에서만, 그리고
   * 그 잠듦 자체가 본가처럼 이 기술의 사용을 막지 않는 예외 취급),
   * "first-turn-only"(속이기 — 등장 후 첫 턴에만. 1v1 시뮬레이터엔 교체가 없어 배틀의 1턴째로 취급),
   * "field-required"(아이언롤러 — 활성화된 필드가 하나도 없으면 실패),
   * "opponent-damaging-move-only"(기습 — 상대가 이번 턴 데미지 기술(물리/특수)을 선택하지 않았거나,
   * 자신이 상대보다 늦게 움직이면 실패. 두 조건 모두 "동시 비공개 선택" 특성상 행동 실행 시점에만
   * 판정 가능해 UI에서 사전 경고를 줄 수 없다),
   * "weather-required"(오로라베일 — 현재 날씨가 requiresWeather와 다르면 실패).
   * 조건을 안 채우면 battleSimulator가 blockedReason: "usageCondition"으로 실패시킨다.
   */
  usageCondition?:
    | "sleep-only"
    | "first-turn-only"
    | "field-required"
    | "opponent-damaging-move-only"
    | "weather-required";
  /** usageCondition: "weather-required"일 때만 의미 있음 — 이 날씨가 아니면 사용 자체가 실패한다(오로라베일=눈) */
  requiresWeather?: WeatherKind;
  /**
   * 그래스슬라이더 전용. 이 필드가 활성 상태면 기술의 우선도가 delta만큼 오른다(그 외 상황엔
   * priority 값 그대로). 사이코필드의 "우선도 기술 차단"과는 필드가 서로 배타적이라(동시에
   * 활성화될 수 없음) 겹칠 일이 없다.
   */
  priorityBoostInField?: { field: FieldKind; delta: number };
  /**
   * 미스트버스트(미스트필드)·와이드포스(사이코필드)·라이징볼트(일렉트릭필드)처럼, 지정한 필드가
   * 활성 상태일 때 위력에 곱해지는 배율만 채운다. 필드 타입 자체가 위력을 올리는 getFieldDamageMultiplier
   * (자속처럼 타입 일치 시 1.3배)와는 별개 축 — 이쪽은 기술 고유의 "이 필드에서만 강해짐" 효과다.
   */
  powerMultiplierInField?: { field: FieldKind; multiplier: number };
  /**
   * 대지의파동(Terrain Pulse) 전용. 필드가 활성 상태면 기술의 실제 타입이 그 필드의 표시 타입
   * (FIELD_DISPLAY_TYPE)으로 바뀌고 위력이 2배가 된다. 필드가 없으면 원본 그대로(노말타입 50).
   */
  fieldPulse?: boolean;
  /** 아이언롤러(Steel Roller) 전용. 명중하면 활성화된 필드를 제거한다. */
  destroysField?: boolean;
  /**
   * 공중날기·구멍파기·다이빙·고스트다이브·뛰어오르기·솔라빔처럼 "1턴째 준비, 2턴째 실제 발동"하는
   * 차지 기술만 채운다. 준비 턴에는 데미지 없이 이 기술 사용만 기록되고, 다음 턴 자동으로
   * 재실행된다(PP는 준비 턴에 1번만 소모).
   */
  chargeTurn?: boolean;
  /**
   * 준비 턴 동안 숨는 방식(공중날기=sky, 구멍파기=underground, 다이빙=underwater,
   * 고스트다이브=hidden). 있으면 그동안 대부분의 기술이 빗나가고, bypassesHiding에 이 값이
   * 포함된 기술만 예외적으로 맞힐 수 있다. 솔라빔처럼 숨지 않고 그냥 준비만 하는 기술은
   * 생략(무적 없음 — 준비 턴에도 평소처럼 맞을 수 있다).
   */
  chargeHideType?: ChargeHideType;
  /** 솔라빔처럼 특정 날씨(쾌청)면 준비 턴 없이 1턴만에 발동하는 기술만 채운다. */
  chargeSkipWeather?: WeatherKind;
  /**
   * 메테오빔·일렉트로빔처럼 "1턴째(준비 선언 시점)에 자신의 능력치가 오르는" 차지 기술만 채운다.
   * chargeSkipWeather로 준비 턴 자체가 생략되는 경우(예: 일렉트로빔+비)에도 "이 기술을 쓴 턴"은
   * 여전히 1턴째이므로 동일하게 적용된다 — statChanges와 별도 필드로 분리한 이유는, statChanges는
   * (일반적인 자기 강화기처럼) 실제 공격이 나가는 턴에 적용되는 필드라 2턴째(공격 턴)에 다시
   * 적용되면 안 되기 때문이다.
   */
  chargeStatChanges?: StatChangeEffect[];
  /**
   * 지진·땅고르기(구멍파기의 underground 무적을 뚫음), 번개·폭풍(공중날기·뛰어오르기의 sky
   * 무적을 뚫음), 파도타기(다이빙의 underwater 무적을 뚫음)처럼 상대의 차지 기술 준비 턴
   * 무적을 예외적으로 맞힐 수 있는 기술만 채운다.
   */
  bypassesHiding?: ChargeHideType[];
  /**
   * 지진(구멍파기 무적을 뚫을 때)·파도타기(다이빙 무적을 뚫을 때)처럼, 숨은 상대를 실제로
   * 맞혔을 때 위력이 배가되는 예외 기술만 채운다(effect 텍스트에 명시). 번개·폭풍처럼 그냥
   * 맞히기만 하고 배율은 없는 예외 기술은 생략(1배로 취급).
   */
  hidingBypassMultiplier?: number;
  /**
   * 물거품아리아처럼 명중 시 상대(또는 자신)의 주 상태이상을 없애는 기술만 채운다.
   * inflictsStatus(거는 것)와 반대 방향 — 이미 걸린 상태이상이 없으면 아무 일도 없다.
   * status를 채우면 그 상태이상일 때만 치료한다(물거품아리아=화상 한정). 생략하면 어떤
   * 주 상태이상이든 치료(잠자기처럼 "전부 회복"인 경우용 — 아직 태깅된 기술은 없음).
   */
  curesStatus?: { target: "self" | "opponent"; status?: StatusCondition };
  /**
   * 불사르기·열사의대지·플레어드라이브 등 "사용 직전 사용자의 얼음 상태를 치유한다"는 불꽃
   * 관련 기술만 채운다. 얼음 상태에서 이 기술을 선택하면 매턴 25%(또는 해제 스케줄) 판정 없이
   * 무조건 먼저 해동된 뒤 기술이 정상적으로 나간다 — 코골기가 잠듦 차단을 우회하는 것과 같은 결.
   * 나무위키 기준 원래 10개 기술이 있지만, 지금 로스터에 데이터가 있는 건 3개뿐(나머지는 후속 보강).
   */
  thawsUserOnUse?: boolean;
  /**
   * 광합성·달빛처럼 날씨에 따라 회복량이 달라지는 즉시 회복기만 채운다(사용자 확인 공식:
   * 쾌청 2/3, 날씨 없음 1/2, 그 외 날씨(비/모래바람/싸라기눈) 1/4 — 전부 최대 HP 기준).
   * healsFraction과는 배타적으로 쓴다.
   */
  healsWeatherDependent?: boolean;
  /**
   * 날개쉬기·게으름피우기처럼 날씨와 무관하게 고정 비율만큼 즉시 회복하는 기술, 또는
   * 치유파동처럼 상대를 회복시키는 기술(healsTarget: "opponent")만 채운다. 최대 HP 기준 비율.
   */
  healsFraction?: number;
  /** healsFraction/healsWeatherDependent의 회복 대상. 생략하면 self(자신) */
  healsTarget?: "self" | "opponent";
  /**
   * 잠자기 전용. 명중 시(항상 필중) 자신의 체력을 완전히 회복하고, 기존 상태이상을 무엇이든
   * 지우고 정확히 2턴간 무조건 잠재운다(statusConditions.inflictRestSleep). curesStatus나
   * inflictsStatus의 일반 규칙(이미 상태이상이 있으면 안 걸림)과는 다른 별도 경로라 전용
   * 필드로 분리했다.
   */
  restSleep?: boolean;
  /**
   * 기가드레인·드레인펀치·드레인키스·원념의칼처럼 이번 공격으로 준 데미지의 일정 비율만큼
   * 사용자가 회복하는 기술만 채운다(예: 1/2, 드레인키스는 3/4). recoilFraction의 회복 버전 —
   * 데미지가 0(면역 등)이면 회복도 0. 큰뿌리(Item.drainHealMultiplier)를 지녔으면 1.3배.
   */
  drainFraction?: number;
  /**
   * 뿌리박기(ingrain)·아쿠아링(aquaRing)처럼 "걸려있는 동안 매 턴 종료 시 최대 HP 1/16을
   * 회복"하는 지속 효과를 자신에게 거는 기술만 채운다. 이미 걸려있으면 재사용 시 실패.
   * 큰뿌리를 지녔으면 회복량이 1.3배가 된다.
   */
  setsRegenVolatile?: "ingrain" | "aquaRing";
  /**
   * 씨뿌리기 전용. 상대에게 leechSeed를 걸어 매 턴 종료 시 상대가 최대 HP 1/8을 잃고 자신이
   * 그만큼(자신이 큰뿌리를 지녔으면 1.3배) 회복하게 한다. 상대가 이미 걸려있으면 실패.
   */
  setsLeechSeed?: boolean;
  /**
   * 비바라기·쾌청·모래바람·설경처럼 날씨를 바꾸는 기술만 채운다. 필드/트릭룸과 달리 이미 다른
   * (또는 같은) 날씨가 있어도 실패하지 않고 항상 덮어쓴다 — 본가 규칙. 지속시간은 기본 5턴,
   * 사용자가 그 날씨에 맞는 바위(Item.weatherDurationBonus)를 지녔으면 8턴.
   */
  setsWeather?: WeatherKind;
  /**
   * 리플렉터(물리 반감)·빛의장막(특수 반감)·오로라베일(물리·특수 둘 다 반감, "auroraVeil")처럼
   * 자신 쪽에 5턴짜리 데미지 경감 스크린을 치는 기술만 채운다. 이미 같은 스크린이 걸려있으면
   * 실패(필드/트릭룸과 같은 패턴). 빛의점토를 지녔으면 8턴. 급소 공격은 스크린을 무시한다(본가 규칙).
   */
  setsScreen?: "reflect" | "lightScreen" | "auroraVeil";
  /**
   * 흑안개처럼 명중 시 양쪽(자신+상대)의 능력 랭크 변화를 전부 초기화하는 기술만 채운다.
   * 5스탯(공격/방어/특공/특방/스피드)과 명중률/회피율 랭크까지 리셋하고, 급소율(critStage)은
   * 본가에서 별개 축이라 건드리지 않는다.
   */
  resetsAllStages?: boolean;
  /**
   * 대타출동 전용. 명중과 무관하게(항상 자기 자신 대상) 최대 HP 1/4를 깎아 그만큼의 HP를 가진
   * 대타를 세운다. 이미 대타가 있거나, 최대 HP 1/4보다 현재 HP가 많지 않으면(=써도 대타 HP가
   * 0 이하가 되거나 자신이 기절하면) 실패한다.
   */
  setsSubstitute?: boolean;
  /**
   * 사슬묶기 전용. 명중 시 상대가 "바로 직전에 쓴 기술"(defender.lastMoveId) 하나를 대상으로
   * 지정해 그 기술만 사용 불가로 만든다("disable" volatile). 상대가 아직 아무 기술도 쓴 적이
   * 없으면(lastMoveId 없음) 또는 이미 disable이 걸려 있으면 실패한다.
   */
  setsDisable?: boolean;
  /**
   * 앙코르 전용. 명중 시 상대가 "바로 직전에 쓴 기술"(defender.lastMoveId)만 강제로 반복하게
   * 만든다("encore" volatile, disable과 정반대 방향). 상대가 아직 아무 기술도 쓴 적이 없으면
   * 또는 이미 encore가 걸려 있으면 실패한다.
   */
  setsEncore?: boolean;
  /**
   * 방어/판별/버티기/킹실드(=방어류) 공통 태그. 이 필드가 있는 기술은 전부 같은 계열로 묶여
   * 연속 성공 횟수(BattleFighterState.protectStreak)를 공유한다 — 성공할 때마다 다음 시도의
   * 성공 확률이 (1/3)^streak로 줄어들고, 계열이 아닌 다른 기술을 쓰거나 실패하면 0으로 리셋된다.
   *  - "block"(방어/판별/킹실드): 성공하면 이번 턴 상대의 공격(카테고리 무관 — 상태이상 기술도
   *    포함)을 완전히 무효화한다.
   *  - "endure"(버티기): 막지는 않고, 데미지는 그대로 받되 이번 턴만큼은 HP가 1 밑으로 내려가지
   *    않는다(기합의띠·옹골참과 조건은 다르지만 결과는 같은 축).
   *  - "destinyBond"(길동무): 막지 않는다 — 성공하면 자신을 "길동무 예약" 상태로 만들 뿐이고,
   *    activeProtect(매 턴 시작 시 초기화)가 아니라 BattleFighterState.destinyBondArmed(자신의
   *    다음 행동 전까지 유지)로 별도 추적한다. 본가에서 Gen 7부터 방어류와 같은 연속 성공 확률
   *    공식((1/3)^streak)을 공유해서 이 프로젝트도 protectStreak를 그대로 재사용한다.
   */
  protectEffect?: "block" | "endure" | "destinyBond";
  /**
   * 킹실드 전용. protectEffect: "block"이 성공해서 상대의 접촉기를 막았을 때, 그 공격자에게
   * 추가로 거는 랭크변화(공격 -1). 접촉기가 아니면 막았어도 이 효과는 붙지 않는다.
   */
  protectContactPenalty?: { stat: BattleStatKey; delta: number };
  /**
   * 파워트릭 전용. 명중 시(항상 자기 자신 대상) 이 두 스탯의 실수치를 그 자리에서 서로 맞바꾼다
   * (파워트릭=["atk","def"]). 노력치/성격 보정이 이미 반영된 BattleFighterState.realStats를
   * 직접 스왑하는 것뿐이라 별도 재계산이 필요 없다 — 킬가르도 배틀스위치가 폼 전환 시
   * realStats를 직접 교체하는 것과 같은 패턴.
   */
  swapsOwnStats?: [BattleStatKey, BattleStatKey];
  /**
   * 프리즈드라이 전용. 상대가 이 타입이면 통상 상성표를 무시하고 타입 상성 배율을 이 값으로
   * 강제 오버라이드한다(프리즈드라이=물타입 상대에게 2배). 방어측이 타입 면역을 이미 스스로
   * 얻은 경우(absorbsType·grantsImmunityToTypes)엔 면역이 우선이라 이 오버라이드는 적용되지
   * 않는다 — moveContext.ts에서 면역 판정 다음에 확인한다.
   */
  overridesTypeEffectivenessFor?: { type: PokemonType; effectiveness: number };
  /**
   * 고스트다이브 전용. "상대의 방어를 무시하고 공격한다"는 원문은 방어 실수치가 아니라
   * 방어류(방어/판별/버티기/킹실드, Move.protectEffect) 기술의 차단 자체를 뜻한다(사용자 확인) —
   * 틈새포착(Ability.bypassesScreensAndSubstitute)이 스크린/대타를 무시하는 것과 같은 결의
   * "방어류 무시" 축. 이 필드가 있으면 blockedByProtect 판정 자체를 건너뛰어 상대의 방어/판별/
   * 버티기/킹실드에 막히지 않고 명중·데미지 계산까지 그대로 진행한다.
   */
  bypassesProtect?: boolean;
  /**
   * 매직미러(Ability.reflectsOpponentStatusMoves)로 되돌릴 수 없는 변화기에 표시한다. 본가 기준
   * 반사 예외 — 고스트 타입의 저주, 추억의선물, 화면 전체 판정인 멸망의노래·흔들흔들댄스 등.
   * (바꿔치기·트릭·스킬스왑처럼 isOpponentTargetingMove가 애초에 false인 기술은 이 플래그 없이도
   * 반사 대상에서 자연히 빠진다.)
   */
  notReflectable?: boolean;
  /**
   * 성스러운칼 전용. 데미지 계산에서 상대(방어측)의 능력 랭크 변화(상승분·하락분 전부)를
   * 무시한다 — Ability.ignoresOpponentStatStagesInDamage(천진)와 정확히 같은 축이지만 특성이
   * 아니라 기술 단위 효과라는 점만 다르다(둘 중 하나만 있어도 발동, 중첩 시 자연히 무해).
   */
  ignoresDefenderStatStagesInDamage?: boolean;
  /**
   * 잠꼬대 전용. usageCondition: "sleep-only" 게이트를 통과한 뒤(=실제로 잠든 채 이 기술을
   * 선택했다는 뜻), 이 기술 자신 대신 자신이 배운 다른 기술 중 하나를 무작위로 대신 발동시킨다
   * (본가 규칙, 사용자 확인). 후보에서 제외되는 것: 잠꼬대 자신, 차지 기술(chargeTurn — 2턴짜리
   * 기술을 대신 낼 수 없음), usageCondition이 있는 기술(코골기·속이기·아이언롤러·오로라베일·
   * 기습처럼 별도 발동 조건이 있는 변화기·기술 — "일부 변화기 제외"에 해당), excludedFromSleepTalk가
   * true인 기술(트림·흉내쟁이처럼 위 두 축으로 안 걸러지는 본가 고유 제외 목록). PP는 잠꼬대
   * 자신만 이미 소모했고 대신 나가는 기술의 PP는 깎지 않는다(본가와 동일).
   */
  callsRandomLearnedMove?: boolean;
  /**
   * 잠꼬대 후보에서 제외해야 하지만 chargeTurn·usageCondition 어느 쪽으로도 안 걸러지는 기술
   * (본가 고유 규칙). 트림(나무열매를 먹은 적이 있어야 하는데 그 조건 자체가 usageCondition으로
   * 구조화돼 있지 않음), 흉내쟁이(상대가 직전에 쓴 기술을 그대로 베끼는 기술이라 "잠꼬대가 대신
   * 낸 기술"이라는 개념 자체가 성립하지 않음) 둘 다 본가에서 잠꼬대 후보 목록에 없다.
   */
  excludedFromSleepTalk?: boolean;
}
