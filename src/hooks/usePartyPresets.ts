import { useEffect, useState } from "react";
import type { Party } from "../types/party";
import type { PartySlots } from "./useParty";
import { loadPartyPresets, savePartyPresets } from "../lib/storage";

/**
 * 이름 붙인 파티 프리셋 목록 관리(Phase 6 §1-2). useParty의 "현재 작업 중인 파티"(자동저장 1개)와
 * 완전히 별개 축 — 여러 개를 만들어두고 나중에 이름으로 골라서 불러올 수 있다.
 */
export function usePartyPresets() {
  const [presets, setPresets] = useState<Party[]>(() => loadPartyPresets());

  useEffect(() => {
    savePartyPresets(presets);
  }, [presets]);

  /** 현재 파티를 새 프리셋으로 저장한다. 이름이 비어있으면 저장하지 않는다 */
  function savePreset(name: string, slots: PartySlots) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset: Party = {
      id: crypto.randomUUID(),
      name: trimmed,
      slots,
      savedAt: Date.now(),
    };
    setPresets((prev) => [preset, ...prev]);
  }

  function renamePreset(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }

  function deletePreset(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  return { presets, savePreset, renamePreset, deletePreset };
}
