// battleSimulator.ts는 ver.1.5 §8부터 실제 로직을 담지 않는 얇은 배럴이다. 실제 구현은
// src/lib/battle/ 아래 파일들에 있다(state/switching/hitResolution/preHitEffects/
// mirroredEffects/resolveAction/runTurn/finishTurn — 분리 경위는 1.5-backlog.md §8 참고).
// 기존 소비처(BattleLogPage.tsx 등)의 import 경로("../lib/battleSimulator")를 그대로
// 유지하기 위해 이 파일이 남아 공개 표면만 재export한다.
export type {
  ActionLogEntry,
  FighterKey,
  HitAbilityEvent,
  TurnAction,
  TurnResult,
} from "../types/battle";

export {
  STRUGGLE_MOVE,
  emptyHazardState,
  sideOf,
  opponentKey,
  createFighterState,
  createBattleState,
  hasUsableMove,
  type BattleFighterState,
  type BattleSide,
  type BattleState,
  type SideInit,
} from "./battle/state";

export { isTrappedFromSwitching, applySwitch, type ApplySwitchOutcome } from "./battle/switching";

export {
  runTurn,
  resumeTurn,
  type RunTurnOutcome,
  type RunTurnPaused,
  type RunTurnContext,
} from "./battle/runTurn";
