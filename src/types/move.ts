import type { PokemonType } from "./pokemon-type";

export type MoveCategory = "physical" | "special" | "status";

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
  effect: string;
}
