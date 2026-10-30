import type { Party, PartySlots, SamplePartyPreset, SlotPreset } from "../types/party";
import type { BattleVideo } from "../types/battleVideo";
import { EMPTY_FRONTIER, isFrontierSave, type FrontierSave } from "./battleSeries";
import { EMPTY_RANK_SAVE, isRankSave, type RankSave } from "./battleRankSave";
import { emptyOpponentMemory, isOpponentMemory, type OpponentMemory } from "./battle/ai/opponentMemory";

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
/** 랭크배틀(5.0 R1) 배틀비디오 — 배틀타워 목록(위 키)과 별도로 보관한다 */
const RANK_BATTLE_VIDEOS_STORAGE_KEY = "champions-party-sim.battle-videos-rank.v1";
/**
 * 배틀타워 AI의 사용자 패턴 학습(ver.2.0 1-C) — 파티 자동저장(STORAGE_KEY)과 별도 키. 집계 통계만(최대 약 25KB), 학습 켬/끔 설정 포함.
 */
const AI_MEMORY_STORAGE_KEY = "champions-party-sim.ai-memory.v1";
/** 랭크배틀(5.0 R3)의 AI 학습 — 배틀타워 학습(위 키)과 따로 쌓는다 */
const RANK_AI_MEMORY_STORAGE_KEY = "champions-party-sim.ai-memory-rank.v1";
/** 내 샘플 파티(3.1 S2 스파이크) — 기본 제공 샘플(마스터 데이터)과 별개로 사용자가 저장한 샘플. 다른 저장 키와 겹치지 않는 별도 키 */
const MY_SAMPLES_STORAGE_KEY = "champions-party-sim.my-samples.v1";
/** 배틀 프런티어(2.5 L4) 연승·전적 — 파티 자동저장(STORAGE_KEY)·프리셋 키와 별도 키 */
const BATTLE_FRONTIER_STORAGE_KEY = "champions-party-sim.battle-frontier.v1";
/** 랭크배틀(5.0 R1 ⓑ) 랭크·이력·시즌 기록 — 프런티어·파티 자동저장 키와 별도 키 */
const BATTLE_RANK_STORAGE_KEY = "champions-party-sim.battle-rank.v1";

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
  presetSavedListeners.forEach((fn) => fn("partyPresets"));
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
  presetSavedListeners.forEach((fn) => fn("slotPresets"));
}

/**
 * 저장한 파티·포켓몬 빌드 목록의 변화를 클라우드 동기화(6.0 K3)에 알린다. 저장 직후 호출되는 쪽(Saved)과, 동기화가 클라우드 내용을
 * 로컬에 써 넣어 화면의 목록 상태를 다시 읽게 하는 쪽(Replaced) 둘이다. 목록 상태는 훅마다 따로 들고 있어서 `localStorage`만
 * 바꾸면 켜져 있는 화면이 옛 상태로 되돌려 쓴다.
 */
export type PresetListName = "partyPresets" | "slotPresets";
const presetSavedListeners = new Set<(name: PresetListName) => void>();
const presetReplacedListeners = new Set<(name: PresetListName) => void>();

export function onPresetListSaved(fn: (name: PresetListName) => void): () => void {
  presetSavedListeners.add(fn);
  return () => void presetSavedListeners.delete(fn);
}

export function onPresetListReplaced(fn: (name: PresetListName) => void): () => void {
  presetReplacedListeners.add(fn);
  return () => void presetReplacedListeners.delete(fn);
}

export function notifyPresetListReplaced(name: PresetListName): void {
  presetReplacedListeners.forEach((fn) => fn(name));
}

/** 클라우드 동기화 기록(6.0 K3) — 마지막 로그인 uid와 목록별 "마지막으로 맞춘 시점"(uid마다). 로그인 여부를 앱 시작 때 싸게 알아내는 데도 쓴다 */
export interface SyncBase {
  /** 마지막으로 맞춘 목록의 해시 */
  hash: string;
  /** 그때 클라우드 문서의 updatedAt */
  remoteUpdatedAt: number;
  /** 그때 목록의 항목 id → 항목 해시(6.2 C4). 항목 단위 병합에서 바뀐 항목·지워진 항목을 알아내는 기준. 6.1까지의 기록에는 없다 */
  items?: Record<string, string>;
}
interface CloudSyncMeta {
  lastUid: string | null;
  lastSyncedAt: number | null;
  bases: Record<string, Partial<Record<PresetListName, SyncBase>>>;
}
const CLOUD_SYNC_STORAGE_KEY = "champions-party-sim.cloud-sync.v1";

function isCloudSyncMeta(value: unknown): value is CloudSyncMeta {
  const v = value as CloudSyncMeta | null;
  return !!v && typeof v === "object" && typeof v.bases === "object" && v.bases !== null;
}

const cloudSyncStore = createLocalStorageStore<CloudSyncMeta>(CLOUD_SYNC_STORAGE_KEY, isCloudSyncMeta, {
  lastUid: null,
  lastSyncedAt: null,
  bases: {},
});

export function loadCloudSyncMeta(): CloudSyncMeta {
  return cloudSyncStore.load();
}

export function saveCloudSyncMeta(meta: CloudSyncMeta): void {
  cloudSyncStore.save(meta);
}

function isBattleVideoList(value: unknown): value is BattleVideo[] {
  return Array.isArray(value);
}

const battleVideoStores = {
  free: createLocalStorageStore<BattleVideo[]>(BATTLE_VIDEOS_STORAGE_KEY, isBattleVideoList, []),
  rank: createLocalStorageStore<BattleVideo[]>(RANK_BATTLE_VIDEOS_STORAGE_KEY, isBattleVideoList, []),
};

/**
 * 배틀비디오 저장소(배틀타워 free·랭크배틀 rank가 따로). `load`는 저장된 적 없거나 손상됐으면 빈 배열을 돌려준다.
 * load·save는 렌더마다 바뀌지 않는 참조라 useStoredList에 그대로 넘길 수 있다.
 */
export function battleVideoStore(mode: "free" | "rank") {
  return battleVideoStores[mode];
}

/** 저장 형태: 학습 기록 + "대전에서 계속 학습" 스위치 */
export interface StoredAiMemory {
  version: 1;
  learningEnabled: boolean;
  memory: OpponentMemory;
}

function isStoredAiMemory(value: unknown): value is StoredAiMemory {
  const v = value as StoredAiMemory;
  return !!v && typeof v === "object" && v.version === 1 && typeof v.learningEnabled === "boolean" && isOpponentMemory(v.memory);
}

const aiMemoryStoreOf = (key: string) =>
  createLocalStorageStore<StoredAiMemory>(key, isStoredAiMemory, { version: 1, learningEnabled: true, memory: emptyOpponentMemory() });
const aiMemoryStores = { free: aiMemoryStoreOf(AI_MEMORY_STORAGE_KEY), rank: aiMemoryStoreOf(RANK_AI_MEMORY_STORAGE_KEY) };

/** AI 학습 기록을 불러온다(mode별 따로 보관). 없거나 손상됐으면 빈 기록(학습 켬) */
export function loadAiMemory(mode: "free" | "rank"): StoredAiMemory {
  return aiMemoryStores[mode].load();
}

export function saveAiMemory(mode: "free" | "rank", value: StoredAiMemory): void {
  aiMemoryStores[mode].save(value);
}

/** 학습 초기화 — 그 모드의 키만 지운다(파티 자동저장·다른 모드 학습은 건드리지 않는다) */
export function clearAiMemory(mode: "free" | "rank"): void {
  aiMemoryStores[mode].clear();
}

const battleFrontierStore = createLocalStorageStore<FrontierSave>(BATTLE_FRONTIER_STORAGE_KEY, isFrontierSave, EMPTY_FRONTIER);

/** 배틀 프런티어 저장본을 불러온다. 없거나 손상됐으면 빈 기록 */
export function loadBattleFrontier(): FrontierSave {
  // 2.5 저장본에는 queue가 없어서 기본값으로 채운다
  return { ...EMPTY_FRONTIER, ...battleFrontierStore.load() };
}

export function saveBattleFrontier(save: FrontierSave): void {
  battleFrontierStore.save(save);
}

const battleRankStore = createLocalStorageStore<RankSave>(BATTLE_RANK_STORAGE_KEY, isRankSave, EMPTY_RANK_SAVE);

/** 랭크배틀 저장본을 불러온다. 없거나 손상됐으면 빈 기록 */
export function loadBattleRank(): RankSave {
  return battleRankStore.load();
}

export function saveBattleRank(save: RankSave): void {
  battleRankStore.save(save);
}

const mySamplesStore = createLocalStorageStore<SamplePartyPreset[]>(MY_SAMPLES_STORAGE_KEY, (v): v is SamplePartyPreset[] => Array.isArray(v), []);

/** 사용자가 저장한 샘플 파티 목록. 없거나 손상됐으면 빈 배열 */
export function loadMySamples(): SamplePartyPreset[] {
  return mySamplesStore.load();
}

export function saveMySamples(samples: SamplePartyPreset[]): void {
  mySamplesStore.save(samples);
}

/** 매치업 화면 자동저장(3.2 V2) — 새로고침해도 역산 관측이 안 날아가게. 파티·프리셋 키와 겹치지 않는 별도 키 */
const MATCHUP_STORAGE_KEY = "champions-party-sim.matchup.v1";

/**
 * 저장 형태: 두 탭이 공유하는 슬롯·날씨·필드(useMatchup)와 역산 탭의 입력(inference — 형태·검증은 DefenseInferencePanel이 맡는다).
 * 쓰는 쪽이 둘이라 save는 일부만 받아 합쳐 쓴다.
 */
interface MatchupDraft {
  version: 1;
  attacker?: unknown;
  defender?: unknown;
  weather?: unknown;
  field?: unknown;
  trickRoom?: unknown;
  inference?: unknown;
}

const matchupStore = createLocalStorageStore<MatchupDraft>(
  MATCHUP_STORAGE_KEY,
  (v): v is MatchupDraft => !!v && typeof v === "object" && (v as MatchupDraft).version === 1,
  { version: 1 },
);

export function loadMatchupDraft(): MatchupDraft {
  return matchupStore.load();
}

export function saveMatchupDraft(patch: Partial<MatchupDraft>): void {
  matchupStore.save({ ...matchupStore.load(), ...patch, version: 1 });
}
