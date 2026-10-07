import { getMove, getPokemon } from "./data";
import type { SamplePartyPreset } from "../types/party";

/**
 * 내 샘플이 지금 데이터로 쓸 수 있는지(3.1 S2) — 6마리 모두 있는 포켓몬이고 배정한 기술이 전부 있는 기술이다.
 * 데이터가 바뀌어 id가 사라지면 저장해 둔 샘플이 깨질 수 있어서, 무작위 샘플·프런티어 풀에 넣기 전에 거른다.
 */
export function isUsableSample(sample: SamplePartyPreset): boolean {
  return (
    Array.isArray(sample.slots) &&
    sample.slots.length === 6 &&
    sample.slots.every((slot) => !!slot && !!getPokemon(slot.pokemonId) && slot.moves.every((id) => id === null || !!getMove(id)))
  );
}
