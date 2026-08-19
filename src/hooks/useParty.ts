import { useEffect, useState } from "react";
import type { PartySlot } from "../types/party";
import { getPokemon } from "../lib/data";
import { findMegaFormByStone } from "../lib/pokemonForm";
import { loadParty, saveParty, clearSavedParty } from "../lib/storage";

export type PartySlots = [
  PartySlot | null,
  PartySlot | null,
  PartySlot | null,
  PartySlot | null,
  PartySlot | null,
  PartySlot | null,
];

const EMPTY_SLOTS: PartySlots = [null, null, null, null, null, null];

function emptySlot(pokemonId: string): PartySlot {
  return {
    pokemonId,
    moves: [null, null, null, null],
    ability: null,
    item: null,
  };
}

export function useParty() {
  const [slots, setSlots] = useState<PartySlots>(() => loadParty() ?? EMPTY_SLOTS);

  // 슬롯이 바뀔 때마다 브라우저 로컬 스토리지에 자동 저장한다.
  useEffect(() => {
    saveParty(slots);
  }, [slots]);

  function resetParty() {
    clearSavedParty();
    setSlots(EMPTY_SLOTS);
  }

  function setPokemon(index: number, pokemonId: string) {
    setSlots((prev) => {
      const next = [...prev] as PartySlots;
      next[index] = emptySlot(pokemonId);
      return next;
    });
  }

  function clearSlot(index: number) {
    setSlots((prev) => {
      const next = [...prev] as PartySlots;
      next[index] = null;
      return next;
    });
  }

  function setMove(slotIndex: number, moveIndex: 0 | 1 | 2 | 3, moveId: string | null) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      const moves = [...slot.moves] as PartySlot["moves"];
      moves[moveIndex] = moveId;
      next[slotIndex] = { ...slot, moves };
      return next;
    });
  }

  function setAbility(slotIndex: number, abilityId: string | null) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = { ...slot, ability: abilityId };
      return next;
    });
  }

  function setItem(slotIndex: number, itemId: string | null) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      const pokemon = getPokemon(slot.pokemonId);
      // 메가스톤을 장착하면 해당 메가폼을 자동 활성화하고, 그 외 도구/미지정이면 기본형으로 되돌린다.
      const matchedMega = pokemon ? findMegaFormByStone(pokemon, itemId) : undefined;
      next[slotIndex] = {
        ...slot,
        item: itemId,
        activeMegaForm: matchedMega?.form,
      };
      return next;
    });
  }

  return { slots, setPokemon, clearSlot, setMove, setAbility, setItem, resetParty };
}
