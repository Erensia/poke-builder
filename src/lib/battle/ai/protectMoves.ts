import { type FighterKey, type TurnAction } from "@/types/battle";
import { type Move } from "@/types/move";
import { cloneSide, type BattleState } from "../state";
import { resumeTurn, runTurn } from "../runTurn";

/**
 * 방어류 묶음(decision-layer §4-4) — 같은 엔진 시뮬레이션을 쓰지만 판단 기준·토글·검증을 묶음별로 둔다.
 *  - block: 방어·판별(순수 방어)
 *  - punish: 킹실드·니들가드·토치카(막으면서 접촉한 상대에게 페널티)
 *  - priorityGuard: 패스트가드(우선도 기술만 막음)
 *  - endure: 버티기(HP 1로 버팀)
 *  - destinyBond: 길동무(나를 쓰러뜨린 상대도 기절)
 */
export type ProtectGroup = "block" | "punish" | "priorityGuard" | "endure" | "destinyBond";

export const ALL_PROTECT_GROUPS: readonly ProtectGroup[] = ["block", "punish", "priorityGuard", "endure", "destinyBond"];

export function protectGroupOf(move: Move): ProtectGroup | undefined {
  switch (move.protectEffect) {
    case "block":
      return move.protectContactPenalty || move.protectContactDamageFraction || move.protectContactStatus ? "punish" : "block";
    case "blockPriority":
      return "priorityGuard";
    case "endure":
      return "endure";
    case "destinyBond":
      return "destinyBond";
    default:
      return undefined;
  }
}

/** 연속 사용 성공 확률 — 엔진(mirroredEffects)과 같은 (1/3)^연속 횟수 */
export function protectSuccessChance(streak: number | undefined): number {
  return Math.pow(1 / 3, streak ?? 0);
}

/** 시뮬레이션에 섞을 상대 행동: 확률 5% 미만은 버리고 큰 순 최대 4개, 합이 1이 되게 다시 나눈다 */
export function opponentActionMix(weights: { move: Move; weight: number }[]): { move: Move; weight: number }[] {
  const picked = [...weights]
    .filter((w) => w.weight >= 0.05)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
  const total = picked.reduce((sum, w) => sum + w.weight, 0);
  return total > 0 ? picked.map((w) => ({ move: w.move, weight: w.weight / total })) : [];
}

/**
 * 엔진으로 "나는 방어류, 상대는 opponentMove"인 한 턴을 실제로 돌린 결과 state(§4-4). 난수는 0.5 고정
 * (데미지 중간값, 급소·확률 추가효과·마비 행동불능 없음). 연속 사용 확률은 여기서 강제로 성공시키고(연속 횟수 0),
 * 호출부가 protectSuccessChance로 따로 곱한다. 유턴류 등으로 교대 대기가 걸리면 교체 없이 이어간다.
 */
export function simulateProtectTurn(
  state: BattleState,
  key: FighterKey,
  move: Move,
  opponentMove: Move,
  mega: boolean | undefined,
): BattleState {
  const sideA = cloneSide(state.sideA);
  const sideB = cloneSide(state.sideB);
  const start: BattleState = {
    ...state,
    a: sideA.party[sideA.activeIndex],
    b: sideB.party[sideB.activeIndex],
    sideA,
    sideB,
    entryAnnouncements: [],
  };
  start[key].protectStreak = 0;
  const mine: TurnAction = { kind: "move", move, mega };
  const theirs: TurnAction = { kind: "move", move: opponentMove };
  const [actionA, actionB] = key === "a" ? [mine, theirs] : [theirs, mine];
  let out = runTurn(start, actionA, actionB, () => 0.5);
  for (let guard = 0; "awaitingSelfSwitch" in out && guard < 4; guard++) out = resumeTurn(out._ctx, -1);
  return out.nextState;
}

/** 패스트가드: 상대 행동 후보 중 우선도가 있는 공격기가 하나라도 있어야 막을 게 있다 */
export function hasPriorityThreat(mix: { move: Move }[]): boolean {
  return mix.some((m) => m.move.category !== "status" && m.move.priority > 0);
}
