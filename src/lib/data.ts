import pokemonJson from "../data/pokemon.json";
import movesJson from "../data/moves.json";
import abilitiesJson from "../data/abilities.json";
import itemsJson from "../data/items.json";
import naturesJson from "../data/natures.json";
import samplePartiesJson from "../data/samplePartyPresets.json";
import type { Pokemon } from "../types/pokemon";
import type { Move } from "../types/move";
import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import type { Nature } from "../types/nature";
import type { SamplePartyPreset } from "../types/party";

export const POKEMON = pokemonJson as Pokemon[];
export const MOVES = movesJson as Move[];
export const ABILITIES = abilitiesJson as Ability[];
export const ITEMS = itemsJson as Item[];
export const NATURES = naturesJson as Nature[];
/** 기본 제공 샘플 파티(ver.2.1 B) — 읽기 전용 */
export const SAMPLE_PARTIES = samplePartiesJson as SamplePartyPreset[];

const pokemonById = new Map(POKEMON.map((p) => [p.id, p]));
const moveById = new Map(MOVES.map((m) => [m.id, m]));
const abilityById = new Map(ABILITIES.map((a) => [a.id, a]));
const itemById = new Map(ITEMS.map((i) => [i.id, i]));
const natureById = new Map(NATURES.map((n) => [n.id, n]));

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

export function getNature(id: string): Nature | undefined {
  return natureById.get(id);
}
