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
}
