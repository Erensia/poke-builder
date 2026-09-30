/// <reference lib="webworker" />
/**
 * 배틀 AI Web Worker(ver.2.0 2-B): 탐색 오라클은 판단 한 번에 수백 ms가 걸려, 화면과 같은 스레드에서 돌리면 그동안 화면이 멈춘다.
 * 여기서 chooseAiAction을 돌리고 행동만 돌려준다. 배틀 state는 순수 데이터라 구조화 복제로 그대로 넘어오고, 기술은 id로 돌려준다
 * (받는 쪽이 자기 데이터의 같은 기술로 다시 잇는다 — aiClient.ts).
 */
import { chooseAiAction } from "./index";
import { serializeDistribution, type AiWorkerRequest, type AiWorkerResponse } from "./aiClient";

// 로드 완료 알림 — 첫 판단 전에 워커를 미리 띄워 두면(prewarmAiWorker) 받는 쪽이 이때부터 짧은 제한 시간을 쓴다
self.postMessage({ ready: true });

self.onmessage = (event: MessageEvent<AiWorkerRequest>) => {
  const { id, state, key, riskAversion, legalMoveIds, decisionParams, opponentMemory } = event.data;
  let response: AiWorkerResponse;
  try {
    const { action, opponentDistribution } = chooseAiAction(state, key, riskAversion, { legalMoveIds, decisionParams, opponentMemory });
    const dist = opponentDistribution && serializeDistribution(opponentDistribution);
    response =
      action.kind === "switch"
        ? { id, action: { kind: "switch", toIndex: action.toIndex }, dist }
        : { id, action: { kind: "move", moveId: action.move.id, mega: action.mega }, dist };
  } catch (error) {
    response = { id, error: String(error) };
  }
  self.postMessage(response);
};
