import { useEffect, useState } from "react";
import { clearAiMemory, loadAiMemory, onPresetListReplaced, saveAiMemory, type StoredAiMemory } from "../lib/storage";
import { commitBattle, emptyOpponentMemory, MEMORY_DECAY_PER_BATTLE, RANK_MEMORY_DECAY_PER_BATTLE, type OpponentMemory } from "../lib/battle/ai/opponentMemory";

/**
 * AI의 사용자 패턴 학습(ver.2.0 1-C) 저장본 관리. 배틀타워(free)와 랭크배틀(rank)은 각자 저장본을 따로 쌓고, 감쇠도 다르다(0.99 / 0.995).
 * 대전 중 관측은 화면이 세션 기록에 모으고, 대전이 끝나면 commit으로 누적본에 합쳐(감쇠) 저장한다. "대전에서 계속 학습"이 꺼져 있으면 commit이 아무것도 하지 않는다(쌓인 학습은 계속 쓴다).
 */
export function useAiMemory(mode: "free" | "rank") {
  const decay = mode === "rank" ? RANK_MEMORY_DECAY_PER_BATTLE : MEMORY_DECAY_PER_BATTLE;
  const [stored, setStored] = useState<StoredAiMemory>(() => loadAiMemory(mode));
  // 클라우드 동기화(6.3 A1)가 다른 기기의 학습 기록을 받아 `localStorage`에 썼으면 다시 읽는다(안 읽으면 옛 기록으로 되돌려 쓴다)
  useEffect(() => onPresetListReplaced((name) => name === (mode === "rank" ? "aiMemoryRank" : "aiMemory") && setStored(loadAiMemory(mode))), [mode]);

  function update(next: StoredAiMemory) {
    setStored(next);
    saveAiMemory(mode, next);
  }

  /** 대전 한 판의 세션 기록을 누적본에 합친다. 합쳤으면 true(결과 배너 문구용) */
  function commit(session: OpponentMemory): boolean {
    if (!stored.learningEnabled || session.decisions <= 0) return false;
    update({ ...stored, memory: commitBattle(stored.memory, session, decay) });
    return true;
  }

  function setLearningEnabled(learningEnabled: boolean) {
    update({ ...stored, learningEnabled });
  }

  function reset() {
    clearAiMemory(mode);
    setStored({ version: 1, learningEnabled: stored.learningEnabled, memory: emptyOpponentMemory() });
    saveAiMemory(mode, { version: 1, learningEnabled: stored.learningEnabled, memory: emptyOpponentMemory() });
  }

  return { memory: stored.memory, recentBattles: Math.round(1 / (1 - decay)), learningEnabled: stored.learningEnabled, commit, setLearningEnabled, reset };
}
