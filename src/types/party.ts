import type { StatKey } from "./nature";
import type { PokemonGender } from "./pokemon";

/** 챔피언스식 능력 포인트. 6스탯 합산 최대 66. (본가 노력치의 축약판, 레벨/개체값 개념은 없음) */
export type AbilityPoints = Record<StatKey, number>;

export const EMPTY_ABILITY_POINTS: AbilityPoints = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

export interface PartySlot {
  pokemonId: string;
  /** 메가진화가 있는 포켓몬이 도구로 메가스톤을 장착했을 때 선택된 폼 id */
  activeMegaForm?: string;
  /** 항상 4개 슬롯. 비어있는 슬롯은 null */
  moves: [string | null, string | null, string | null, string | null];
  ability: string | null;
  item: string | null;
  /** 성격 id. 미지정이면 무보정으로 취급 */
  nature: string | null;
  /** 6스탯에 분배한 능력 포인트. 합산 66 이하 */
  points: AbilityPoints;
  /**
   * 사용자가 직접 고른 성별. 종족 성별 카테고리가 "both"(양성 가능)일 때만 의미가 있고, 그 외
   * 카테고리(단일성별/무성별)는 이 값과 무관하게 항상 종족 카테고리를 따른다(getEffectiveGender).
   * 미지정이면 수컷을 기본값으로 취급한다(Phase 6 §1-1 — 사용자 확정 2026-08-26).
   */
  gender?: PokemonGender;
}

export interface Party {
  id: string;
  name: string;
  /** 항상 6마리 슬롯. 비어있는 슬롯은 null */
  slots: [
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
  ];
}
