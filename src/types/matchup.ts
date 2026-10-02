import type { StatusCondition } from "./status";
import type { AbilityPoints } from "./party";
import type { StatStages } from "./battleStats";

/** 결정력·내구력 매치업 화면의 한쪽(내 포켓몬 또는 상대 포켓몬) 상태 */
export interface MatchupSlot {
  pokemonId: string | null;
  activeMegaForm?: string;
  /** 펌킨인 계열 크기 변종 선택값(Pokemon.sizeForms[].id). 없으면 종의 기준 크기 */
  sizeForm?: string;
  /** 루가루암 계열 폼 변종 선택값(Pokemon.formVariants[].id). 없으면 종의 기준 폼 */
  formVariant?: string;
  /** 마휘핑 계열 겉모습 선택값(Pokemon.cosmeticForms[].id). 이미지에만 영향, 전투 판정과 무관 */
  cosmeticForm?: string;
  ability: string | null;
  item: string | null;
  nature: string | null;
  points: AbilityPoints;
  stages: StatStages;
  /** 공격측 전용. 상대측은 항상 null로 둔다 */
  moveId: string | null;
  /**
   * 트리플악셀처럼 다단히트 기술일 때 선택한 적중 타수 (1~기술의 타수).
   * 단일 위력 기술이거나 아직 안 골랐으면 undefined.
   */
  multiHitCount?: number;
  /** 토해내기(spitUpPower) 기술을 골랐을 때 가정할 비축 스택(1~3). 기본 3. */
  stockpileCount?: number;
  /**
   * Phase 6.5 §1 — "이전 턴 가정" 토글. 매치업 페이지는 1턴 스냅샷이라 직전 턴 상황에
   * 의존하는 축을 직접 켜고 끄게 한다. 전부 off/0이면 지금까지와 동일한 계산.
   */
  /** 이 슬롯이 매지션/곡예로 상대 도구를 강탈했다고 가정 — 이 슬롯이 상대 도구를 장착하고 상대는 무도구가 된다 */
  itemStolenFromOpponent?: boolean;
  /** 곡예(Unburden) 발동 후라고 가정 — 이 슬롯의 실효 스피드를 2배로 계산 */
  unburdenAssumed?: boolean;
  /**
   * ver.1.9 — 이 슬롯의 주 상태이상 가정(이전 "마비 가정" 체크박스를 통합). 마비면 실효 스피드 0.5배, 화상이면 물리 공격 반감
   * (근성·객기 제외), 객기(공격측 화상·독·마비 2배)·베놈쇼크·독침천발(방어측 독)·백귀야행(방어측 상태이상)·이상한비늘에 반영.
   */
  statusAssumed?: StatusCondition | null;
  /** ver.1.9 공격 슬롯 — 상대보다 늦게 행동 가정(보복 2배) */
  movesLastAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — 이번 턴 상대 기술로 데미지를 입음 가정(눈사태 2배) */
  tookDamageAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — 이번 턴 자기 능력이 떨어짐 가정(분풀이 2배) */
  statLoweredAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — 이번 턴 상대가 이미 데미지를 입음 가정(승부굳히기 2배) */
  targetDamagedAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — 상대가 작아지기를 썼음 가정(누르기·드래곤다이브·플라잉프레스 2배) */
  targetMinimizedAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — 직전 턴 기술 실패 가정(분함의발구르기·열불내기 2배) */
  moveFailedAssumed?: boolean;
  /** ver.1.9 6-2 공격 슬롯 — 급소에 맞았다고 가정(랭크 일부·벽 무시, 데미지 ×1.5 — 스나이퍼 2.25) */
  critAssumed?: boolean;
  /** 2.2 F1 공격 슬롯 — 리베로·변환자재 자속보정: 공격 쪽 타입을 선택한 기술의 타입으로 보고 자속을 판정 */
  typeShiftAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — HP 1/3 이하 가정(맹화·급류·심록·벌레의알림 발동) */
  pinchAssumed?: boolean;
  /** ver.1.9 방어 슬롯 — HP 가득 가정(멀티스케일·섀도실드 발동). 생략하면 켬(이전 계산과 같음) */
  fullHpAssumed?: boolean;
  /** ver.1.9 공격 슬롯 — 현재 HP %(1~100). 분화·해수스파우팅·기사회생·바둥바둥 위력에만 쓴다. 생략하면 100 */
  hpPercent?: number;
  /**
   * Phase 6.5 §5 — 이 슬롯(방어측)에 스크린이 걸려 있다고 가정. 받는 데미지가 절반이 된다.
   * 리플렉터=물리, 빛의장막=특수, 오로라베일=물리·특수 둘 다. 없으면 undefined(=지금까지와 동일).
   */
  screen?: "reflect" | "lightScreen" | "auroraVeil";
  /** 성묘 배율(공격 슬롯 전용, 선택한 기술이 성묘일 때만). 쓰러진 같은 편 수 가정 — 위력 50/100/150 */
  graveVisitFaintedAllies?: 0 | 1 | 2;
}

/** ver.1.9 — 조건부 위력 가정 토글(공격 슬롯)의 저장 키 */
export type PowerConditionKey =
  | "movesLastAssumed"
  | "tookDamageAssumed"
  | "moveFailedAssumed"
  | "statLoweredAssumed"
  | "targetDamagedAssumed"
  | "targetMinimizedAssumed";
