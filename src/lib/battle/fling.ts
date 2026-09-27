import { type Item } from "@/types/item";
import { type Ability } from "@/types/ability";
import { NO_STATUS_CONDITION } from "@/types/status";
import { inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { isStatusBlockedByField } from "@/lib/fieldEffects";
import { isGrounded } from "./grounding";
import { opponentKey, sideOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";
import { type FighterKey, type FlingEffectResult } from "@/types/battle";


/**
 * 내던지기로 던진 도구의 효과를 맞은 상대에게 적용한다(본가: 던진 나무열매·허브는 맞은 쪽이 먹거나 쓴 것처럼 발동).
 * 데미지를 주고 상대가 버텼을 때만 호출한다(대타에 막히면 효과 없음).
 */
export function applyFlingEffect(
  state: BattleState,
  actorKey: FighterKey,
  defender: BattleFighterState,
  defenderAbility: Ability | undefined,
  item: Item,
  attackerMovedFirst: boolean,
): FlingEffectResult | undefined {
  if (item.flingStatus) {
    const status = item.flingStatus;
    if (
      !defender.status.condition &&
      !isImmuneToStatus(status, defender.types, statusImmunitiesOf(defender, defenderAbility)) &&
      !isStatusBlockedByField(state.field, status, isGrounded(state, defender, defenderAbility)) &&
      sideOf(state, opponentKey(actorKey)).safeguardTurnsRemaining === undefined
    ) {
      defender.status = inflictStatus(defender.status, status);
      return { status };
    }
    return undefined;
  }
  if (item.flingFlinches) {
    // 풀죽음은 상대가 이번 턴 아직 행동하지 않았을 때만 의미가 있다(정신력은 면역)
    if (!attackerMovedFirst || defenderAbility?.immuneToFlinch) return undefined;
    defender.volatile = inflictVolatile(defender.volatile, "flinch");
    return { flinched: true };
  }
  if (item.restoresLoweredStatsOnce) {
    const stages = { ...defender.stages };
    let changed = false;
    for (const key of Object.keys(stages) as (keyof typeof stages)[]) {
      if (stages[key] < 0) {
        stages[key] = 0;
        changed = true;
      }
    }
    defender.stages = stages;
    return changed ? { herb: { name: item.name } } : undefined;
  }
  if (item.curesMentalVolatilesOnInflict) {
    const active = { ...defender.volatile.active };
    const had = (["attract", "taunt", "torment", "encore", "disable"] as const).filter((v) => hasVolatile(defender.volatile, v));
    for (const v of had) delete active[v];
    defender.volatile = { active };
    return had.length > 0 ? { herb: { name: item.name } } : undefined;
  }
  if (item.name.endsWith("열매")) return { berry: eatBerryNow(defender, item) };
  return undefined;
}

/**
 * 나무열매를 조건과 무관하게 바로 먹은 효과(내던지기로 맞음·다과회 — 트랙 M5·Tier 2): 해당 상태이상·혼란을 풀고 HP 회복 열매면
 * 그만큼 회복한다(HP 조건 무시). 도구 소모는 부르는 쪽 몫.
 */
export function eatBerryNow(fighter: BattleFighterState, item: Item): NonNullable<FlingEffectResult["berry"]> {
  const berry: NonNullable<FlingEffectResult["berry"]> = { name: item.name };
  const condition = fighter.status.condition;
  if (condition && item.curesStatusOnInflict?.includes(condition)) {
    fighter.status = NO_STATUS_CONDITION;
    berry.curedStatus = condition;
  }
  if (item.curesConfusionOnInflict && hasVolatile(fighter.volatile, "confusion")) {
    const active = { ...fighter.volatile.active };
    delete active.confusion;
    fighter.volatile = { active };
    berry.curedConfusion = true;
  }
  const heal = item.healsBelowHalfHpDenominator
    ? Math.floor(fighter.maxHp / item.healsBelowHalfHpDenominator)
    : (item.healsBelowHalfHpFlat ?? 0);
  if (heal > 0) {
    const healed = Math.min(fighter.maxHp - fighter.currentHp, heal);
    fighter.currentHp += healed;
    berry.healed = healed;
  }
  return berry;
}
