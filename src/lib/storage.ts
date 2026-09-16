import type { Party, PartySlots, SlotPreset } from "../types/party";
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

/**
 * localStorage에 JSON 하나를 저장/로드하는 공용 팩토리(ver.1.5 §10). party/partyPresets/
 * slotPresets/battleVideos 4쌍이 저장키만 다르고 try/catch 로드·세이브 보일러플레이트가
 * 완전히 동일했던 것을 통합 — 로드 시 `guard`로 형태를 검증해 손상됐거나 없으면 `fallback`을
 * 돌려주고, localStorage 접근 자체가 막힌 환경(프라이빗 모드 등)에서도 조용히 무시한다.
 */
function createLocalStorageStore<T>(key: string, guard: (value: unknown) => value is T, fallback: T) {
  function load(): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return guard(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function save(value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage가 막혀있는 환경(프라이빗 모드 등)에서는 조용히 무시한다.
    }
  }

  function clear(): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  return { load, save, clear };
}

function isPartySlots(value: unknown): value is PartySlots {
  return Array.isArray(value) && value.length === 6;
}

const partyStore = createLocalStorageStore<PartySlots | null>(STORAGE_KEY, isPartySlots, null);

export function loadParty(): PartySlots | null {
  return partyStore.load();
}

export function saveParty(slots: PartySlots): void {
  partyStore.save(slots);
}

export function clearSavedParty(): void {
  partyStore.clear();
}

function isPartyPresetList(value: unknown): value is Party[] {
  return Array.isArray(value);
}

const partyPresetsStore = createLocalStorageStore<Party[]>(PARTY_PRESETS_STORAGE_KEY, isPartyPresetList, []);

/** 이름 붙인 파티 프리셋 목록을 불러온다. 저장된 적 없거나 손상됐으면 빈 배열 */
export function loadPartyPresets(): Party[] {
  return partyPresetsStore.load();
}

export function savePartyPresets(presets: Party[]): void {
  partyPresetsStore.save(presets);
}

function isSlotPresetList(value: unknown): value is SlotPreset[] {
  return Array.isArray(value);
}

const slotPresetsStore = createLocalStorageStore<SlotPreset[]>(SLOT_PRESETS_STORAGE_KEY, isSlotPresetList, []);

/** 이름 붙인 포켓몬 빌드(슬롯 1개) 목록을 불러온다. 저장된 적 없거나 손상됐으면 빈 배열 */
export function loadSlotPresets(): SlotPreset[] {
  return slotPresetsStore.load();
}

export function saveSlotPresets(presets: SlotPreset[]): void {
  slotPresetsStore.save(presets);
}

function isBattleVideoList(value: unknown): value is BattleVideo[] {
  return Array.isArray(value);
}

const battleVideosStore = createLocalStorageStore<BattleVideo[]>(
  BATTLE_VIDEOS_STORAGE_KEY,
  isBattleVideoList,
  [],
);

/** 저장된 배틀비디오 목록을 불러온다. 저장된 적 없거나 손상됐으면 빈 배열 */
export function loadBattleVideos(): BattleVideo[] {
  return battleVideosStore.load();
}

export function saveBattleVideos(videos: BattleVideo[]): void {
  battleVideosStore.save(videos);
}
