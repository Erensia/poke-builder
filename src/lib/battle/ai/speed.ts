import { type Move } from "@/types/move";
import { compareTurnOrder } from "@/lib/turnOrder";
import { type BattleFighterState, type BattleState } from "../state";
import { buildTurnOrderActor, effectiveHeldItem } from "../turnOrderInputs";

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
  const lowRoll = compareTurnOrder(mine, theirs, () => 0, trickRoom);
  const highRoll = compareTurnOrder(mine, theirs, () => 0.99, trickRoom);
  const base = lowRoll !== highRoll ? 0.5 : lowRoll === 0 ? 1 : 0;
  const order: SpeedOrder = lowRoll !== highRoll ? "speed_tie" : lowRoll === 0 ? "first" : "second";
  if (mine.move.priority !== theirs.move.priority) return { probability: base, order };
  const qMe = (effectiveHeldItem(me)?.quickClawChance ?? 0) / 100;
  const qThem = (effectiveHeldItem(opponent)?.quickClawChance ?? 0) / 100;
  const onlyMe = qMe * (1 - qThem);
  const neitherOrBoth = (1 - qMe) * (1 - qThem) + qMe * qThem;
  return { probability: onlyMe + neitherOrBoth * base, order };
}
