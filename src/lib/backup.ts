import type { Party, PartySlots, SlotPreset } from "../types/party";
import { cleanSlot } from "./mySamples";

/**
 * 저장 데이터 백업/복원(5.5 G1) — 저장한 파티(party-presets)와 저장한 포켓몬 빌드(slot-presets)를 JSON 한 파일로 옮긴다.
 * 파일은 믿을 수 없는 입력이라 슬롯은 내 샘플 가져오기와 같은 검증(`cleanSlot`)을 거치고, id는 받은 값을 믿지 않고 새로 매긴다.
 */
const EXPORT_KIND = "champions-backup";
/** 가져오기 파일 크기 상한 — localStorage 한도(약 5MB) 안에서 만들어진 백업은 받는다 */
export const MAX_BACKUP_BYTES = 5_000_000;

export function exportBackup(partyPresets: Party[], slotPresets: SlotPreset[]): string {
  return JSON.stringify({ kind: EXPORT_KIND, version: 1, partyPresets, slotPresets });
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cleanSavedAt = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** 파티는 빈 슬롯(null)을 허용한다. 6칸이 아니거나 채워진 칸 하나라도 틀리면 null(그 파티는 건너뜀) */
function cleanParty(raw: unknown): PartySlots | null {
  if (!Array.isArray(raw) || raw.length !== 6) return null;
  const slots = raw.map((s) => (s === null ? null : cleanSlot(s)));
  return slots.every((s, i) => s !== null || raw[i] === null) ? (slots as PartySlots) : null;
}

/**
 * 목록 하나를 검증해 쓸 수 있는 항목만 돌려준다(이름이 비었거나 슬롯이 틀린 항목은 건너뛰고 skipped로 센다).
 * 백업 가져오기는 id를 새로 매기지만(keepIds=false), 클라우드 동기화(6.0 K3)는 같은 항목을 알아봐야 하므로 받은 id와
 * savedAt을 그대로 둔다(keepIds=true — savedAt이 틀리면 매번 달라지지 않게 현재 시각 대신 0).
 */
const idOf = (r: Record<string, unknown>, keepIds: boolean) => (keepIds && typeof r.id === "string" && r.id ? r.id : crypto.randomUUID());
const asRecord = (raw: unknown) => (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

export function cleanPartyPresets(raw: unknown[], keepIds = false): { items: Party[]; skipped: number } {
  const items: Party[] = [];
  for (const x of raw) {
    const r = asRecord(x);
    const slots = cleanParty(r.slots);
    const name = cleanName(r.name);
    if (slots && name) items.push({ id: idOf(r, keepIds), name, slots, savedAt: cleanSavedAt(r.savedAt, keepIds ? 0 : Date.now()) });
  }
  return { items, skipped: raw.length - items.length };
}

export function cleanSlotPresets(raw: unknown[], keepIds = false): { items: SlotPreset[]; skipped: number } {
  const items: SlotPreset[] = [];
  for (const x of raw) {
    const r = asRecord(x);
    const slot = cleanSlot(r.slot);
    const name = cleanName(r.name);
    if (slot && name) items.push({ id: idOf(r, keepIds), name, slot, savedAt: cleanSavedAt(r.savedAt, keepIds ? 0 : Date.now()) });
  }
  return { items, skipped: raw.length - items.length };
}

/** 백업 파일 내용을 읽어 쓸 수 있는 항목만 돌려준다. 파일 형식이 아니면 null. 건너뛴 항목 수는 skipped */
export function parseBackup(text: string): { partyPresets: Party[]; slotPresets: SlotPreset[]; skipped: number } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const file = data as { kind?: unknown; partyPresets?: unknown; slotPresets?: unknown };
  if (!file || file.kind !== EXPORT_KIND || !Array.isArray(file.partyPresets) || !Array.isArray(file.slotPresets)) return null;
  const parties = cleanPartyPresets(file.partyPresets);
  const slots = cleanSlotPresets(file.slotPresets);
  return { partyPresets: parties.items, slotPresets: slots.items, skipped: parties.skipped + slots.skipped };
}
