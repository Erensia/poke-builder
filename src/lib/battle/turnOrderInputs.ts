import { type Item } from "@/types/item";
import { type Move } from "@/types/move";
import { getItem } from "@/lib/data";
import { getAbilityPriorityBoost } from "@/lib/abilityModifiers";
import { computeStatusSpeedMultiplier } from "@/lib/statusConditions";
import { getFieldAdjustedPriority } from "@/lib/fieldEffects";
import { getItemSpeedMultiplier } from "@/lib/itemEffects";
import { type TurnOrderActor } from "@/lib/turnOrder";
import { abilityOf, activeWeather, type BattleFighterState, type BattleState } from "./state";

/** 지닌 도구의 실효 객체. 서투름(disablesOwnItemEffects)이면 도구 효과가 전부 무효라 undefined. */
export function effectiveHeldItem(fighter: BattleFighterState): Item | undefined {
  if (abilityOf(fighter)?.disablesOwnItemEffects) return undefined;
  return fighter.currentItemId ? getItem(fighter.currentItemId) : undefined;
}

/**
 * 턴 순서 비교에 쓰는 실능 스피드(랭크 미반영 — 랭크는 compareTurnOrder가 곱한다).
 * 마비·구애스카프/검은철구·엽록소류(날씨 일치 시)·곡예(unburdenActive)·순풍을 전부 곱한다.
 * runTurn(실전 순서 결정)과 배틀 AI(speed_order 예측)가 같은 계산을 공유한다.
 */
export function computeTurnOrderSpeed(state: BattleState, fighter: BattleFighterState): number {
  const ability = abilityOf(fighter);
  const weatherBoost = ability?.weatherSpeedMultiplier;
  const weatherMultiplier = weatherBoost && weatherBoost.weather === activeWeather(state) ? weatherBoost.multiplier : 1;
  return (
    fighter.realStats.spe *
    computeStatusSpeedMultiplier(fighter.status.condition) *
    getItemSpeedMultiplier(effectiveHeldItem(fighter)) *
    weatherMultiplier *
    (fighter.unburdenActive ? 2 : 1) *
    // 순풍(트랙 M1): 이 포켓몬이 속한 편에 순풍이 불고 있으면 2배
    (tailwindActiveFor(state, fighter) ? 2 : 1)
  );
}

/**
 * 이번 턴 순서 판정용 실효 우선도. 그래스슬라이더류(필드 조건부)와 짓궂은마음·질풍날개(특성)를
 * 더한다. 순서를 정하는 시점(턴 시작)의 필드·HP 기준.
 */
export function computeTurnOrderPriority(state: BattleState, fighter: BattleFighterState, move: Move): number {
  return (
    getFieldAdjustedPriority(move, state.field) +
    getAbilityPriorityBoost(move, abilityOf(fighter), fighter.currentHp === fighter.maxHp)
  );
}

/** compareTurnOrder에 넘길 행동자. move는 우선도만 조정한 얕은 복사본이다. */
export function buildTurnOrderActor(state: BattleState, fighter: BattleFighterState, move: Move): TurnOrderActor {
  return {
    realSpeed: computeTurnOrderSpeed(state, fighter),
    move: { ...move, priority: computeTurnOrderPriority(state, fighter, move) },
    stages: fighter.stages,
    movesLast: abilityOf(fighter)?.movesLastInPriorityBracket,
  };
}

/** fighter가 속한 편(sideA/sideB — 활성·대기 무관)에 순풍이 불고 있는지 */
function tailwindActiveFor(state: BattleState, fighter: BattleFighterState): boolean {
  // AI는 랭크를 지운 복제본으로도 부르므로 slot으로도 찾는다
  const belongs = (party: BattleFighterState[]) => party.some((m) => m === fighter || m.slot === fighter.slot);
  const side = belongs(state.sideA.party) ? state.sideA : belongs(state.sideB.party) ? state.sideB : undefined;
  return (side?.tailwindTurnsRemaining ?? 0) > 0;
}
