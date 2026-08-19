import type { PokemonType } from "./pokemon-type";
import type { BaseStats } from "./stats";

export interface MegaEvolution {
  /** 메가진화 폼 고유 id. 한 포켓몬이 메가진화를 2종 가질 수 있어 배열 원소마다 구분한다. */
  form: string;
  /** 이 폼으로 진화시키는 메가스톤 item id */
  megaStone: string;
  types: PokemonType[];
  baseStats: BaseStats;
  ability: string;
}

export interface Pokemon {
  id: string;
  name: string;
  types: PokemonType[];
  baseStats: BaseStats;
  abilities: string[];
  hiddenAbility?: string;
  /** 메가진화가 없으면 생략. 2종 이상 가진 포켓몬은 배열 원소를 늘린다. */
  megaEvolutions?: MegaEvolution[];
  learnset: string[];
}
