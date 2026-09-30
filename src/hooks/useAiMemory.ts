import { useState } from "react";
import { clearAiMemory, loadAiMemory, saveAiMemory, type StoredAiMemory } from "../lib/storage";
import { commitBattle, emptyOpponentMemory, type OpponentMemory } from "../lib/battle/ai/opponentMemory";

/**
 * 배틀타워 AI의 사용자 패턴 학습(ver.2.0 1-C) 저장본 관리. 대전 중 관측은 화면이 세션 기록에 모으고, 대전이 끝나면 commit으로 누적본에
 * 합쳐(× 0.99 감쇠) 저장한다. "대전에서 계속 학습"이 꺼져 있으면 commit이 아무것도 하지 않는다(쌓인 학습은 계속 쓴다).
 */
export function useAiMemory() {
  const [stored, setStored] = useState<StoredAiMemory>(() => loadAiMemory());

  function update(next: StoredAiMemory) {
    setStored(next);
    saveAiMemory(next);
  }

  /** 대전 한 판의 세션 기록을 누적본에 합친다. 합쳤으면 true(결과 배너 문구용) */
  function commit(session: OpponentMemory): boolean {
    if (!stored.learningEnabled || session.decisions <= 0) return false;
    update({ ...stored, memory: commitBattle(stored.memory, session) });
    return true;
  }

  function setLearningEnabled(learningEnabled: boolean) {
    update({ ...stored, learningEnabled });
  }

  function reset() {
    clearAiMemory();
    setStored({ version: 1, learningEnabled: stored.learningEnabled, memory: emptyOpponentMemory() });
    saveAiMemory({ version: 1, learningEnabled: stored.learningEnabled, memory: emptyOpponentMemory() });
  }

  return { memory: stored.memory, learningEnabled: stored.learningEnabled, commit, setLearningEnabled, reset };
}
