import { type FighterKey, type TurnAction } from "@/types/battle";
import { getMove } from "@/lib/data";
import { STRUGGLE_MOVE, type BattleState } from "../state";
import { chooseAiAction } from "./index";
import { DEFAULT_OPPONENT_MODEL, type DecisionParams } from "./decision";
import type { LevelOneDistribution } from "./levelOne";
import type { OpponentMemory } from "./opponentMemory";
import { PRODUCT_SEARCH_PARAMS } from "./search";

/**
 * 배틀타워 AI 호출(ver.2.0 2-B): 탐색 오라클(2-A 채택 설정)을 Web Worker에서 돌린다. 화면은 그동안 멈추지 않는다.
 * 안전장치: 제한 시간(기본 2초) 안에 답이 없거나 Worker를 못 쓰면 지금 AI(평가식 — 수십 ms)로 이 스레드에서 바로 고른다.
 */

/**
 * 앱 기본 AI 설정: 탐색 오라클 켬(2-C — decision-layer §17-1) + 상대 모델 ver2(1-B)를 사용자 패턴 학습(1-C)과 함께 켬. 학습 기록이 없으면
 * 교체 확률을 사전값 0.15배로만 믿어 교체 읽기가 거의 안 켜진다(2.0-backlog 1-C 결과).
 */
export const APP_DECISION_PARAMS: Partial<DecisionParams> = { search: PRODUCT_SEARCH_PARAMS, opponentModel: DEFAULT_OPPONENT_MODEL };

export interface AiWorkerRequest {
  id: number;
  state: BattleState;
  key: FighterKey;
  riskAversion: number;
  legalMoveIds?: string[];
  decisionParams?: Partial<DecisionParams>;
  /** 1-C: 누적본 + 이번 대전 세션 학습 기록 */
  opponentMemory?: OpponentMemory;
}

/** Worker ↔ 화면 사이 분포 전달용(Map은 배열로) */
export interface SerializedDistribution {
  moveWeights: [string, number][];
  switchProb: number;
  switches: { toIndex: number; weight: number }[];
  megaOf: [string, boolean | undefined][];
}

export function serializeDistribution(d: LevelOneDistribution): SerializedDistribution {
  return { moveWeights: [...d.moveWeights], switchProb: d.switchProb, switches: d.switches, megaOf: [...d.megaOf] };
}

export function deserializeDistribution(d: SerializedDistribution): LevelOneDistribution {
  return { moveWeights: new Map(d.moveWeights), switchProb: d.switchProb, switches: d.switches, megaOf: new Map(d.megaOf) };
}

/** AI 행동 + (상대 모델이 켜져 있으면) 보정 전 상대 행동 예측 — 사용자 선택과 짝지어 학습 기록에 쓴다 */
export interface AiActionResult {
  action: TurnAction;
  opponentDistribution?: LevelOneDistribution;
}

export type AiWorkerAction = { kind: "move"; moveId: string; mega?: boolean } | { kind: "switch"; toIndex: number };
export type AiWorkerResponse = { id: number; action: AiWorkerAction; dist?: SerializedDistribution } | { id: number; error: string };

let worker: Worker | null | undefined;
/** 워커가 로드를 마쳤는지 — 그 전(데이터 포함 번들 다운로드·파싱)엔 제한 시간을 넉넉히 준다 */
let workerReady = false;
let nextId = 1;
const pending = new Map<number, (response: AiWorkerResponse | undefined) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<AiWorkerResponse | { ready: true }>) => {
      if ("ready" in event.data) {
        workerReady = true;
        return;
      }
      pending.get(event.data.id)?.(event.data);
      pending.delete(event.data.id);
    };
    // 워커 자체가 죽으면(로드 실패 등) 기다리던 요청을 모두 대체 경로로 보내고, 다음 요청 때 새로 만든다
    worker.onerror = () => resetWorker();
  } catch {
    worker = null;
  }
  return worker;
}

function resetWorker(): void {
  worker?.terminate();
  worker = undefined;
  workerReady = false;
  for (const resolve of pending.values()) resolve(undefined);
  pending.clear();
}

function toTurnAction(action: AiWorkerAction): TurnAction | undefined {
  if (action.kind === "switch") return { kind: "switch", toIndex: action.toIndex };
  const move = action.moveId === STRUGGLE_MOVE.id ? STRUGGLE_MOVE : getMove(action.moveId);
  return move ? { kind: "move", move, mega: action.mega } : undefined;
}

/** 대체 경로: 탐색 없이 지금 AI(평가식)로 이 스레드에서 고른다(상대 모델·학습 보정은 그대로 — 가볍다) */
function fallback(request: Omit<AiWorkerRequest, "id">): AiActionResult {
  const { search: _search, ...plain } = request.decisionParams ?? {};
  const d = chooseAiAction(request.state, request.key, request.riskAversion, {
    legalMoveIds: request.legalMoveIds,
    decisionParams: plain,
    opponentMemory: request.opponentMemory,
  });
  return { action: d.action, opponentDistribution: d.opponentDistribution };
}

/** 대전 시작 때 워커를 미리 띄운다(첫 AI 턴에 번들 로드 시간이 제한 시간을 먹지 않게) */
export function prewarmAiWorker(): void {
  getWorker();
}

/** 제한 시간: 워커가 준비됐으면 2초(사용자 합의 — 최대 판단 시간), 로드 중이면 넉넉히 */
const READY_TIMEOUT_MS = 2000;
const LOADING_TIMEOUT_MS = 8000;

export function chooseAiActionAsync(request: Omit<AiWorkerRequest, "id">): Promise<AiActionResult> {
  const w = getWorker();
  if (!w) return Promise.resolve(fallback(request));
  const timeoutMs = workerReady ? READY_TIMEOUT_MS : LOADING_TIMEOUT_MS;
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // 계산이 끝나지 않은 워커는 다음 요청을 막으므로 버리고 새로 만든다
      pending.delete(id);
      resetWorker();
      resolve(fallback(request));
    }, timeoutMs);
    pending.set(id, (response) => {
      clearTimeout(timer);
      const action = response && "action" in response ? toTurnAction(response.action) : undefined;
      if (!action) return resolve(fallback(request));
      resolve({ action, opponentDistribution: response && "dist" in response && response.dist ? deserializeDistribution(response.dist) : undefined });
    });
    w.postMessage({ ...request, id } satisfies AiWorkerRequest);
  });
}
