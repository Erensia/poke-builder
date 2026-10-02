import type { SamplePartyPreset } from "../types/party";

/** 연속 대전(2.2 B2) 한 판의 결과 — 내 편(a) 기준 */
export interface SeriesResult {
  sampleId: string;
  winner: "a" | "b" | "draw";
}

export interface SeriesSummary {
  wins: number;
  losses: number;
  draws: number;
}

export function summarizeSeries(results: readonly SeriesResult[]): SeriesSummary {
  const wins = results.filter((r) => r.winner === "a").length;
  const losses = results.filter((r) => r.winner === "b").length;
  return { wins, losses, draws: results.length - wins - losses };
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
