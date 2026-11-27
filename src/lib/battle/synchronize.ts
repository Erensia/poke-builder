import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { type FighterKey } from "@/types/battle";
import { NO_STATUS_CONDITION, type StatusCondition } from "@/types/status";
import { inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { isStatusBlockedByField } from "@/lib/fieldEffects";
import { getStatusCureBerryResult } from "@/lib/itemEffects";
import { isGrounded } from "./grounding";
import { activeWeather, consumeItem, isFainted, sideOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";

/** 복사를 받는 쪽(상태이상의 출처) — 포켓몬·편·특성·도구와 상대 긴장감으로 열매가 막혔는지 */
export interface SyncTarget {
  fighter: BattleFighterState;
  key: FighterKey;
  ability: Ability | undefined;
  item: Item | undefined;
  berriesBlocked: boolean;
}

/**
 * 8.3 D3-fix-53 (E8-44) 싱크로 — 보유자(holderAbility)가 상대 효과로 걸린 주 상태이상을 그 효과의 주인(target)에게 되돌린다.
 * Showdown `synchronize.onAfterSetStatus` → `source.trySetStatus`: 타입·특성 면역, 필드, 신비의부적, 이미 상태이상, 기절한 대상은 실패하고,
 * 성공한 상태이상에는 대상의 회복 열매(리샘열매 등)가 즉시 반응한다. 두 방향(방어측 보유자 → 공격측 / 공격측 보유자 → 방어측)이 같은 함수를 쓴다.
 * 걸렸으면 {status, curedItemName?}(열매가 바로 치료했으면 열매 이름), 아니면 undefined.
 */
export function reflectSynchronize(
  state: BattleState,
  holderAbility: Ability | undefined,
  status: StatusCondition,
  { fighter: target, key: targetKey, ability: targetAbility, item: targetItem, berriesBlocked: targetBerriesBlocked }: SyncTarget,
): { status: StatusCondition; curedItemName?: string } | undefined {
  if (!holderAbility?.reflectsStatusToOpponent?.includes(status) || isFainted(target)) return undefined;
  if (
    isImmuneToStatus(status, target.types, statusImmunitiesOf(target, targetAbility, activeWeather(state))) ||
    isStatusBlockedByField(state.field, status, isGrounded(state, target, targetAbility)) ||
    sideOf(state, targetKey).safeguardTurnsRemaining !== undefined
  ) {
    return undefined;
  }
  const next = inflictStatus(target.status, status);
  if (next.condition === target.status.condition) return undefined;
  target.status = next;
  if (!targetBerriesBlocked && getStatusCureBerryResult(targetItem, status, target.itemConsumed ?? false)) {
    target.status = { ...NO_STATUS_CONDITION };
    consumeItem(target);
    return { status, curedItemName: targetItem!.name };
  }
  return { status };
}
