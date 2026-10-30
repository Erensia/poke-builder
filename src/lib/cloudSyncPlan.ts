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

/** 목록의 항목 id → 항목 해시. 본문을 들고 있지 않아도 다음 동기화 때 "바뀐 항목"·"지워진 항목"을 알 수 있다(6.2 C4) */
export function itemHashes(json: string): Record<string, string> {
  return Object.fromEntries((JSON.parse(json) as { id: string }[]).map((i) => [i.id, hashOf(JSON.stringify(i))]));
}

/**
 * 양쪽이 다 바뀐 목록을 항목 단위로 합친다(6.2 C4). base는 마지막으로 맞춘 목록의 `itemHashes`(없으면 null — 처음 연결 등).
 * 기준에 있던 항목이 한쪽에 없으면 그쪽이 지운 것이고, 기준과 해시가 다르면 그쪽이 바꾼 것이다.
 *  - 한쪽에만 있다: 새로 추가했거나 상대가 지운 것. 추가했거나 바꿨으면 남기고, 안 바꾼 채 상대가 지웠으면 같이 지운다(수정 vs 삭제는 수정을 남긴다).
 *  - 양쪽에 있고 다르다: 한쪽만 바꿨으면 그쪽, 둘 다 바꿨으면(이름 변경끼리) 이 기기 것.
 * 기준이 없으면 지운 것을 알 수 없어 합집합이 된다(잃는 것은 없다). 결과는 최근 저장 순으로 정렬한 정규형 JSON.
 */
export function mergeLists(name: PresetListName, localJson: string, remoteJson: string, base: Record<string, string> | null): string {
  type Item = { id: string; savedAt: number };
  const L = JSON.parse(localJson) as Item[];
  const R = JSON.parse(remoteJson) as Item[];
  const hash = (i: Item) => hashOf(JSON.stringify(i));
  /** 이 쪽 항목이 기준에서 새로 생겼거나 바뀌었는지 */
  const edited = (i: Item) => base?.[i.id] === undefined || hash(i) !== base[i.id];
  const remoteById = new Map(R.map((r) => [r.id, r]));
  const localIds = new Set(L.map((l) => l.id));
  const items = [
    ...L.flatMap((l) => {
      const r = remoteById.get(l.id);
      if (!r) return edited(l) ? [l] : [];
      return [hash(l) !== hash(r) && !edited(l) ? r : l];
    }),
    ...R.filter((r) => !localIds.has(r.id) && edited(r)),
  ].sort((a, b) => b.savedAt - a.savedAt);
  return canonical(name, items).json;
}

type Plan ="none" | "adopt" | "push" | "pull" | "conflict";

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
