import type { PartySlots } from "../hooks/useParty";
import type { Party, SlotPreset } from "../types/party";
import type { BattleVideo } from "../types/battleVideo";

const STORAGE_KEY = "champions-party-sim.party.v1";
/** 이름 붙인 파티 프리셋 목록(Phase 6 §1-2) — 위 STORAGE_KEY(현재 작업 중인 파티 자동저장)와 별개 */
const PARTY_PRESETS_STORAGE_KEY = "champions-party-sim.party-presets.v1";
/** 이름 붙인 포켓몬 빌드(슬롯 1개) 목록(Phase 6 §1-3) */
const SLOT_PRESETS_STORAGE_KEY = "champions-party-sim.slot-presets.v1";
/**
 * 배틀비디오 목록(§6) — 위 STORAGE_KEY(파티 자동저장)와 절대 겹치지 않는 별도 키. 최근 3개만
 * 유지하는 FIFO 로직은 useBattleVideos 훅에서 처리하고, 여기는 단순 로드/저장만 담당한다.
 */
const BATTLE_VIDEOS_STORAGE_KEY = "champions-party-sim.battle-videos.v1";

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

function isPartyPresetList(value: unknown): value is Party[] {
  return Array.isArray(value);
}

/** 이름 붙인 파티 프리셋 목록을 불러온다. 저장된 적 없거나 손상됐으면 빈 배열 */
export function loadPartyPresets(): Party[] {
  try {
    const raw = localStorage.getItem(PARTY_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return isPartyPresetList(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePartyPresets(presets: Party[]): void {
  try {
    localStorage.setItem(PARTY_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

function isSlotPresetList(value: unknown): value is SlotPreset[] {
  return Array.isArray(value);
}

/** 이름 붙인 포켓몬 빌드(슬롯 1개) 목록을 불러온다. 저장된 적 없거나 손상됐으면 빈 배열 */
export function loadSlotPresets(): SlotPreset[] {
  try {
    const raw = localStorage.getItem(SLOT_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return isSlotPresetList(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSlotPresets(presets: SlotPreset[]): void {
  try {
    localStorage.setItem(SLOT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

function isBattleVideoList(value: unknown): value is BattleVideo[] {
  return Array.isArray(value);
}

/** 저장된 배틀비디오 목록을 불러온다. 저장된 적 없거나 손상됐으면 빈 배열 */
export function loadBattleVideos(): BattleVideo[] {
  try {
    const raw = localStorage.getItem(BATTLE_VIDEOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return isBattleVideoList(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBattleVideos(videos: BattleVideo[]): void {
  try {
    localStorage.setItem(BATTLE_VIDEOS_STORAGE_KEY, JSON.stringify(videos));
  } catch {
    // ignore
  }
}
