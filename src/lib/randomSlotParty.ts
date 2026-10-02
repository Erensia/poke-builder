import type { PartySlot } from "../types/party";
import { getPokemon } from "./data";
import { findMegaFormByStone } from "./pokemonForm";

const PARTY_SIZE = 6;
/** 메가스톤 든 포켓몬은 최대 2마리 — 배틀에서 메가진화는 편당 한 번뿐이라 2마리 이상은 선출·전략 선택지일 뿐 규칙 위반은 아니다 */
const MAX_MEGAS = 2;

function isMega(slot: PartySlot): boolean {
  const pokemon = getPokemon(slot.pokemonId);
  return !!slot.activeMegaForm || (!!pokemon && !!findMegaFormByStone(pokemon, slot.item));
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 저장해 둔 슬롯(포켓몬 1마리 빌드)에서 마리 단위로 6마리를 뽑아 랜덤 파티를 만든다(2.2 B6).
 * 같은 포켓몬·같은 도구 중복 금지, 메가 2마리 이하(샘플 파티의 1마리 이하보다 넓게 — 더 다양한 조합을 위해). 저장 슬롯이 6마리에 못 미치면
 * 모자란 만큼 fallback(기본 제공 샘플의 슬롯)에서 같은 규칙으로 보충한다. 입력은 건드리지 않고 사본을 돌려준다.
 */
export function buildRandomPartyFromSlots(
  saved: readonly PartySlot[],
  fallback: readonly PartySlot[],
  random: () => number = Math.random,
): { slots: PartySlot[]; fromSaved: number } {
  const picked: PartySlot[] = [];
  const pokemonIds = new Set<string>();
  const itemIds = new Set<string>();
  let megas = 0;
  const take = (pool: readonly PartySlot[]) => {
    for (const slot of shuffled(pool, random)) {
      if (picked.length >= PARTY_SIZE) return;
      if (pokemonIds.has(slot.pokemonId) || (slot.item && itemIds.has(slot.item))) continue;
      const mega = isMega(slot);
      if (mega && megas >= MAX_MEGAS) continue;
      picked.push(structuredClone(slot));
      pokemonIds.add(slot.pokemonId);
      if (slot.item) itemIds.add(slot.item);
      if (mega) megas++;
    }
  };
  take(saved);
  const fromSaved = picked.length;
  take(fallback);
  return { slots: picked, fromSaved };
}
