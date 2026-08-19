import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import { getEffectiveness } from "./typeEffectiveness";
import { getPokemon } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import type { PartySlots } from "../hooks/useParty";

export interface TypeCoverageCell {
  type: PokemonType;
  /** 이 타입 기술에 2배 이상 맞는 파티원 수 (4배는 quad에 별도 집계) */
  weak: number;
  quad: number;
  /** 0.5배 이하로 견디는 파티원 수 (0.25배는 quadResist에 별도 집계) */
  resist: number;
  quadResist: number;
  /** 무효(0배)인 파티원 수 */
  immune: number;
}

export interface PartyMember {
  pokemonId: string;
  name: string;
  types: PokemonType[];
  /** 메가진화 중이면 폼 id (예: "리자몽-메가X") */
  formLabel: string | null;
}

/** 파티에 채워진 포켓몬을, 메가스톤 장착 여부까지 반영한 실제 타입으로 계산해 반환한다 */
export function getPartyMembers(slots: PartySlots): PartyMember[] {
  return slots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((slot) => {
      const pokemon = getPokemon(slot.pokemonId);
      if (!pokemon) return null;
      const form = getEffectiveForm(pokemon, slot);
      return {
        pokemonId: pokemon.id,
        name: pokemon.name,
        types: form.types,
        formLabel: form.formLabel,
      };
    })
    .filter((m): m is PartyMember => m !== null);
}

export function computeTypeCoverage(slots: PartySlots): TypeCoverageCell[] {
  const memberTypes = getPartyMembers(slots).map((m) => m.types);

  return POKEMON_TYPES.map((attacking) => {
    const cell: TypeCoverageCell = {
      type: attacking,
      weak: 0,
      quad: 0,
      resist: 0,
      quadResist: 0,
      immune: 0,
    };
    for (const defending of memberTypes) {
      const mult = getEffectiveness(attacking, defending);
      if (mult === 0) cell.immune++;
      else if (mult >= 4) cell.quad++;
      else if (mult >= 2) cell.weak++;
      else if (mult <= 0.25) cell.quadResist++;
      else if (mult < 1) cell.resist++;
    }
    return cell;
  });
}
