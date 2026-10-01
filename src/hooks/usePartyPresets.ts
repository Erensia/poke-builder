import type { Party, PartySlots } from "../types/party";
import { loadPartyPresets, savePartyPresets } from "../lib/storage";
import { useNamedList } from "./useStoredList";

/**
 * 이름 붙인 파티 프리셋 목록 관리(Phase 6 §1-2). useParty의 "현재 작업 중인 파티"(자동저장 1개)와
 * 완전히 별개 축 — 여러 개를 만들어두고 나중에 이름으로 골라서 불러올 수 있다.
 */
export function usePartyPresets() {
  const { savePreset, ...rest } = useNamedList<Party>(loadPartyPresets, savePartyPresets);
  return { ...rest, savePreset: (name: string, slots: PartySlots) => savePreset(name, { slots }) };
}
