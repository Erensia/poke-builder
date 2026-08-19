import type { PartySlots } from "../hooks/useParty";

const STORAGE_KEY = "champions-party-sim.party.v1";

function isPartySlots(value: unknown): value is PartySlots {
  return Array.isArray(value) && value.length === 6;
}

export function loadParty(): PartySlots | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isPartySlots(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveParty(slots: PartySlots): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // localStorage가 막혀있는 환경(프라이빗 모드 등)에서는 조용히 무시한다.
  }
}

export function clearSavedParty(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
