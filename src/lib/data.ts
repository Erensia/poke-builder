import pokemonJson from "../data/pokemon.json";
import movesJson from "../data/moves.json";
import abilitiesJson from "../data/abilities.json";
import itemsJson from "../data/items.json";
import type { Pokemon } from "../types/pokemon";
import type { Move } from "../types/move";
import type { Ability } from "../types/ability";
import type { Item } from "../types/item";

export const POKEMON = pokemonJson as Pokemon[];
export const MOVES = movesJson as Move[];
export const ABILITIES = abilitiesJson as Ability[];
export const ITEMS = itemsJson as Item[];

const pokemonById = new Map(POKEMON.map((p) => [p.id, p]));
const moveById = new Map(MOVES.map((m) => [m.id, m]));
const abilityById = new Map(ABILITIES.map((a) => [a.id, a]));
const itemById = new Map(ITEMS.map((i) => [i.id, i]));

export function getPokemon(id: string): Pokemon | undefined {
  return pokemonById.get(id);
}

export function getMove(id: string): Move | undefined {
  return moveById.get(id);
}

export function getAbility(id: string): Ability | undefined {
  return abilityById.get(id);
}

export function getItem(id: string): Item | undefined {
  return itemById.get(id);
}
