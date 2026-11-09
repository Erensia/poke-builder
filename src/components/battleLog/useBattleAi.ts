import { useEffect, useRef, useState } from "react";
import type { BattleState } from "../../lib/battle/state";
import type { TurnAction, TurnResult } from "../../types/battle";
import { faintOrder, isForcedSwitchEntry } from "../../lib/battleLogText";
import { chooseAiForcedSwitch, sampleRiskAversion, statusMoveIdsOf } from "../../lib/battle/ai";
import { RANK_AI_PROFILES } from "../../lib/battle/ai/rankProfile";
import { APP_DECISION_PARAMS, chooseAiActionAsync, prewarmAiWorker } from "../../lib/battle/ai/aiClient";
import { combinedMemory, emptyOpponentMemory, observeOpponent } from "../../lib/battle/ai/opponentMemory";
import type { LevelOneDistribution } from "../../lib/battle/ai/levelOne";
import { useAiMemory } from "../../hooks/useAiMemory";
import type { Side } from "./shared";
import type { BattleMode } from "./useBattleLogSession";
import type { PendingForcedSwitchState, PendingPivotState } from "./shared";

interface BattleAiInput {
  mode: BattleMode;
  /** 랭크배틀의 AI 단계(RANK_AI_PROFILES 인덱스) */
  rankAiLevel: number;
  battleState: BattleState | null;
  log: TurnResult[];
  pendingForcedSwitch: PendingForcedSwitchState;
  pendingPivot: PendingPivotState;
  resolveForcedSwitch: (side: Side, toIndex: number) => void;
  resolvePivot: (toIndex: number) => void;
  switchableIndices: (side: Side) => number[];
  selectableMoveIds: (side: Side) => string[];
}

/** 배틀 AI의 상태·호출 — 대전을 조작하는 쪽(세션)은 켜고(begin) 끄고(reset) 행동을 요청(requestAction)하는 것만 안다 */
export function useBattleAi({ mode, rankAiLevel, battleState, log, pendingForcedSwitch, pendingPivot, resolveForcedSwitch, resolvePivot, switchableIndices, selectableMoveIds }: BattleAiInput) {
  // 대전 시작 시점에 확정된 AI 편과 위험 회피 성향(decision-layer §5) — 성향은 대전마다 1회만 뽑아 끝까지 쓴다
  const [aiSide, setAiSide] = useState<Side | null>(null);
  const [aiRiskAversion, setAiRiskAversion] = useState(0.5);
  // AI 행동 계산 중(ver.2.0 2-B) — 요청 번호로, 계산 도중 초기화·새 대전이 시작되면 늦게 온 답을 버린다
  const [aiThinking, setAiThinking] = useState(false);
  const aiRequestRef = useRef(0);
  // 사용자 패턴 학습(ver.2.0 1-C): 누적본은 useAiMemory(localStorage), 이번 대전 관측은 세션 기록 — 대전이 끝나면 합친다
  const aiMemory = useAiMemory(mode);
  const aiSessionRef = useRef(emptyOpponentMemory());
  const [showAiMemory, setShowAiMemory] = useState(false);
  /** 이번 대전을 학습했으면 누적 판 수(결과 배너 한 줄), 아니면 null */
  const [learnedBattles, setLearnedBattles] = useState<number | null>(null);

  /** 새 대전 시작 — AI 상대면 b편을 맡긴다 */
  function begin(aiOpponent: boolean) {
    setAiSide(aiOpponent ? "b" : null);
    if (aiOpponent) prewarmAiWorker();
    setAiRiskAversion(sampleRiskAversion());
    aiSessionRef.current = emptyOpponentMemory();
    setLearnedBattles(null);
    aiRequestRef.current++;
    setAiThinking(false);
  }

  /** 셋업 화면으로 돌아간다 — 계산 중이던 답은 버린다 */
  function reset() {
    aiRequestRef.current++;
    setAiThinking(false);
    setAiSide(null);
  }

  // AI 편의 강제 교체(기절 후)·유턴류 교대는 사람 입력을 기다리지 않고 AI가 바로 고른다.
  useEffect(() => {
    if (!battleState || !aiSide) return;
    if (pendingPivot?.side === aiSide) {
      resolvePivot(chooseAiForcedSwitch(battleState, aiSide, aiRiskAversion) ?? switchableIndices(aiSide)[0] ?? -1);
      return;
    }
    // 두 편이 다 교체를 기다릴 때는 먼저 쓰러진 편이 먼저 낸다 — 사람이 먼저 쓰러졌으면 사람이 고를 때까지 기다린다(등장 특성이 먼저 나온 쪽 기준으로 이어진다, 7.5 F2)
    const human = aiSide === "a" ? "b" : "a";
    const lastTurn = [...log].reverse().find((t) => !isForcedSwitchEntry(t));
    const order = lastTurn ? faintOrder(lastTurn) : [];
    if (pendingForcedSwitch?.[human] && order.indexOf(human) !== -1 && order.indexOf(human) < order.indexOf(aiSide)) return;
    if (pendingForcedSwitch?.[aiSide] && !pendingPivot) {
      const toIndex = chooseAiForcedSwitch(battleState, aiSide, aiRiskAversion) ?? switchableIndices(aiSide)[0];
      if (toIndex !== undefined) resolveForcedSwitch(aiSide, toIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingForcedSwitch, pendingPivot, battleState, aiSide]);

  /**
   * AI 편의 행동을 Web Worker에서 계산한다(화면 멈춤 없음, 2초 안에 답이 없으면 지금 AI로 — aiClient.ts).
   * 고를 수 있는 기술은 사람에게 적용하는 규칙(PP·구애 고정·도발·사슬묶기·앙코르)과 똑같이 거른다(selectableMoveIds).
   * 계산 도중 초기화·새 대전이 되면 onDone을 부르지 않는다.
   */
  function requestAction(state: BattleState, onDone: (action: TurnAction | null, opponentDistribution?: LevelOneDistribution) => void) {
    const requestId = ++aiRequestRef.current;
    setAiThinking(true);
    void chooseAiActionAsync({
      state,
      key: aiSide!,
      riskAversion: aiRiskAversion,
      legalMoveIds: selectableMoveIds(aiSide!),
      decisionParams: mode === "rank" ? RANK_AI_PROFILES[rankAiLevel] : APP_DECISION_PARAMS,
      opponentMemory: combinedMemory(aiMemory.memory, aiSessionRef.current),
    }).then((result) => {
      if (requestId !== aiRequestRef.current) return;
      setAiThinking(false);
      onDone(result.action, result.opponentDistribution);
    });
  }

  /** 1-C: AI가 예측한 사용자 행동 분포와 사용자가 실제로 고른 행동을 짝지어 이번 대전 세션 기록에 더한다 */
  function observe(state: BattleState, human: TurnAction, side: Side, dist: LevelOneDistribution) {
    observeOpponent(aiSessionRef.current, {
      dist,
      speciesId: state[side].slot.pokemonId,
      statusMoveIds: statusMoveIdsOf(dist),
      action: human.kind === "switch" ? { kind: "switch" } : { kind: "move", moveId: human.move.id, isStatus: human.move.category === "status" },
    });
  }

  /** 대전이 끝났을 때 — AI 대전이면 이번 관측을 누적 학습에 합친다("대전에서 계속 학습"이 꺼져 있으면 합치지 않음). 세션 기록은 비운다 */
  function settle() {
    if (aiSide && aiMemory.commit(aiSessionRef.current)) setLearnedBattles(aiMemory.memory.battles + 1);
    aiSessionRef.current = emptyOpponentMemory();
  }

  return { aiSide, aiThinking, aiMemory, showAiMemory, setShowAiMemory, learnedBattles, begin, reset, requestAction, observe, settle };
}
