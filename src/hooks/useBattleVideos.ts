import type { BattleVideo } from "../types/battleVideo";
import { loadBattleVideos, loadRankBattleVideos, saveBattleVideos, saveRankBattleVideos } from "../lib/storage";
import type { FighterKey, TurnResult } from "../types/battle";
import { useStoredList } from "./useStoredList";

/** 배틀비디오 최대 보관 개수(§6) — 넘으면 가장 오래된 것부터 삭제(FIFO). 배틀타워 3개, 랭크배틀 5개. */
const MAX_BATTLE_VIDEOS = { free: 3, rank: 5 } as const;

/**
 * 대전이 끝날 때마다 그 시점의 배틀 로그를 저장하는 "배틀비디오" 목록 관리(§6). 배틀타워·랭크배틀(mode)은 각자 목록을 따로 보관한다.
 * usePartyPresets·useSlotPresets와 상태+저장 배선(useStoredList)은 공유하지만, FIFO 개수
 * 캡이라는 실제 동작 차이가 있어 `addVideo`는 공용 `prependItem`을 쓰지 않고 이 훅에서 직접
 * `setItems`로 캡을 구현한다(억지 통합 안 함).
 */
export function useBattleVideos(mode: "free" | "rank") {
  const rank = mode === "rank";
  const { items: videos, setItems: setVideos, removeItem: deleteVideo } = useStoredList<BattleVideo>(
    rank ? loadRankBattleVideos : loadBattleVideos,
    rank ? saveRankBattleVideos : saveBattleVideos,
  );

  /** 대전 종료 시점의 로그를 새 배틀비디오로 저장한다. 최신이 맨 앞, 상한을 넘으면 가장 오래된 것부터 버려진다 */
  function addVideo(params: { labelA: string; labelB: string; winner: FighterKey | "draw"; log: TurnResult[] }) {
    const video: BattleVideo = {
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      ...params,
    };
    setVideos((prev) => [video, ...prev].slice(0, MAX_BATTLE_VIDEOS[mode]));
  }

  return { videos, addVideo, deleteVideo };
}
