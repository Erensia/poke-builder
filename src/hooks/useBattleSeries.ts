import { useState } from "react";
import { SAMPLE_PARTIES } from "../lib/data";
import { shuffleOpponents, type SeriesResult } from "../lib/battleSeries";
import type { SamplePartyPreset } from "../types/party";

interface SeriesState {
  order: SamplePartyPreset[];
  results: SeriesResult[];
  /** 중단했거나 한 바퀴를 다 돈 뒤 요약만 보여 주는 상태 */
  finished: boolean;
}

/**
 * 연속 대전(2.2 B2) — 내 파티는 그대로 두고 상대만 기본 제공 샘플 파티를 무작위 순서로 한 바퀴 돌린다.
 * 한 판이 끝나면 record로 결과를 쌓고, 다음 상대는 current(= 아직 안 치른 첫 상대)로 읽는다. 저장되지 않는 세션 상태다(새로고침하면 사라짐).
 */
export function useBattleSeries() {
  const [state, setState] = useState<SeriesState | null>(null);

  const current = state && !state.finished ? (state.order[state.results.length] ?? null) : null;

  function start(): SamplePartyPreset {
    const order = shuffleOpponents(SAMPLE_PARTIES);
    setState({ order, results: [], finished: false });
    return order[0];
  }

  /** 지금 상대와의 한 판 결과를 기록한다. 마지막 상대였으면 요약 상태로 넘어간다 */
  function record(winner: SeriesResult["winner"]) {
    setState((prev) => {
      if (!prev || prev.finished) return prev;
      const results = [...prev.results, { sampleId: prev.order[prev.results.length].id, winner }];
      return { ...prev, results, finished: results.length >= prev.order.length };
    });
  }

  function stop() {
    setState((prev) => (prev ? { ...prev, finished: true } : prev));
  }

  function close() {
    setState(null);
  }

  return { state, current, start, record, stop, close };
}
