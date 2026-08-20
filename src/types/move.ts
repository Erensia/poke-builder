import type { PokemonType } from "./pokemon-type";
import type { BattleStatKey } from "./battleStats";

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
  stat: BattleStatKey;
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
}
