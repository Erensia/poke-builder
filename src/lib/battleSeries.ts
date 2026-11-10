/** 샘플 파티 하나에 대한 누적 전적 */
interface SampleRecord {
  wins: number;
  losses: number;
}

/** 끝난 판 하나(8.2 I2) — 두 기기의 기록을 합칠 때 시각 순으로 연승을 다시 계산하는 데 쓴다 */
export interface FrontierGame {
  at: number;
  opponentId: string;
  won: boolean;
}

/** 판 기록 상한 — 랭크 이력(HISTORY_LIMIT)과 같다. 기준 이후 새 판이 이 수 이상이면 잘렸을 수 있어 재생하지 않는다 */
export const FRONTIER_GAMES_LIMIT = 50;

/**
 * 배틀 프런티어(2.5 L4, 전 연속 대전 2.2 B2) 저장본 — localStorage에 통째로 저장한다.
 * pendingId는 "판이 시작됐지만 결과가 아직 없는" 상대 샘플 id. 창을 닫거나 새로고침하면 결과가 안 남으니,
 * 다음에 앱이 열릴 때 이게 남아 있으면 이탈(= 패배)로 정산한다(settleAbandoned).
 */
export interface FrontierSave {
  streak: number;
  best: number;
  samples: Record<string, SampleRecord>;
  pendingId: string | null;
  /** 아직 안 만난 상대 샘플 id 순서(맨 앞 = 다음 상대). 새로고침해도 같은 순서로 이어 간다(3.0 L4-a) */
  queue: string[];
  /** 내 샘플(3.1 S2)도 상대 풀에 넣는지 — 기본 끔(켜면 풀이 사용자마다 달라져 기록의 의미가 바뀐다) */
  includeMine: boolean;
  /** 최근 판 기록(최신이 앞, 8.2 I2). 8.1 이전 저장본에는 없다 */
  games?: FrontierGame[];
  /** pendingId 판을 시작한 시각 — 이탈 정산이 앱을 다시 연 시각이 아니라 이 시각을 판 시각으로 쓴다 */
  pendingAt?: number | null;
}

export const EMPTY_FRONTIER: FrontierSave = { streak: 0, best: 0, samples: {}, pendingId: null, queue: [], includeMine: false, games: [], pendingAt: null };

const isGame = (g: unknown): g is FrontierGame => {
  const v = g as FrontierGame;
  return !!v && Number.isFinite(v.at) && typeof v.opponentId === "string" && typeof v.won === "boolean";
};

export function isFrontierSave(value: unknown): value is FrontierSave {
  const v = value as FrontierSave;
  return (
    !!v &&
    typeof v === "object" &&
    Number.isInteger(v.streak) &&
    Number.isInteger(v.best) &&
    typeof v.samples === "object" &&
    v.samples !== null &&
    (v.pendingId === null || typeof v.pendingId === "string") &&
    // 2.5 저장본에는 queue가 없다 — 없으면 허용하고 불러올 때 빈 배열로 채운다
    (v.queue === undefined || (Array.isArray(v.queue) && v.queue.every((id) => typeof id === "string"))) &&
    (v.includeMine === undefined || typeof v.includeMine === "boolean") &&
    (v.games === undefined || (Array.isArray(v.games) && v.games.every(isGame))) &&
    (v.pendingAt === undefined || v.pendingAt === null || Number.isFinite(v.pendingAt))
  );
}

/** 판 시작 — 결과가 나오기 전에 끊기면 이탈로 정산할 수 있게 상대를 표시해 둔다 */
export function beginMatch(save: FrontierSave, sampleId: string, now = Date.now()): FrontierSave {
  return { ...save, pendingId: sampleId, pendingAt: now };
}

/** 한 판 결과 반영. 이기면 연승 +1(최대 갱신), 지면 연승 0. 표시는 지우고 만난 상대는 대기열에서 뺀다 */
export function finishMatch(save: FrontierSave, sampleId: string, won: boolean, now = Date.now()): FrontierSave {
  const prev = save.samples[sampleId] ?? { wins: 0, losses: 0 };
  const streak = won ? save.streak + 1 : 0;
  return {
    streak,
    best: Math.max(save.best, streak),
    samples: { ...save.samples, [sampleId]: won ? { ...prev, wins: prev.wins + 1 } : { ...prev, losses: prev.losses + 1 } },
    pendingId: null,
    queue: save.queue[0] === sampleId ? save.queue.slice(1) : save.queue,
    includeMine: save.includeMine,
    games: [{ at: now, opponentId: sampleId, won }, ...(save.games ?? [])].slice(0, FRONTIER_GAMES_LIMIT),
    pendingAt: null,
  };
}

/** 앱을 열 때 진행 중 표시가 남아 있으면 그 판을 패배로 정산한다. 없으면 그대로 */
export function settleAbandoned(save: FrontierSave): FrontierSave {
  return save.pendingId === null ? save : finishMatch(save, save.pendingId, false, save.pendingAt ?? undefined);
}

/** 배열을 무작위 순서로 섞은 사본(원본은 건드리지 않는다) */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** 저장된 대기열에서 없는 샘플 id를 걸러내고, 비었으면 샘플 전부를 다시 섞어 채운다(한 바퀴를 다 돌면 다시 섞는다) */
export function refillQueue(save: FrontierSave, sampleIds: readonly string[], random: () => number = Math.random): FrontierSave {
  const known = new Set(sampleIds);
  const queue = save.queue.filter((id) => known.has(id));
  if (queue.length > 0) return queue.length === save.queue.length ? save : { ...save, queue };
  return { ...save, queue: shuffled(sampleIds, random) };
}
