import type { Pokemon, MegaEvolution } from "../types/pokemon";
import type { PokemonType } from "../types/pokemon-type";
import type { BaseStats } from "../types/stats";

/** getEffectiveForm이 실제로 필요로 하는 부분만 뽑은 형태. PartySlot이나 MatchupSlot 둘 다 만족한다 */
export interface FormSource {
  item: string | null;
  activeMegaForm?: string;
}

export interface EffectiveForm {
  /** 메가진화 상태면 해당 폼, 아니면 undefined */
  mega?: MegaEvolution;
  types: PokemonType[];
  baseStats: BaseStats;
  /** 표시용: 메가진화 중이면 "리자몽 (메가X)" 형태로 쓸 수 있는 폼 이름 */
  formLabel: string | null;
}

/** 도구로 장착한 메가스톤에 맞는 메가진화 폼을 찾는다 */
export function findMegaFormByStone(
  pokemon: Pokemon,
  itemId: string | null,
): MegaEvolution | undefined {
  if (!itemId || !pokemon.megaEvolutions) return undefined;
  return pokemon.megaEvolutions.find((m) => m.megaStone === itemId);
}

/** 슬롯의 도구/activeMegaForm을 반영한 실제 타입·종족값을 계산한다 */
export function getEffectiveForm(pokemon: Pokemon, slot: FormSource): EffectiveForm {
  const mega =
    pokemon.megaEvolutions?.find((m) => m.form === slot.activeMegaForm) ??
    findMegaFormByStone(pokemon, slot.item);

  if (mega) {
    return {
      mega,
      types: mega.types,
      baseStats: mega.baseStats,
      formLabel: mega.form,
    };
  }
  return {
    types: pokemon.types,
    baseStats: pokemon.baseStats,
    formLabel: null,
  };
}
