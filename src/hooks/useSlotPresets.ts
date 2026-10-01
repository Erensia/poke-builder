import type { PartySlot, SlotPreset } from "../types/party";
import { loadSlotPresets, saveSlotPresets } from "../lib/storage";
import { useNamedList } from "./useStoredList";

/**
 * 이름 붙인 포켓몬 빌드(슬롯 1개) 목록 관리(Phase 6 §1-3). 파티 프리셋(usePartyPresets)과는
 * 저장 단위가 달라 별개 목록 — 같은 조합("이 라이츄는 항상 이 기술/노력치")을 여러 파티에서
 * 재사용할 때 쓴다.
 */
export function useSlotPresets() {
  const { savePreset, ...rest } = useNamedList<SlotPreset>(loadSlotPresets, saveSlotPresets);
  return { ...rest, savePreset: (name: string, slot: PartySlot) => savePreset(name, { slot }) };
}
