import type { Party, SlotPreset } from "../types/party";
import { canonical, hashOf, planSync, type RemoteDoc } from "./cloudSyncPlan";
import { firebaseConfigured, loadAuth, loadFirestore } from "./firebase";
import {
  loadCloudSyncMeta,
  loadPartyPresets,
  loadSlotPresets,
  notifyPresetListReplaced,
  onPresetListSaved,
  saveCloudSyncMeta,
  savePartyPresets,
  saveSlotPresets,
  type PresetListName,
  type SyncBase,
} from "./storage";

/**
 * 저장한 파티·포켓몬 빌드의 클라우드 백업(6.0 K3). `localStorage`가 원본이고 클라우드는 복사본이다 — 로그인하지 않았거나 오프라인이어도
 * 앱은 지금처럼 동작한다. 목록마다 문서 하나(`users/{uid}/lists/{name}`: `{ json, updatedAt, version }`, firestore.rules와 같다).
 * 판정(올리기/받기/충돌)은 `cloudSyncPlan.ts`의 순수 함수가 한다.
 */
const NAMES: PresetListName[] = ["partyPresets", "slotPresets"];
/** 문서 1MB 한도 안의 여유. firestore.rules의 문자 수 상한(900000자)과 맞춘다 */
const MAX_BYTES = 900_000;
const SAVE_DELAY_MS = 3000;
const LABELS: Record<PresetListName, string> = { partyPresets: "저장된 파티", slotPresets: "저장한 포켓몬" };

interface Conflict {
  name: PresetListName;
  label: string;
  local: number;
  remote: number;
  remoteJson: string;
  remoteUpdatedAt: number;
}

interface SyncStatus {
  signedIn: boolean;
  syncing: boolean;
  error: string;
  notice: string;
  lastSyncedAt: number | null;
  /** 양쪽이 다 바뀌어 사용자가 고를 때까지 멈춰 있는 목록 */
  conflicts: Conflict[];
}

let status: SyncStatus = { signedIn: false, syncing: false, error: "", notice: "", lastSyncedAt: null, conflicts: [] };
const subscribers = new Set<() => void>();

export const getSyncStatus = () => status;
export function subscribeSyncStatus(fn: () => void) {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
}
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  subscribers.forEach((fn) => fn());
}

const read = (name: PresetListName): unknown[] => (name === "partyPresets" ? loadPartyPresets() : loadSlotPresets());
const write = (name: PresetListName, items: unknown[]) => {
  if (name === "partyPresets") savePartyPresets(items as Party[]);
  else saveSlotPresets(items as SlotPreset[]);
};
const localJson = (name: PresetListName) => canonical(name, read(name)).json;
const countOf = (json: string) => (JSON.parse(json) as unknown[]).length;

let uid: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let rerun = false;
/** 클라우드 내용을 로컬에 써 넣는 중 — 그 저장은 "내가 바꾼 것"이 아니므로 올리지 않는다 */
let applying = false;
let started = false;

function baseOf(name: PresetListName): SyncBase | null {
  return loadCloudSyncMeta().bases[uid ?? ""]?.[name] ?? null;
}
function setBase(name: PresetListName, base: SyncBase) {
  const meta = loadCloudSyncMeta();
  const key = uid ?? "";
  saveCloudSyncMeta({ ...meta, bases: { ...meta.bases, [key]: { ...meta.bases[key], [name]: base } } });
}
function stamp() {
  const t = Date.now();
  saveCloudSyncMeta({ ...loadCloudSyncMeta(), lastSyncedAt: t });
  setStatus({ lastSyncedAt: t });
}

function assertSize(json: string) {
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error("too-big");
}

function describe(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const message = (e as Error)?.message;
  if (message === "too-big") return "저장한 목록이 너무 커서(900KB 초과) 클라우드에 올리지 못했어요.";
  if (message === "bad-remote") return "클라우드의 데이터를 읽지 못했어요.";
  if (code === "permission-denied") return "클라우드에 접근할 수 없어요. 로그인을 다시 하거나 Firestore 보안 규칙이 게시됐는지 확인해 주세요.";
  if (code === "unavailable") return "클라우드에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.";
  return "동기화하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

async function docRef(name: PresetListName) {
  const { db, mod } = await loadFirestore();
  return { db, mod, ref: mod.doc(db, "users", uid ?? "", "lists", name) };
}

/** 클라우드 문서를 읽어 믿을 수 없는 입력으로 검증한 정규형으로 돌려준다. 없으면 null */
async function readRemote(name: PresetListName): Promise<RemoteDoc | null> {
  const { mod, ref } = await docRef(name);
  const snap = await mod.getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  if (typeof d.json !== "string" || typeof d.updatedAt !== "number") throw new Error("bad-remote");
  let parsed: unknown;
  try {
    parsed = JSON.parse(d.json);
  } catch {
    throw new Error("bad-remote");
  }
  if (!Array.isArray(parsed)) throw new Error("bad-remote");
  return { json: canonical(name, parsed).json, updatedAt: d.updatedAt };
}

/**
 * 클라우드에 쓴다. expected가 있으면 트랜잭션 안에서 "읽은 뒤로 클라우드가 안 바뀌었는지" 확인해, 다른 기기의 변경을 조용히
 * 덮어쓰지 않는다(바뀌었으면 null). expected가 undefined면 확인 없이 덮어쓴다(충돌에서 "이 기기 내용으로" 고른 경우).
 */
async function push(name: PresetListName, json: string, expected: number | null | undefined): Promise<number | null> {
  const { db, mod, ref } = await docRef(name);
  const updatedAt = Date.now();
  const ok = await mod.runTransaction(db, async (tx) => {
    if (expected !== undefined) {
      const snap = await tx.get(ref);
      if ((snap.exists() ? snap.data().updatedAt : null) !== expected) return false;
    }
    tx.set(ref, { json, updatedAt, version: 1 });
    return true;
  });
  return ok ? updatedAt : null;
}

/** 클라우드 내용을 로컬에 써 넣고, 켜져 있는 화면의 목록 상태도 다시 읽게 한다 */
function applyRemote(name: PresetListName, remote: RemoteDoc) {
  applying = true;
  try {
    write(name, JSON.parse(remote.json) as unknown[]);
  } finally {
    applying = false;
  }
  setBase(name, { hash: hashOf(remote.json), remoteUpdatedAt: remote.updatedAt });
  notifyPresetListReplaced(name);
}

async function syncList(name: PresetListName): Promise<Conflict | null> {
  const local = localJson(name);
  const remote = await readRemote(name);
  switch (planSync(local, remote, baseOf(name))) {
    case "adopt":
      setBase(name, { hash: hashOf(local), remoteUpdatedAt: remote?.updatedAt ?? 0 });
      return null;
    case "pull":
      applyRemote(name, remote as RemoteDoc);
      setStatus({ notice: "클라우드의 변경을 반영했어요." });
      return null;
    case "push": {
      assertSize(local);
      const at = await push(name, local, remote ? remote.updatedAt : null);
      if (at === null) rerun = true; // 그 사이 클라우드가 바뀌었다 — 처음부터 다시 판정한다
      else setBase(name, { hash: hashOf(local), remoteUpdatedAt: at });
      return null;
    }
    case "conflict": {
      const r = remote as RemoteDoc;
      return { name, label: LABELS[name], local: countOf(local), remote: countOf(r.json), remoteJson: r.json, remoteUpdatedAt: r.updatedAt };
    }
    default:
      return null;
  }
}

async function run() {
  if (!uid) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setStatus({ syncing: true, error: "", notice: "" });
  try {
    // ponytail: 두 기기가 동시에 올리면 다시 판정하는 것을 3번까지만 한다. 그래도 계속 어긋나면 다음 동기화 때 이어간다.
    for (let attempt = 0; attempt < 3; attempt++) {
      rerun = false;
      const conflicts: Conflict[] = [];
      for (const name of NAMES) {
        const c = await syncList(name);
        if (c) conflicts.push(c);
      }
      setStatus({ conflicts });
      if (!rerun) break;
    }
    if (!status.conflicts.length) stamp();
  } catch (e) {
    setStatus({ error: describe(e) });
  } finally {
    running = false;
    setStatus({ syncing: false });
  }
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(run, ms);
}

/** 로그인 직후·"지금 동기화"·앱 시작에서 바로 한 번 맞춘다 */
export const syncNow = () => schedule(0);

/** 사용자가 목록을 바꿨을 때 — 마지막으로 맞춘 내용과 같으면(화면을 열 때의 재저장 등) 네트워크를 쓰지 않는다 */
function onSaved(name: PresetListName) {
  if (!uid || applying || status.conflicts.length) return;
  const base = baseOf(name);
  if (base && hashOf(localJson(name)) === base.hash) return;
  schedule(SAVE_DELAY_MS);
}

/** 충돌에서 사용자가 고른 쪽으로 맞춘다. "later"는 그대로 두고 다음 동기화 때 다시 묻는다 */
export async function resolveConflicts(choice: "cloud" | "local" | "later") {
  const { conflicts } = status;
  if (choice === "later" || !conflicts.length) return setStatus({ conflicts: [] });
  setStatus({ syncing: true, error: "", notice: "" });
  try {
    for (const c of conflicts) {
      if (choice === "cloud") {
        applyRemote(c.name, { json: c.remoteJson, updatedAt: c.remoteUpdatedAt });
      } else {
        const json = localJson(c.name);
        assertSize(json);
        const at = await push(c.name, json, undefined);
        setBase(c.name, { hash: hashOf(json), remoteUpdatedAt: at ?? 0 });
      }
    }
    setStatus({ conflicts: [] });
    stamp();
  } catch (e) {
    setStatus({ error: describe(e) });
  } finally {
    setStatus({ syncing: false });
  }
}

/**
 * 로그인 상태를 지켜보다가 로그인되면 동기화를 시작한다(여러 번 불러도 한 번만). 로그인하지 않은 사용자는 부를 일이 없다 —
 * 앱 시작에서는 지난번에 로그인했던 기록이 있을 때만, 백업 모달에서는 열 때 부른다.
 */
export function startCloudSync() {
  if (!firebaseConfigured || started) return;
  started = true;
  onPresetListSaved(onSaved);
  loadAuth()
    .then(({ auth, mod }) =>
      mod.onAuthStateChanged(auth, (user) => {
        uid = user?.uid ?? null;
        clearTimeout(timer);
        saveCloudSyncMeta({ ...loadCloudSyncMeta(), lastUid: uid });
        setStatus({ signedIn: !!uid, lastSyncedAt: uid ? loadCloudSyncMeta().lastSyncedAt : null, conflicts: [], error: "", notice: "" });
        if (uid) syncNow();
      }),
    )
    .catch(() => {
      started = false; // 오프라인 등 — 다음에 다시 시도한다
    });
}
