import type { SamplePartyPreset } from "../types/party";

/** 샘플 파티 하나에 대한 누적 전적 */
export interface SampleRecord {
  wins: number;
  losses: number;
}

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
}

export const EMPTY_FRONTIER: FrontierSave = { streak: 0, best: 0, samples: {}, pendingId: null };

export function isFrontierSave(value: unknown): value is FrontierSave {
  const v = value as FrontierSave;
  return (
    !!v &&
    typeof v === "object" &&
    Number.isInteger(v.streak) &&
    Number.isInteger(v.best) &&
    typeof v.samples === "object" &&
    v.samples !== null &&
    (v.pendingId === null || typeof v.pendingId === "string")
  );
}

/** 판 시작 — 결과가 나오기 전에 끊기면 이탈로 정산할 수 있게 상대를 표시해 둔다 */
export function beginMatch(save: FrontierSave, sampleId: string): FrontierSave {
  return { ...save, pendingId: sampleId };
}

/** 한 판 결과 반영. 이기면 연승 +1(최대 갱신), 지면 연승 0. 표시는 지운다 */
export function finishMatch(save: FrontierSave, sampleId: string, won: boolean): FrontierSave {
  const prev = save.samples[sampleId] ?? { wins: 0, losses: 0 };
  const streak = won ? save.streak + 1 : 0;
  return {
    streak,
    best: Math.max(save.best, streak),
    samples: { ...save.samples, [sampleId]: won ? { ...prev, wins: prev.wins + 1 } : { ...prev, losses: prev.losses + 1 } },
    pendingId: null,
  };
}

/** 앱을 열 때 진행 중 표시가 남아 있으면 그 판을 패배로 정산한다. 없으면 그대로 */
export function settleAbandoned(save: FrontierSave): FrontierSave {
  return save.pendingId === null ? save : finishMatch(save, save.pendingId, false);
}

/** 샘플 파티를 무작위 순서로 한 바퀴 돌 대진표로 만든다(원본 배열은 건드리지 않는다) */
export function shuffleOpponents(samples: readonly SamplePartyPreset[], random: () => number = Math.random): SamplePartyPreset[] {
  const order = [...samples];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
