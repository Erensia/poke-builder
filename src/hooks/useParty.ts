import { useEffect, useState } from "react";
import type { AbilityPoints, PartySlot, PartySlots } from "../types/party";
import { loadParty, saveParty, clearSavedParty } from "../lib/storage";
import {
  applyItemToSlot,
  cycleFormOnSlot,
  emptyPartySlot,
  setAbilityPointOnSlot,
  setMoveOnSlot,
  stepAbilityPointOnSlot,
  swapMovesOnSlot,
  toggleGenderOnSlot,
} from "../lib/slotMutations";

const EMPTY_SLOTS: PartySlots = [null, null, null, null, null, null];

export function useParty() {
  const [slots, setSlots] = useState<PartySlots>(() => loadParty() ?? EMPTY_SLOTS);
  // 프리셋을 불러온 횟수 — 카드가 "같은 포켓몬이 다시 들어와도" 불러왔음을 모션으로 보이게 하는 신호(8.1 U7)
  const [loadCount, setLoadCount] = useState(0);

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
    setLoadCount((n) => n + 1);
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
      next[index] = emptyPartySlot(pokemonId);
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

  /** 한 슬롯을 fn으로 고친다. 빈 슬롯이거나 fn이 같은 슬롯을 돌려주면(변화 없음) 상태를 그대로 둔다 */
  function updateSlot(index: number, fn: (slot: PartySlot) => PartySlot) {
    setSlots((prev) => {
      const slot = prev[index];
      if (!slot) return prev;
      const nextSlot = fn(slot);
      if (nextSlot === slot) return prev;
      const next = [...prev] as PartySlots;
      next[index] = nextSlot;
      return next;
    });
  }

  function setMove(slotIndex: number, moveIndex: 0 | 1 | 2 | 3, moveId: string | null) {
    updateSlot(slotIndex, (slot) => setMoveOnSlot(slot, moveIndex, moveId));
  }

  /** 한 슬롯 안에서 기술 두 칸의 자리를 맞바꾼다(빈 칸과도 가능) — 길게 눌러 끌기·드래그 */
  function swapMoves(slotIndex: number, a: number, b: number) {
    if (a === b) return;
    updateSlot(slotIndex, (slot) => swapMovesOnSlot(slot, a, b));
  }

  function setAbility(slotIndex: number, abilityId: string | null) {
    updateSlot(slotIndex, (slot) => ({ ...slot, ability: abilityId }));
  }

  function setItem(slotIndex: number, itemId: string | null) {
    updateSlot(slotIndex, (slot) => applyItemToSlot(slot, itemId));
  }

  function setNature(slotIndex: number, natureId: string | null) {
    updateSlot(slotIndex, (slot) => ({ ...slot, nature: natureId }));
  }

  /** 수컷/암컷을 바로 뒤집는다(에써르류는 성별 = 폼 — 자세한 규칙은 toggleGenderOnSlot) */
  function toggleGender(slotIndex: number) {
    updateSlot(slotIndex, toggleGenderOnSlot);
  }

  /** 펌킨인 계열 크기 변종을 다음 크기로 돌린다(sizeForms 순서 순환, 끝에서 처음으로) */
  function cycleSizeForm(slotIndex: number) {
    updateSlot(slotIndex, (slot) => cycleFormOnSlot(slot, "sizeForm"));
  }

  /** 루가루암 계열 폼 변종을 다음 폼으로 돌린다. 폼별로 특성 목록이 달라 특성 선택은 초기화한다 */
  function cycleFormVariant(slotIndex: number) {
    updateSlot(slotIndex, (slot) => cycleFormOnSlot(slot, "formVariant"));
  }

  /** 마휘핑 계열 겉모습을 다음 모습으로 돌린다(cosmeticForms 순서 순환). 이미지에만 영향 — 특성/스탯 불변 */
  function cycleCosmeticForm(slotIndex: number) {
    updateSlot(slotIndex, (slot) => cycleFormOnSlot(slot, "cosmeticForm"));
  }

  /** 마휘핑 계열 겉모습을 리스트에서 고른 id로 바로 설정한다(옵션이 5개 이상이라 순환이 불편한 종용) */
  function setCosmeticForm(slotIndex: number, formId: string) {
    updateSlot(slotIndex, (slot) => ({ ...slot, cosmeticForm: formId }));
  }

  /** 합산 66 / 스탯당 32를 넘지 않도록 클램프해서 능력 포인트 한 스탯을 절대값으로 설정한다 (직접 입력용) */
  function setPoint(slotIndex: number, stat: keyof AbilityPoints, value: number) {
    updateSlot(slotIndex, (slot) => setAbilityPointOnSlot(slot, stat, value));
  }

  /** 이전 상태를 기준으로 증감시킨다 (버튼용) — 빠르게 연속 클릭해도 각 클릭이 누락되지 않는다 */
  function stepPoint(slotIndex: number, stat: keyof AbilityPoints, delta: number) {
    updateSlot(slotIndex, (slot) => stepAbilityPointOnSlot(slot, stat, delta));
  }

  return {
    slots,
    setPokemon,
    clearSlot,
    setMove,
    swapMoves,
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
    loadCount,
    loadSlot,
    reorderSlots,
  };
}
