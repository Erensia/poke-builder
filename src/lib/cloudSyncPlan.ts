import { cleanPartyPresets, cleanSlotPresets } from "./backup";
import { applyRankResult, rankOf, type RankResult, type RankState } from "./battleRank";
import { EMPTY_RANK_SAVE, HISTORY_LIMIT, isRankSave, type RankHistoryEntry, type RankSave } from "./battleRankSave";
import { EMPTY_FRONTIER, isFrontierSave } from "./battleSeries";
import { cleanMySamples } from "./mySamples";
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

/** 목록이 아니라 통째로 하나인 문서(랭크·프런티어 기록, 6.2 C5) — 항목 단위로 합칠 수 없어 충돌하면 사용자가 고른다 */
export const isObjectDoc = (name: PresetListName) => name === "battleRank" || name === "battleFrontier";

/**
 * 진행 중인 판(pendingId)은 동기화하지 않는다 — 받은 쪽 앱이 열릴 때 이탈 패배로 정산해 버린다. 그래서 정규형에서는 항상 null이다.
 * 키 순서는 클라우드에 저장되는 문자열과 같아야 하니 바꾸지 않는다. 틀린 모양이면 던진다(bad-remote).
 * ponytail: history·seasons 안쪽은 앱이 만든 값을 그대로 믿는다 — 같은 계정만 쓸 수 있는 문서라서. 안쪽이 깨지면 그때 검증을 넣는다.
 */
function objectDoc(name: PresetListName, raw: unknown): string {
  if (name === "battleRank") {
    if (!isRankSave(raw)) throw new Error("bad-remote");
    const { state: s, history, seasons, seasonStartedAt, lastParty } = raw;
    const state = { gauge: s.gauge, wins: s.wins, losses: s.losses, streak: s.streak, lossStreak: s.lossStreak, rating: s.rating, maxRating: s.maxRating, champion: s.champion };
    return JSON.stringify({ state, history, seasons, pendingId: null, seasonStartedAt, lastParty });
  }
  if (!isFrontierSave(raw) || !Object.values(raw.samples).every((r) => Number.isInteger(r?.wins) && Number.isInteger(r?.losses))) throw new Error("bad-remote");
  return JSON.stringify({ streak: raw.streak, best: raw.best, samples: raw.samples, pendingId: null, queue: raw.queue ?? [], includeMine: raw.includeMine ?? false });
}

export function canonical(name: PresetListName, raw: unknown): { json: string; items: unknown[] } {
  if (isObjectDoc(name)) return { json: objectDoc(name, raw), items: [] };
  const list = raw as unknown[];
  const { items } =
    name === "partyPresets" ? cleanPartyPresets(list, true) : name === "slotPresets" ? cleanSlotPresets(list, true) : cleanMySamples(list);
  return { json: JSON.stringify(items), items };
}

/** 같은 판인지 보는 열쇠 — 시각(ms)이 있어 서로 다른 판이 겹치지 않는다 */
const gameKey = (e: RankHistoryEntry) => `${e.at}|${e.opponentId}|${e.result}`;
const stateKey = (s: RankState) => JSON.stringify([s.gauge, s.wins, s.losses, s.streak, s.lossStreak, s.rating, s.maxRating, s.champion]);
const resultOf = (e: RankHistoryEntry): RankResult => (e.result === "win" ? { won: true, turns: e.turns ?? 0 } : { won: false });

/**
 * 기준(base) 이후 한 쪽이 치른 판을 오래된 순으로. 기준에서 그 판들만 이어 붙여 지금 상태가 재현되지 않으면(시즌 초기화 등 다른 변화가 낌)
 * 이어졌다고 믿을 수 없어 null. 기록 상한(50판)까지 전부 새 판이면 더 있었는데 잘렸을 수 있어 null.
 */
function gamesSince(base: RankSave, side: RankSave): RankHistoryEntry[] | null {
  const had = new Set(base.history.map(gameKey));
  const fresh = side.history.filter((e) => !had.has(gameKey(e))).reverse();
  if (fresh.length >= HISTORY_LIMIT) return null;
  const replayed = fresh.reduce((s, e) => applyRankResult(s, resultOf(e)).state, base.state);
  return stateKey(replayed) === stateKey(side.state) ? fresh : null;
}

/**
 * 두 기기에서 따로 플레이한 랭크 기록을 합친다(6.2 C6). 마지막으로 맞춘 저장본(baseJson)의 상태에서 시작해, 양쪽의 그 이후 판을 시각 순으로
 * `applyRankResult`로 다시 계산한다 — 레이팅·게이지·연승이 한 기기에서 순서대로 한 것처럼 정확히 재현된다(계산이 이전 상태와 승패·턴 수만 쓴다).
 * 합칠 수 없으면 null이고, 그때는 사용자가 고른다: 기준이 없거나 / 시즌 기록이 달라졌거나(사이에 시즌이 끝남) / 한쪽 상태가 판 기록만으로 재현되지 않거나 / 한쪽이 상한 50판을 넘겼을 때.
 */
export function mergeRank(baseJson: string | null, localJson: string, remoteJson: string): string | null {
  if (!baseJson) return null;
  const B = JSON.parse(baseJson) as RankSave;
  const L = JSON.parse(localJson) as RankSave;
  const R = JSON.parse(remoteJson) as RankSave;
  const seasons = JSON.stringify(B.seasons);
  if (JSON.stringify(L.seasons) !== seasons || JSON.stringify(R.seasons) !== seasons) return null;
  const gl = gamesSince(B, L);
  const gr = gamesSince(B, R);
  if (!gl || !gr) return null;
  const seen = new Set<string>();
  const games = [...gl, ...gr].filter((g) => !seen.has(gameKey(g)) && seen.add(gameKey(g))).sort((a, b) => a.at - b.at);
  let state = B.state;
  const fresh: RankHistoryEntry[] = [];
  for (const g of games) {
    const r = applyRankResult(state, resultOf(g));
    state = r.state;
    fresh.unshift({ at: g.at, opponentId: g.opponentId, result: g.result, turns: g.turns, change: r.change, after: rankOf(state), rating: state.rating });
  }
  const newest = (g: RankHistoryEntry[]) => g[g.length - 1]?.at ?? -1;
  const starts = [B, L, R].flatMap((s) => (s.seasonStartedAt === null ? [] : [s.seasonStartedAt]));
  const merged: RankSave = {
    state,
    history: [...fresh, ...B.history].slice(0, HISTORY_LIMIT),
    seasons: B.seasons,
    pendingId: null,
    seasonStartedAt: starts.length ? Math.min(...starts) : null,
    lastParty: (newest(gr) > newest(gl) ? R : L).lastParty,
  };
  return canonical("battleRank", merged).json;
}

/** "아직 아무것도 안 한" 문서의 정규형 — 목록은 "[]", 랭크·프런티어는 기록이 없는 저장본 */
export const emptyJson = (name: PresetListName) =>
  isObjectDoc(name) ? canonical(name, name === "battleRank" ? EMPTY_RANK_SAVE : EMPTY_FRONTIER).json : "[]";

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
  type Item = { id: string; savedAt?: number }; // 내 샘플에는 savedAt이 없다 — 그 목록은 정렬하지 않고 이 기기 순서 뒤에 상대 것을 붙인다
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
  ].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  return canonical(name, items).json;
}

type Plan ="none" | "adopt" | "push" | "pull" | "conflict";

/**
 * local: 지금 로컬 목록(정규형), remote: 클라우드 문서(없으면 null), base: 마지막으로 맞춘 시점(처음이면 null), empty: 빈 문서의 정규형.
 * 한쪽만 바뀌었으면 잃을 것이 없어 자동으로 옮기고(push/pull), 양쪽이 다 바뀌었거나 처음 연결인데 서로 다르면 conflict.
 */
export function planSync(local: string, remote: RemoteDoc | null, base: SyncBase | null, empty = "[]"): Plan {
  const isEmpty = (json: string) => json === empty;
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
