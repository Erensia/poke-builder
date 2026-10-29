import { type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { BattleSide, BattleState } from "../../lib/battle/state";
import type { FighterKey, TurnResult } from "../../types/battle";
import type { Pokemon } from "../../types/pokemon";
import { type InputModeState, type MegaDeclaredState, type PendingForcedSwitchState, type PendingPivotState, type SelectedState, type Side, type SlotIndex } from "./shared";

/** BattleBoard가 받는 값 전부 — 하위 컴포넌트(BattleFieldStatus·BattleFighterCard·BattleFighterInput·BattleTurnPanel)가 같은 객체를 나눠 쓴다 */
export interface BattleBoardProps {
  /** 배틀 프런티어·랭크배틀 진행 중이면 결과 배너의 "대전 이어하기"를 이 라벨의 "다음 상대" 버튼으로 바꾼다. note는 대전 중 안내 */
  seriesNext: { label: string; onNext: () => void; note: string } | null;
  /** 결과 배너 아래에 붙일 내용(랭크배틀의 계산 내역) */
  resultExtra?: ReactNode;
  /** 컴퓨터(배틀 AI)가 조작하는 편. 사람이 양쪽 다 조작하면 null */
  aiSide: Side | null;
  /** AI가 이번 턴 행동을 계산하는 중(ver.2.0 2-B — Web Worker) — 점 세 개 표시, 턴 진행 버튼 잠금 */
  aiThinking: boolean;
  /** 이번 대전을 학습했으면 누적 판 수(ver.2.0 1-C 결과 배너 한 줄) */
  learnedBattles: number | null;
  battleState: BattleState;
  winner: FighterKey | "draw" | undefined;
  selected: SelectedState;
  setSelected: Dispatch<SetStateAction<SelectedState>>;
  inputMode: InputModeState;
  setInputMode: Dispatch<SetStateAction<InputModeState>>;
  megaDeclared: MegaDeclaredState;
  setMegaDeclared: Dispatch<SetStateAction<MegaDeclaredState>>;
  pendingForcedSwitch: PendingForcedSwitchState;
  pendingPivot: PendingPivotState;
  lockWarning: string | null;
  setLockWarning: Dispatch<SetStateAction<string | null>>;
  log: TurnResult[];
  battleBoardBackground: (state: BattleState) => string | undefined;
  activeMoveIds: (side: Side) => (string | null)[];
  choiceLockedMoveId: (side: Side) => string | null;
  battleSide: (side: Side) => BattleSide | undefined;
  switchableIndices: (side: Side) => number[];
  resolveForcedSwitch: (side: Side, toIndex: number) => void;
  resolvePivot: (toIndex: number) => void;
  isStruggling: (side: Side) => boolean;
  moveRestrictionMessage: (side: Side, moveId: string) => string | null;
  /** 2.3 B2 — 상대 파티 6마리 나열용. 빌드된(포켓몬+기술 있는) 슬롯 인덱스 */
  buildableIndices: (side: Side) => SlotIndex[];
  pokemonAt: (side: Side, i: SlotIndex) => Pokemon | undefined;
  /** 선출된 빌드 슬롯 인덱스(선출 순서) — battleSide(side).party[j]가 selection[side][j] 슬롯과 대응 */
  selection: { a: SlotIndex[]; b: SlotIndex[] };
  playTurn: () => void;
  resetToSetup: () => void;
}
