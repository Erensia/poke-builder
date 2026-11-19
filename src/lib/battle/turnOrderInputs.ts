import { type Item } from "@/types/item";
import { type Move } from "@/types/move";
import { getItem } from "@/lib/data";
import { getAbilityPriorityBoost } from "@/lib/abilityModifiers";
import { getFieldAdjustedPriority } from "@/lib/fieldEffects";
import { getItemSpeedMultiplier } from "@/lib/itemEffects";
import { type TurnOrderActor, compareTurnOrder } from "@/lib/turnOrder";
import { computeSpeedStat } from "@/lib/battlePower";
import { speedStatusParts } from "@/lib/statusConditions";
import { type FighterKey } from "@/types/battle";
import { abilityOf, activeWeather, type BattleFighterState, type BattleState } from "./state";
import { isGrounded } from "./grounding";

/** 매직룸(트랙 M4): 모든 포켓몬의 도구 효과가 무효 */
export function itemsSuppressedByRoom(state: BattleState | undefined): boolean {
  return state?.magicRoomTurnsRemaining !== undefined;
}

/**
 * 지닌 도구의 실효 객체. 서투름(disablesOwnItemEffects)이거나 매직룸 중(트랙 M4 — state를 넘길 때)이면 도구 효과가
 * 전부 무효라 undefined.
 */
export function effectiveHeldItem(fighter: BattleFighterState, state?: BattleState): Item | undefined {
  if (abilityOf(fighter)?.disablesOwnItemEffects || itemsSuppressedByRoom(state)) return undefined;
  return fighter.currentItemId ? getItem(fighter.currentItemId) : undefined;
}

/**
 * 턴 순서 비교에 쓰는 실효 스피드 — **랭크까지 포함한 최종 정수**(8.3 D3-fix-11, Showdown `getStat('spe')`·`getActionSpeed`).
 * 랭크 `floor` → 구애스카프/검은철구·엽록소류(날씨 일치 시)·서핑테일·곡예·순풍·속보를 4096 체인으로 → 마비는 체인 뒤 `floor(×50/100)`.
 * runTurn(실전 순서 결정)·배틀 AI(speed_order 예측)·매치업 화면(evaluateSpeedMatchup)이 같은 계산(battlePower.computeSpeedStat)을 공유한다.
 */
export function computeTurnOrderSpeed(state: BattleState, fighter: BattleFighterState): number {
  const ability = abilityOf(fighter);
  const weatherBoost = ability?.weatherSpeedMultiplier;
  const weatherMultiplier = weatherBoost && weatherBoost.weather === activeWeather(state) ? weatherBoost.multiplier : 1;
  // 서핑테일(ver.1.9 A5): 지정 필드면 배율
  const fieldBoost = ability?.fieldSpeedMultiplier;
  const fieldMultiplier = fieldBoost && fieldBoost.field === state.field ? fieldBoost.multiplier : 1;
  const status = speedStatusParts(fighter.status.condition, ability?.speedMultiplierWhenStatused);
  return computeSpeedStat({
    baseSpe: fighter.realStats.spe,
    stage: fighter.stages.spe,
    multipliers: [
      status.multiplier, // 속보(상태이상이면 ×1.5)
      fieldMultiplier,
      getItemSpeedMultiplier(effectiveHeldItem(fighter, state)),
      weatherMultiplier,
      // 곡예(8.3 D3-fix-9): 상태가 켜져 있어도 "지금 도구가 없을 때만" ×2(Showdown `!pokemon.item`). 도구를 되받으면 ×1, 다시 잃으면 즉시 ×2. 매직룸·서투름은 도구를 "있는" 채로 두므로 currentItemId로 본다.
      fighter.unburdenActive && !fighter.currentItemId ? 2 : 1,
      // 순풍(트랙 M1): 이 포켓몬이 속한 편에 순풍이 불고 있으면 2배
      tailwindActiveFor(state, fighter) ? 2 : 1,
    ],
    halvedByParalysis: status.halved,
  });
}

/**
 * 같은 우선도 안에서 먼저 움직일 확률(%) 목록 — 선제공격손톱(도구)·퀵드로(특성, 공격기만, ver.1.9 A5). 각각 따로 굴린다.
 */
export function quickFirstChances(state: BattleState, fighter: BattleFighterState, move: Move): number[] {
  const chances: number[] = [];
  const claw = effectiveHeldItem(fighter, state)?.quickClawChance;
  if (claw) chances.push(claw);
  const draw = abilityOf(fighter)?.movesFirstChance;
  if (draw && move.category !== "status") chances.push(draw);
  return chances;
}

/**
 * 이번 턴 순서 판정용 실효 우선도. 그래스슬라이더류(필드 조건부)와 짓궂은마음·질풍날개(특성)를
 * 더한다. 순서를 정하는 시점(턴 시작)의 필드·HP 기준.
 */
export function computeTurnOrderPriority(state: BattleState, fighter: BattleFighterState, move: Move): number {
  return (
    getFieldAdjustedPriority(move, state.field, isGrounded(state, fighter)) +
    getAbilityPriorityBoost(move, abilityOf(fighter), fighter.currentHp === fighter.maxHp)
  );
}

/** compareTurnOrder에 넘길 행동자. move는 우선도만 조정한 얕은 복사본이다. */
export function buildTurnOrderActor(state: BattleState, fighter: BattleFighterState, move: Move): TurnOrderActor {
  return {
    speed: computeTurnOrderSpeed(state, fighter),
    move: { ...move, priority: computeTurnOrderPriority(state, fighter, move) },
    movesLast: abilityOf(fighter)?.movesLastInPriorityBracket,
  };
}

/**
 * 두 편의 행동 순서(교체·메가진화처럼 기술 우선도가 없는 행동) — 스피드가 빠른 쪽이 먼저, **트릭룸이면 먼저 행동하는(느린) 쪽이 먼저**,
 * 완전 동속은 난수(Showdown `getActionSpeed`로 정렬, 8.3 A7·D3-fix-11 E3-13·E3-16, 사용자 결정 2026-11-19). 기술 우선도·선공 도구는 쓰지 않는다.
 * 호출하는 쪽이 "의미 있을 때만"(양쪽 모두 해당 행동) 불러 난수 소비를 최소화한다.
 */
export function orderBySpeed(state: BattleState, random: () => number, keys: FighterKey[]): FighterKey[] {
  if (keys.length < 2) return keys;
  const actor = (k: FighterKey): TurnOrderActor => ({ speed: computeTurnOrderSpeed(state, state[k]), move: { priority: 0 } as Move });
  return compareTurnOrder(actor(keys[0]), actor(keys[1]), random, state.trickRoomTurnsRemaining !== undefined) === 0 ? keys : [keys[1], keys[0]];
}

/** fighter가 속한 편(sideA/sideB — 활성·대기 무관)에 순풍이 불고 있는지 */
function tailwindActiveFor(state: BattleState, fighter: BattleFighterState): boolean {
  // AI는 랭크를 지운 복제본으로도 부르므로 slot으로도 찾는다
  const belongs = (party: BattleFighterState[]) => party.some((m) => m === fighter || m.slot === fighter.slot);
  const side = belongs(state.sideA.party) ? state.sideA : belongs(state.sideB.party) ? state.sideB : undefined;
  return (side?.tailwindTurnsRemaining ?? 0) > 0;
}
