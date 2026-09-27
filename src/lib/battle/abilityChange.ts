import { type StatusCondition } from "@/types/status";
import { NO_STATUS_CONDITION } from "@/types/status";
import { abilityOf, statusImmunitiesOf, type BattleFighterState } from "./state";

/**
 * 트랙 M3: 특성을 바꾸는 기술(스킬스왑·동료만들기·역할·위액·고민씨·심플빔)과 특성(트레이스·미라·떠도는영혼)이 공통으로
 * 쓰는 규칙. 본가의 "바꿀 수 없는 특성" 목록 중 이 로스터에 있는 것만 담았다.
 */

/** 교환·덮어쓰기·무효화가 안 되는 특성 — 폼 변화 특성과 일루전 */
export const FIXED_ABILITY_IDS: ReadonlySet<string> = new Set(["일루전", "배틀스위치", "탈", "마이티체인지"]);

/** 복사(역할·트레이스)·건네기(동료만들기)의 원본이 될 수 없는 특성 */
export const UNCOPYABLE_ABILITY_IDS: ReadonlySet<string> = new Set([...FIXED_ABILITY_IDS, "트레이스", "괴짜", "리시버"]);

export function isFixedAbility(abilityId: string | null | undefined): boolean {
  return !!abilityId && FIXED_ABILITY_IDS.has(abilityId);
}

export function isUncopyableAbility(abilityId: string | null | undefined): boolean {
  return !!abilityId && UNCOPYABLE_ABILITY_IDS.has(abilityId);
}

/**
 * 특성이 바뀐 직후, 새 특성이 면역인 상태를 바로 푼다(본가: 불면을 얻으면 잠이 깨고, 마이페이스를 얻으면 혼란이 풀린다).
 * 풀린 주 상태이상을 돌려준다(로그용). 위액으로 특성이 사라진 경우엔 풀 것이 없다.
 */
export function cureConditionsBlockedByAbility(fighter: BattleFighterState): StatusCondition | undefined {
  const ability = abilityOf(fighter);
  if (!ability) return undefined;
  let cured: StatusCondition | undefined;
  const condition = fighter.status.condition;
  if (condition && statusImmunitiesOf(fighter, ability)?.includes(condition)) {
    fighter.status = NO_STATUS_CONDITION;
    cured = condition;
  }
  const active = { ...fighter.volatile.active };
  let changed = false;
  if (ability.immuneToConfusion && active.confusion) {
    delete active.confusion;
    changed = true;
  }
  if (ability.immuneToAttractAndTaunt && (active.attract || active.taunt)) {
    delete active.attract;
    delete active.taunt;
    changed = true;
  }
  if (changed) fighter.volatile = { active };
  return cured;
}
