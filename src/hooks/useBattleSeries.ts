import { useState } from "react";
import { SAMPLE_PARTIES } from "../lib/data";
import { beginMatch, EMPTY_FRONTIER, finishMatch, refillQueue, settleAbandoned, type FrontierSave } from "../lib/battleSeries";
import { isUsableSample } from "../lib/mySamples";
import { loadBattleFrontier, saveBattleFrontier } from "../lib/storage";
import type { SamplePartyPreset } from "../types/party";

/**
 * 배틀 프런티어(2.5 L4, 전 연속 대전 2.2 B2) — 내 파티·선출은 그대로 두고 상대만 샘플 파티를 무작위 순서로 이어 간다.
 * 연승·최대 연승·샘플별 누적 전적·남은 상대 순서(대기열)는 localStorage에 저장하고(`save`), 켜져 있는지(`active`)는 세션 상태다.
 * 앱을 열 때 "판은 시작됐는데 결과가 없는" 표시가 남아 있으면 이탈(= 패배)로 정산한다.
 * `mySamples`(3.1 S2)는 사용자가 저장한 샘플 — 옵션(`save.includeMine`)을 켰을 때만 상대 풀에 들어가고, 쓸 수 없게 된 샘플은 거른다.
 */
export function useBattleSeries(mySamples: SamplePartyPreset[]) {
  const [save, setSave] = useState<FrontierSave>(() => {
    const loaded = loadBattleFrontier();
    const settled = settleAbandoned(loaded);
    if (settled !== loaded) saveBattleFrontier(settled);
    return settled;
  });
  const [active, setActive] = useState(false);

  /** 상대 풀: 기본 샘플 + (옵션이 켜져 있으면) 쓸 수 있는 내 샘플 */
  const pool = save.includeMine ? [...SAMPLE_PARTIES, ...mySamples.filter(isUsableSample)] : SAMPLE_PARTIES;
  const poolIds = pool.map((p) => p.id);
  /** 승패 요약에 보여 줄 전체 목록(내 샘플은 옵션과 무관하게 기록이 있으면 보인다) */
  const catalog = [...SAMPLE_PARTIES, ...mySamples];
  const usableMine = mySamples.filter(isUsableSample).length;

  // ponytail: 켜진 동안 내 샘플을 지우면 대기열 맨 앞이 바뀔 수 있다 — 이미 불러온 상대 진영과 어긋나면 "다음 상대"에서 맞춰진다
  /** 지금 상대 = 대기열 맨 앞(켜져 있을 때만) */
  const current: SamplePartyPreset | null = active ? (pool.find((p) => p.id === refillQueue(save, poolIds).queue[0]) ?? null) : null;

  function update(next: FrontierSave) {
    setSave(next);
    saveBattleFrontier(next);
  }

  /** 프런티어를 켜고 첫 상대를 돌려준다. 연승과 남은 상대 순서는 이어진다 */
  function start(): SamplePartyPreset {
    const next = refillQueue(save, poolIds);
    if (next !== save) update(next);
    setActive(true);
    return pool.find((p) => p.id === next.queue[0])!;
  }

  /** 대전이 실제로 시작될 때 부른다 — 결과 전에 끊기면 이탈로 정산되도록 표시를 남긴다 */
  function begin() {
    if (current) update(beginMatch(save, current.id));
  }

  /** 지금 상대와의 한 판 결과(무승부는 패배). 대기열이 비면(한 바퀴 완주) 다시 섞는다 */
  function record(winner: "a" | "b" | "draw") {
    if (current) update(refillQueue(finishMatch(save, current.id, winner === "a"), poolIds));
  }

  function stop() {
    setActive(false);
  }

  /** 연승·전적·대기열을 모두 지운다(상대 풀 옵션은 유지). 켜져 있는 동안은 부르지 않는다(이탈=패배 우회 방지) */
  function reset() {
    if (!active) update({ ...EMPTY_FRONTIER, includeMine: save.includeMine });
  }

  /** 내 샘플을 상대 풀에 넣을지. 풀이 바뀌므로 남은 대기열은 비워 다음 시작 때 다시 섞는다 */
  function setIncludeMine(includeMine: boolean) {
    if (!active) update({ ...save, includeMine, queue: [] });
  }

  return { save, active, current, pool, catalog, usableMine, start, begin, record, stop, reset, setIncludeMine };
}
