import { type FighterKey } from "@/types/battle";
import { type Ability } from "@/types/ability";
import { type StatusCondition } from "@/types/status";
import { isStatusBlockedByField } from "@/lib/fieldEffects";
import { isImmuneToStatus } from "@/lib/statusConditions";
import { isGrounded } from "./grounding";
import { abilityStatusImmunitiesOf, activeWeather, sideOf, type BattleFighterState, type BattleState } from "./state";

/** 상태이상이 걸리지 않는 사유 — 특성(이름을 알린다) 또는 그 밖(타입·필드·신비의부적·쾌청 얼음·소란피기) */
export type StatusBlock = { kind: "ability"; abilityName: string } | { kind: "other" };

export interface StatusBlockOptions {
  /** 부식: 공격측이 독·강철의 독 면역을 무시한다 */
  attackerBypassesPoisonTypeImmunity?: boolean;
  /** 틈새포착: 공격측이 신비의부적을 뚫는다(Showdown `safeguard.onSetStatus`의 infiltrates) */
  attackerBypassesScreens?: boolean;
  /** 자기 자신에게 거는 상태이상(잠자기) — 신비의부적·플라워베일은 자기 자신을 막지 않는다(Showdown `target !== source`) */
  self?: boolean;
  /** 하품의 2턴 뒤 잠듦 시도 — 신비의부적은 보지 않는다(Showdown `safeguard`가 `yawn`이면 통과, 8.3 D3-fix-46 R3) */
  skipSafeguard?: boolean;
}

/**
 * 이 포켓몬에게 주 상태이상이 걸리지 않는 사유(없으면 undefined) — 8.3 D3-fix-46. 기존 inflictStatuses의 `continue` 네 개를 같은 순서로 한 곳에 모았다:
 * ① 특성·타입 면역 ② 필드(일렉트릭 수면·미스트 전부, 접지만) ③ 신비의부적 ④ 쾌청의 얼음. 엔진 상태이상 부여·하품·잠자기·AI가 같은 판정을 쓴다.
 * key는 이 포켓몬의 편, ability는 틀깨기로 무시된 뒤의 특성이다(무시됐으면 undefined).
 */
export function statusBlockReason(
  state: BattleState,
  key: FighterKey | undefined,
  fighter: BattleFighterState,
  ability: Ability | undefined,
  status: StatusCondition,
  opts: StatusBlockOptions = {},
): StatusBlock | undefined {
  const weather = activeWeather(state);
  if (ability && abilityStatusImmunitiesOf(fighter, ability, { weather, self: opts.self })?.includes(status)) {
    return { kind: "ability", abilityName: ability.name };
  }
  if (isImmuneToStatus(status, fighter.types, fighter.sleepBlockedByUproar ? ["sleep"] : undefined, opts.attackerBypassesPoisonTypeImmunity)) {
    return { kind: "other" };
  }
  if (isStatusBlockedByField(state.field, status, isGrounded(state, fighter, ability))) return { kind: "other" };
  if (!opts.self && !opts.skipSafeguard && !opts.attackerBypassesScreens && key !== undefined && sideOf(state, key).safeguardTurnsRemaining !== undefined) return { kind: "other" };
  if (status === "freeze" && weather === "쾌청") return { kind: "other" };
  return undefined;
}

/** 잠자기가 실패하는 사유 — 이미 수면(잠꼬대 경유)·HP 가득·수면 면역 특성(특성 이름)·필드·소란피기 */
export type RestFailure = { kind: "sleeping" | "fullHp" | "other" } | { kind: "ability"; abilityName: string };

/**
 * 잠자기(Move.restSleep)를 쓰는 쪽이 실패하는지(8.3 D3-fix-46 E8-20, Showdown `Rest.onTry` → `setStatus` 순): ① 이미 수면 ② HP 가득(상태이상이 있어도) ③ 수면 면역 특성(불면·의기양양·스위트베일·정화의소금·
 * 쾌청의 리프가드) ④ 일렉트릭·미스트필드(접지)·소란피기. 자기 자신 대상이라 신비의부적·플라워베일은 막지 않는다. 엔진과 AI가 같은 판정을 쓴다.
 */
export function restFailure(state: BattleState, fighter: BattleFighterState, ability: Ability | undefined): RestFailure | undefined {
  if (fighter.status.condition === "sleep") return { kind: "sleeping" };
  if (fighter.currentHp >= fighter.maxHp) return { kind: "fullHp" };
  const block = statusBlockReason(state, undefined, fighter, ability, "sleep", { self: true });
  if (!block) return undefined;
  return block.kind === "ability" ? { kind: "ability", abilityName: block.abilityName } : { kind: "other" };
}
