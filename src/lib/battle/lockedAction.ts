import { type TurnAction } from "@/types/battle";
import { getMove } from "@/lib/data";
import { hasVolatile } from "@/lib/volatileConditions";
import { STRUGGLE_MOVE, isFainted, type BattleFighterState } from "./state";
import { forcedRampageAction } from "./rampage";

/** 반동 턴(파괴광선·기가임팩트류를 맞힌 다음 턴)인가 */
export function isRecharging(fighter: BattleFighterState): boolean {
  return hasVolatile(fighter.volatile, "recharge");
}

/**
 * 이번 턴 입력과 무관하게 정해진 행동(ver.1.9 한계점 A1) — 셋 다 교체 불가(본가 규칙):
 *  - 난동 중: 그 기술(rampage.ts)
 *  - 모으기 2턴째(솔라빔·공중날기 등): 준비한 기술 — preHitEffects가 저장한 기술로 바꿔 쓴다(PP 없음)
 *  - 반동 턴: 움직일 수 없다 — preHitEffects가 막는다(PP 없음). 로그용으로 직전 기술을 싣는다.
 */
export function forcedLockedAction(fighter: BattleFighterState): TurnAction | undefined {
  if (isFainted(fighter)) return undefined;
  const rampage = forcedRampageAction(fighter);
  if (rampage) return rampage;
  if (fighter.chargingMoveId) {
    const move = getMove(fighter.chargingMoveId);
    if (move) return { kind: "move", move };
  }
  if (isRecharging(fighter)) {
    const move = fighter.lastMoveId ? getMove(fighter.lastMoveId) : undefined;
    return { kind: "move", move: move ?? STRUGGLE_MOVE };
  }
  return undefined;
}
