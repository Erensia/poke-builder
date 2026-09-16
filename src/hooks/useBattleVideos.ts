import type { BattleVideo } from "../types/battleVideo";
import { loadBattleVideos, saveBattleVideos } from "../lib/storage";
import type { FighterKey, TurnResult } from "../lib/battleSimulator";
import { useStoredList } from "./useStoredList";

/** 배틀비디오 최대 보관 개수(§6) — 4번째가 생기면 가장 오래된 것부터 삭제(FIFO). */
const MAX_BATTLE_VIDEOS = 3;

/**
 * 배틀타워 대전이 끝날 때마다 그 시점의 배틀 로그를 저장하는 "배틀비디오" 목록 관리(§6).
 * usePartyPresets·useSlotPresets와 상태+저장 배선(useStoredList)은 공유하지만, FIFO 3개
 * 캡이라는 실제 동작 차이가 있어 `addVideo`는 공용 `prependItem`을 쓰지 않고 이 훅에서 직접
 * `setItems`로 캡을 구현한다(억지 통합 안 함).
 */
export function useBattleVideos() {
  const { items: videos, setItems: setVideos, removeItem: deleteVideo } =
    useStoredList<BattleVideo>(loadBattleVideos, saveBattleVideos);

  /** 대전 종료 시점의 로그를 새 배틀비디오로 저장한다. 최신이 맨 앞, 3개를 넘으면 가장 오래된 것부터 버려진다 */
  function addVideo(params: { labelA: string; labelB: string; winner: FighterKey | "draw"; log: TurnResult[] }) {
    const video: BattleVideo = {
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      ...params,
    };
    setVideos((prev) => [video, ...prev].slice(0, MAX_BATTLE_VIDEOS));
  }

  return { videos, addVideo, deleteVideo };
}
