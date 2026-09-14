import { useEffect, useState } from "react";
import type { BattleVideo } from "../types/battleVideo";
import { loadBattleVideos, saveBattleVideos } from "../lib/storage";
import type { FighterKey, TurnResult } from "../lib/battleSimulator";

/** 배틀비디오 최대 보관 개수(§6) — 4번째가 생기면 가장 오래된 것부터 삭제(FIFO). */
const MAX_BATTLE_VIDEOS = 3;

/**
 * 배틀타워 대전이 끝날 때마다 그 시점의 배틀 로그를 저장하는 "배틀비디오" 목록 관리(§6).
 * usePartyPresets·useSlotPresets와 같은 패턴 — 로컬 상태를 저장소와 동기화만 하고, 목록
 * 관리(최근 3개 FIFO)는 이 훅이 담당한다.
 */
export function useBattleVideos() {
  const [videos, setVideos] = useState<BattleVideo[]>(() => loadBattleVideos());

  useEffect(() => {
    saveBattleVideos(videos);
  }, [videos]);

  /** 대전 종료 시점의 로그를 새 배틀비디오로 저장한다. 최신이 맨 앞, 3개를 넘으면 가장 오래된 것부터 버려진다 */
  function addVideo(params: { labelA: string; labelB: string; winner: FighterKey | "draw"; log: TurnResult[] }) {
    const video: BattleVideo = {
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      ...params,
    };
    setVideos((prev) => [video, ...prev].slice(0, MAX_BATTLE_VIDEOS));
  }

  function deleteVideo(id: string) {
    setVideos((prev) => prev.filter((v) => v.id !== id));
  }

  return { videos, addVideo, deleteVideo };
}
