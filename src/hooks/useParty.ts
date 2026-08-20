import { useEffect, useState } from "react";
import type { AbilityPoints, PartySlot } from "../types/party";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { getPokemon } from "../lib/data";
import { findMegaFormByStone } from "../lib/pokemonForm";
import { loadParty, saveParty, clearSavedParty } from "../lib/storage";
import {
  MAX_ABILITY_POINTS_PER_STAT,
  MAX_ABILITY_POINTS_TOTAL,
  totalAbilityPoints,
} from "../lib/statCalculator";

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
    nature: null,
    points: { ...EMPTY_ABILITY_POINTS },
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

  function setNature(slotIndex: number, natureId: string | null) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = { ...slot, nature: natureId };
      return next;
    });
  }

  /** 합산 66 / 스탯당 32를 넘지 않도록 클램프해서 능력 포인트 한 스탯을 절대값으로 설정한다 (직접 입력용) */
  function setPoint(slotIndex: number, stat: keyof AbilityPoints, value: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const clampedValue = Math.max(0, value);
      const restTotal = totalAbilityPoints(slot.points) - slot.points[stat];
      const maxForStat = Math.min(
        MAX_ABILITY_POINTS_PER_STAT,
        MAX_ABILITY_POINTS_TOTAL - restTotal,
      );
      const next = [...prev] as PartySlots;
      next[slotIndex] = {
        ...slot,
        points: { ...slot.points, [stat]: Math.min(clampedValue, maxForStat) },
      };
      return next;
    });
  }

  /** 이전 상태를 기준으로 증감시킨다 (버튼용) — 빠르게 연속 클릭해도 각 클릭이 누락되지 않는다 */
  function stepPoint(slotIndex: number, stat: keyof AbilityPoints, delta: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const currentValue = slot.points[stat];
      const restTotal = totalAbilityPoints(slot.points) - currentValue;
      const maxForStat = Math.min(
        MAX_ABILITY_POINTS_PER_STAT,
        MAX_ABILITY_POINTS_TOTAL - restTotal,
      );
      const nextValue = Math.min(Math.max(0, currentValue + delta), maxForStat);
      if (nextValue === currentValue) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = { ...slot, points: { ...slot.points, [stat]: nextValue } };
      return next;
    });
  }

  return {
    slots,
    setPokemon,
    clearSlot,
    setMove,
    setAbility,
    setItem,
    setNature,
    setPoint,
    stepPoint,
    resetParty,
  };
}
