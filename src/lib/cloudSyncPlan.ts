import { cleanPartyPresets, cleanSlotPresets } from "./backup";
import type { PresetListName, SyncBase } from "./storage";

/**
 * 클라우드 동기화(6.0 K3)의 판정 — 네트워크·저장소 없이 문자열만 보는 순수 함수라 `npm run test:sync`로 검증한다.
 * 목록은 항상 "정규형 JSON"으로 비교한다(검증을 거쳐 키 순서를 고정한 문자열). 같은 내용인데 키 순서만 달라 다르게 보이는 일을 막는다.
 */
export interface RemoteDoc {
  /** 정규형 JSON */
  json: string;
  updatedAt: number;
}

export function canonical(name: PresetListName, raw: unknown[]): { json: string; items: unknown[] } {
  const { items } = name === "partyPresets" ? cleanPartyPresets(raw, true) : cleanSlotPresets(raw, true);
  return { json: JSON.stringify(items), items };
}

/**
 * 32비트 FNV-1a + 길이. 마지막으로 맞춘 목록과 지금 목록이 같은지 보는 용도라 암호학적 해시는 필요 없다.
 * ponytail: 충돌하면 바뀐 목록을 안 바뀐 것으로 보고 올리지 않는다 — 가능성이 무시할 만하고, 다음 변경 때 올라간다.
 */
export function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${s.length}`;
}

type Plan = "none" | "adopt" | "push" | "pull" | "conflict";

const isEmpty = (json: string) => json === "[]";

/**
 * local: 지금 로컬 목록(정규형), remote: 클라우드 문서(없으면 null), base: 마지막으로 맞춘 시점(처음이면 null).
 * 한쪽만 바뀌었으면 잃을 것이 없어 자동으로 옮기고(push/pull), 양쪽이 다 바뀌었거나 처음 연결인데 서로 다르면 conflict.
 */
export function planSync(local: string, remote: RemoteDoc | null, base: SyncBase | null): Plan {
  if (!remote) return isEmpty(local) ? "none" : "push";
  if (local === remote.json) return "adopt";
  if (!base) {
    if (isEmpty(local)) return "pull";
    if (isEmpty(remote.json)) return "push";
    return "conflict";
  }
  const localChanged = hashOf(local) !== base.hash;
  const remoteChanged = remote.updatedAt !== base.remoteUpdatedAt;
  if (!localChanged && !remoteChanged) return "none";
  if (!localChanged) return "pull";
  if (!remoteChanged) return "push";
  return "conflict";
}
