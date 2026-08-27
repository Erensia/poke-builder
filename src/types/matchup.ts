import type { AbilityPoints } from "./party";
import type { StatStages } from "./battleStats";

/** 결정력·내구력 매치업 화면의 한쪽(내 포켓몬 또는 상대 포켓몬) 상태 */
export interface MatchupSlot {
  pokemonId: string | null;
  activeMegaForm?: string;
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
  /**
   * Phase 6.5 §1 — "이전 턴 가정" 토글. 매치업 페이지는 1턴 스냅샷이라 직전 턴 상황에
   * 의존하는 축을 직접 켜고 끄게 한다. 전부 off/0이면 지금까지와 동일한 계산.
   */
  /** 이 슬롯이 매지션/곡예로 상대 도구를 강탈했다고 가정 — 이 슬롯이 상대 도구를 장착하고 상대는 무도구가 된다 */
  itemStolenFromOpponent?: boolean;
  /** 곡예(Unburden) 발동 후라고 가정 — 이 슬롯의 실효 스피드를 2배로 계산 */
  unburdenAssumed?: boolean;
  /** 성묘 배율(공격 슬롯 전용, 선택한 기술이 성묘일 때만). 쓰러진 같은 편 수 가정 — 위력 50/100/150 */
  graveVisitFaintedAllies?: 0 | 1 | 2;
}
