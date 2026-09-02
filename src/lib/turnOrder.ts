import type { Move } from "../types/move";
import { NEUTRAL_STAGES, type StatStages } from "../types/battleStats";
import { computeEffectiveSpeed } from "./battlePower";

/**
 * 턴 순서 비교에 필요한 최소 정보. 이번 턴에 쓸 기술과, 그 기술의 속도에 영향을 줄
 * 실능 스피드·현재 랭크 상태를 담는다. 시뮬레이터의 BattleState에서 뽑아 만들면 된다.
 */
export interface TurnOrderActor {
  /** 실능 스피드 (랭크 미반영). computeEffectiveSpeed에서 랭크를 곱해 실효 스피드를 구한다 */
  realSpeed: number;
  /** 이번 턴에 사용하는 기술. priority만 쓰지만, 향후 우선도 변경 특성/도구 확장을 고려해 Move 전체를 받는다 */
  move: Move;
  stages?: StatStages;
  /** 시간벌기(Ability.movesLastInPriorityBracket): 같은 우선도 안에서는 스피드 무관하게 항상 마지막에 행동한다 */
  movesLast?: boolean;
}

/**
 * 두 행동자 중 어느 쪽이 먼저 움직이는지 비교한다.
 * 1. 기술 우선도(priority)가 다르면 높은 쪽이 먼저 — 트릭룸 중에도 우선도는 그대로 존중된다(본가 규칙).
 * 2. 우선도가 같으면 실효 스피드(랭크 반영, computeEffectiveSpeed)가 높은 쪽이 먼저.
 *    trickRoomActive면 이 비교 방향만 뒤집혀 스피드가 낮은 쪽이 먼저 움직인다.
 * 3. 그것도 완전히 같으면(동속) 50% 확률로 랜덤 — 사용자 확인된 챔피언스 규칙(트릭룸 중에도 동일).
 *
 * random은 기본 Math.random이지만, 테스트에서 결과를 고정하고 싶을 때 주입할 수 있게 열어둔다.
 * 반환값 0: a가 먼저, 1: b가 먼저.
 */
export function compareTurnOrder(
  a: TurnOrderActor,
  b: TurnOrderActor,
  random: () => number = Math.random,
  trickRoomActive = false,
): 0 | 1 {
  if (a.move.priority !== b.move.priority) {
    return a.move.priority > b.move.priority ? 0 : 1;
  }

  // 시간벌기: 우선도가 같을 때 한쪽만 "항상 마지막"이면 그쪽이 나중에 움직인다.
  // 둘 다면 서로 상쇄돼 정상 스피드 비교로 넘어간다(본가 규칙).
  if (!!a.movesLast !== !!b.movesLast) {
    return a.movesLast ? 1 : 0;
  }

  const speedA = computeEffectiveSpeed(a.realSpeed, a.stages ?? NEUTRAL_STAGES);
  const speedB = computeEffectiveSpeed(b.realSpeed, b.stages ?? NEUTRAL_STAGES);
  if (speedA !== speedB) {
    const aIsFaster = speedA > speedB;
    const aGoesFirst = trickRoomActive ? !aIsFaster : aIsFaster;
    return aGoesFirst ? 0 : 1;
  }

  // 완전 동속: 50% 랜덤
  return random() < 0.5 ? 0 : 1;
}

/**
 * compareTurnOrder를 감싸서, 먼저 움직이는 쪽을 앞에 두고 [먼저, 나중] 튜플로 정렬해 반환한다.
 * 제네릭이라 TurnOrderActor를 만족하는 아무 타입(예: BattleState의 슬롯 확장 타입)이나 그대로 통과시킬 수 있다.
 */
export function resolveTurnOrder<T extends TurnOrderActor>(
  a: T,
  b: T,
  random: () => number = Math.random,
  trickRoomActive = false,
): [T, T] {
  return compareTurnOrder(a, b, random, trickRoomActive) === 0 ? [a, b] : [b, a];
}
