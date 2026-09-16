import type { PartySlot, SlotPreset } from "../types/party";
import { loadSlotPresets, saveSlotPresets } from "../lib/storage";
import { useStoredList } from "./useStoredList";

/**
 * 이름 붙인 포켓몬 빌드(슬롯 1개) 목록 관리(Phase 6 §1-3). 파티 프리셋(usePartyPresets)과는
 * 저장 단위가 달라 별개 목록 — 같은 조합("이 라이츄는 항상 이 기술/노력치")을 여러 파티에서
 * 재사용할 때 쓴다.
 */
export function useSlotPresets() {
  const { items: presets, prependItem, removeItem: deletePreset, setItems: setPresets } =
    useStoredList<SlotPreset>(loadSlotPresets, saveSlotPresets);

  /** 슬롯 하나를 새 빌드 프리셋으로 저장한다. 이름이 비어있으면 저장하지 않는다 */
  function savePreset(name: string, slot: PartySlot) {
    const trimmed = name.trim();
    if (!trimmed) return;
    prependItem({
      id: crypto.randomUUID(),
      name: trimmed,
      slot,
      savedAt: Date.now(),
    });
  }

  function renamePreset(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }

  return { presets, savePreset, renamePreset, deletePreset };
}
