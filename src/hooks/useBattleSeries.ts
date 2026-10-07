import { useState } from "react";
import { SAMPLE_PARTIES } from "../lib/data";
import { beginMatch, finishMatch, settleAbandoned, shuffleOpponents, type FrontierSave } from "../lib/battleSeries";
import { loadBattleFrontier, saveBattleFrontier } from "../lib/storage";
import type { SamplePartyPreset } from "../types/party";

/**
 * 배틀 프런티어(2.5 L4, 전 연속 대전 2.2 B2) — 내 파티·선출은 그대로 두고 상대만 샘플 파티를 무작위 순서로 이어 간다.
 * 연승·최대 연승·샘플별 누적 전적은 localStorage에 저장하고(`save`), 켜져 있는지와 상대 대기열(`queue`)은 세션 상태다.
 * 앱을 열 때 "판은 시작됐는데 결과가 없는" 표시가 남아 있으면 이탈(= 패배)로 정산한다.
 */
export function useBattleSeries() {
  const [save, setSave] = useState<FrontierSave>(() => {
    const loaded = loadBattleFrontier();
    const settled = settleAbandoned(loaded);
    if (settled !== loaded) saveBattleFrontier(settled);
    return settled;
  });
  /** 남은 상대 대기열(맨 앞 = 지금 상대). null이면 프런티어가 꺼진 상태. 새로고침하면 사라지고 다시 섞는다 */
  const [queue, setQueue] = useState<SamplePartyPreset[] | null>(null);

  const current = queue?.[0] ?? null;

  function update(next: FrontierSave) {
    setSave(next);
    saveBattleFrontier(next);
  }

  /** 프런티어를 켜고 첫 상대를 돌려준다. 연승은 이어진다 */
  function start(): SamplePartyPreset {
    const order = shuffleOpponents(SAMPLE_PARTIES);
    setQueue(order);
    return order[0];
  }

  /** 대전이 실제로 시작될 때 부른다 — 결과 전에 끊기면 이탈로 정산되도록 표시를 남긴다 */
  function begin() {
    if (current) update(beginMatch(save, current.id));
  }

  /** 지금 상대와의 한 판 결과(무승부는 패배). 한 바퀴를 다 돌면 다시 섞는다 */
  function record(winner: "a" | "b" | "draw") {
    if (!current || !queue) return;
    update(finishMatch(save, current.id, winner === "a"));
    setQueue(queue.length > 1 ? queue.slice(1) : shuffleOpponents(SAMPLE_PARTIES));
  }

  function stop() {
    setQueue(null);
  }

  return { save, active: queue !== null, current, start, begin, record, stop };
}
