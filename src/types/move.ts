import type { PokemonType } from "./pokemon-type";
import type { EffectStatKey } from "./battleStats";
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
   * "first-turn-only"(속이기 — 등장 후 첫 턴에만. 1v1 시뮬레이터엔 교체가 없어 배틀의 1턴째로 취급).
   * 조건을 안 채우면 battleSimulator가 blockedReason: "usageCondition"으로 실패시킨다.
   */
  usageCondition?: "sleep-only" | "first-turn-only";
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
}
