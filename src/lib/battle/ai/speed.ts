import { type Move } from "@/types/move";
import { compareTurnOrder } from "@/lib/turnOrder";
import { type BattleFighterState, type BattleState } from "../state";
import { buildTurnOrderActor, quickFirstChances } from "../turnOrderInputs";

export type SpeedOrder = "first" | "second" | "speed_tie";

/**
 * me가 move를, opponent가 opponentMove를 쓸 때 me가 먼저 움직일 확률.
 * 우선도·스피드·트릭룸은 compareTurnOrder(실전과 동일), 선제공격손톱은 우선도가 같을 때만 확률로 끼어든다.
 */
export function firstProbability(
  state: BattleState,
  me: BattleFighterState,
  move: Move,
  opponent: BattleFighterState,
  opponentMove: Move | undefined,
): { probability: number; order: SpeedOrder } {
  if (!opponentMove) return { probability: 1, order: "first" };
  const mine = buildTurnOrderActor(state, me, move);
  const theirs = buildTurnOrderActor(state, opponent, opponentMove);
  const trickRoom = state.trickRoomTurnsRemaining !== undefined;
  // 같은 행동자 쌍에서 내가 먼저일 확률(동속이면 0.5)과 순서 표기
  const baseOf = (a: typeof mine, b: typeof theirs): { base: number; order: SpeedOrder } => {
    const lowRoll = compareTurnOrder(a, b, () => 0, trickRoom);
    const highRoll = compareTurnOrder(a, b, () => 0.99, trickRoom);
    return { base: lowRoll !== highRoll ? 0.5 : lowRoll === 0 ? 1 : 0, order: lowRoll !== highRoll ? "speed_tie" : lowRoll === 0 ? "first" : "second" };
  };
  const { base, order } = baseOf(mine, theirs);
  if (mine.move.priority !== theirs.move.priority) return { probability: base, order };
  // 선제공격손톱·퀵드로(ver.1.9 A5) — 각각 굴려 하나라도 성공하면 먼저
  const quickOf = (fighter: BattleFighterState, used: Move) =>
    1 - quickFirstChances(state, fighter, used).reduce((miss, c) => miss * (1 - c / 100), 1);
  const qMe = quickOf(me, move);
  const qThem = quickOf(opponent, opponentMove);
  const onlyMe = qMe * (1 - qThem);
  // 양쪽 모두 선공 발동에 성공하면(8.3 D3-fix-11 E3-14) 둘 다 이벤트 전달값이 +0.1로 덮어써져 시간벌기가 사라진다 — 스피드만 비교한다
  const bothBase = baseOf({ ...mine, movesLast: undefined }, { ...theirs, movesLast: undefined }).base;
  const neither = (1 - qMe) * (1 - qThem);
  return { probability: onlyMe + neither * base + qMe * qThem * bothBase, order };
}
