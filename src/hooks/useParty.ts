import { useEffect, useState } from "react";
import type { AbilityPoints, PartySlot, PartySlots } from "../types/party";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { getPokemon } from "../lib/data";
import { loadParty, saveParty, clearSavedParty } from "../lib/storage";
import {
  applyItemToSlot,
  cycleFormOnSlot,
  setAbilityPointOnSlot,
  stepAbilityPointOnSlot,
} from "../lib/slotMutations";

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

  /** 파티 프리셋 불러오기(Phase 6 §1-2) — 현재 편성 6슬롯을 통째로 덮어쓴다 */
  function loadSlots(nextSlots: PartySlots) {
    setSlots(nextSlots);
  }

  /** 샘플(빌드) 프리셋 불러오기(Phase 6 §1-3) — 슬롯 하나만 통째로 덮어쓴다 */
  function loadSlot(index: number, slot: PartySlot) {
    setSlots((prev) => {
      const next = [...prev] as PartySlots;
      next[index] = slot;
      return next;
    });
  }

  /**
   * 드래그앤드랍으로 두 슬롯의 배치 순서를 맞바꾼다(§3). 빈 슬롯끼리·빈 슬롯과 채워진 슬롯 사이도
   * 그냥 스왑 — "채워진 슬롯을 빈 슬롯으로 옮기기"도 이 하나의 연산으로 자연히 표현된다.
   */
  function reorderSlots(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setSlots((prev) => {
      const next = [...prev] as PartySlots;
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      return next;
    });
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
      next[slotIndex] = applyItemToSlot(slot, itemId);
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

  /** 수컷/암컷을 바로 뒤집는다(미지정이면 수컷을 기본값으로 취급해서 그 반대인 암컷으로) */
  function toggleGender(slotIndex: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      // 에써르류(formVariantByGender): 성별 = 폼. formVariant 를 토글하고 특성 선택은 초기화한다.
      if (getPokemon(slot.pokemonId)?.formVariantByGender) {
        const nextForm = (slot.formVariant ?? "male") === "male" ? "female" : "male";
        next[slotIndex] = { ...slot, formVariant: nextForm, ability: null };
      } else {
        next[slotIndex] = { ...slot, gender: (slot.gender ?? "male") === "male" ? "female" : "male" };
      }
      return next;
    });
  }

  /** 펌킨인 계열 크기 변종을 다음 크기로 돌린다(sizeForms 순서 순환, 끝에서 처음으로) */
  function cycleSizeForm(slotIndex: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const nextSlot = cycleFormOnSlot(slot, "sizeForm");
      if (nextSlot === slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = nextSlot;
      return next;
    });
  }

  /** 루가루암 계열 폼 변종을 다음 폼으로 돌린다. 폼별로 특성 목록이 달라 특성 선택은 초기화한다 */
  function cycleFormVariant(slotIndex: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const nextSlot = cycleFormOnSlot(slot, "formVariant");
      if (nextSlot === slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = nextSlot;
      return next;
    });
  }

  /** 마휘핑 계열 겉모습을 다음 모습으로 돌린다(cosmeticForms 순서 순환). 이미지에만 영향 — 특성/스탯 불변 */
  function cycleCosmeticForm(slotIndex: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const nextSlot = cycleFormOnSlot(slot, "cosmeticForm");
      if (nextSlot === slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = nextSlot;
      return next;
    });
  }

  /** 마휘핑 계열 겉모습을 리스트에서 고른 id로 바로 설정한다(옵션이 5개 이상이라 순환이 불편한 종용) */
  function setCosmeticForm(slotIndex: number, formId: string) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = { ...slot, cosmeticForm: formId };
      return next;
    });
  }

  /** 합산 66 / 스탯당 32를 넘지 않도록 클램프해서 능력 포인트 한 스탯을 절대값으로 설정한다 (직접 입력용) */
  function setPoint(slotIndex: number, stat: keyof AbilityPoints, value: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = setAbilityPointOnSlot(slot, stat, value);
      return next;
    });
  }

  /** 이전 상태를 기준으로 증감시킨다 (버튼용) — 빠르게 연속 클릭해도 각 클릭이 누락되지 않는다 */
  function stepPoint(slotIndex: number, stat: keyof AbilityPoints, delta: number) {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (!slot) return prev;
      const nextSlot = stepAbilityPointOnSlot(slot, stat, delta);
      if (nextSlot === slot) return prev;
      const next = [...prev] as PartySlots;
      next[slotIndex] = nextSlot;
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
    toggleGender,
    cycleSizeForm,
    cycleFormVariant,
    cycleCosmeticForm,
    setCosmeticForm,
    setPoint,
    stepPoint,
    resetParty,
    loadSlots,
    loadSlot,
    reorderSlots,
  };
}
