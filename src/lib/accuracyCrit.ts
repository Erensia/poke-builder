import {
  isAccuracyEvasionKey,
  NEUTRAL_CRIT_STAGE,
  type AccuracyEvasionKey,
  type AccuracyEvasionStages,
  type CritStage,
} from "../types/battleStats";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import { modify4096 } from "./damageFormula";

function clampAccuracyStage(stage: number): number {
  return Math.max(-6, Math.min(6, stage));
}

function clampCritStage(stage: number): CritStage {
  return Math.max(0, Math.min(3, Math.round(stage))) as CritStage;
}

/**
 * 명중률/회피율 랭크 배율. 사용자 확인 공식 그대로:
 * s = 공격측 명중 랭크 − 방어측 회피 랭크 (−6~+6로 클램프)
 * s ≥ 0: (3+s)/3   s < 0: 3/(3+|s|)
 *
 * accuracyStage와 evasionStage는 서로 다른 포켓몬(공격측/방어측)의 값이라는 점에 주의 —
 * 각 포켓몬은 자기 자신의 명중 랭크(accuracy)와 회피 랭크(evasion)를 AccuracyEvasionStages로
 * 각각 들고 있고, 이 함수는 공격측의 accuracy와 방어측의 evasion을 한 쌍으로 받아 계산한다.
 */
export function computeAccuracyMultiplier(accuracyStage: number, evasionStage: number): number {
  const s = clampAccuracyStage(accuracyStage - evasionStage);
  return s >= 0 ? (3 + s) / 3 : 3 / (3 + Math.abs(s));
}

/**
 * 명중 보정의 4096분율 분자(Showdown 소스 상수, 8.3 D3-fix-8). 데미지 쪽 toNumerator와 값이 달라(복안 5325 ↔ tr(1.3×4096) 5324,
 * 모래숨기·의욕 3277 ↔ 3276) 소수 → 분자 표를 따로 둔다. 중력은 5/3이 아니라 6840이다.
 */
export const GRAVITY_ACCURACY_NUMERATOR = 6840;
const ACCURACY_NUMERATORS: ReadonlyArray<readonly [number, number]> = [
  [1.1, 4505], // 광각렌즈
  [1.2, 4915], // 포커스렌즈
  [1.3, 5325], // 복안
  [0.9, 3686], // 반짝가루
  [0.8, 3277], // 모래숨기·눈숨기·의욕
  [0.5, 2048], // 갈지자걸음
];
export function accuracyNumerator(multiplier: number): number {
  const hit = ACCURACY_NUMERATORS.find(([m]) => Math.abs(m - multiplier) < 1e-9);
  return hit ? hit[1] : Math.trunc(multiplier * 4096);
}
/** 4096분율 분자들을 이어 곱한 분자(`(a×b+2048)>>12`). 순서 = 중력 → 복안·의욕·모래숨기·눈숨기·갈지자걸음 → 렌즈류·반짝가루 */
function chainNumerators(numerators: number[]): number {
  return numerators.reduce((acc, n) => (acc * n + 2048) >> 12, 4096);
}

/**
 * 첫 타(또는 단타)의 최종 적중 확률(0~1). 필중기(accuracy=null)는 null. Showdown hitStepAccuracy와 같다 — 보정 분자들을 체인으로
 * 모아 명중 수치에 한 번 곱해 정수로 만들고, 랭크(명중 − 회피, ±6)는 `⌊acc×(3+s)/3`·`⌊acc×3/(3−s)` 절삭, 100을 넘으면 100%.
 * numerators는 반짝가루·모래숨기 같은 특성/도구 보정의 4096분율 분자(순서 중요).
 */
export function computeHitChance(
  baseAccuracy: number | null,
  attackerAccuracyStage: number,
  defenderEvasionStage: number,
  numerators: number[] = [],
): number | null {
  if (baseAccuracy === null) return null;
  let accuracy = numerators.length > 0 ? modify4096(baseAccuracy, chainNumerators(numerators) / 4096) : baseAccuracy;
  const stage = clampAccuracyStage(attackerAccuracyStage - defenderEvasionStage);
  if (stage > 0) accuracy = Math.trunc((accuracy * (3 + stage)) / 3);
  else if (stage < 0) accuracy = Math.trunc((accuracy * 3) / (3 - stage));
  return Math.max(0, Math.min(100, accuracy)) / 100;
}

const PER_HIT_BOOST_TABLE = [1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3];

/**
 * 연속기 2타째 이후(트리플악셀·찍찍베기)의 적중 확률. Showdown champions hitStepMoveHitLoop(multiaccuracy)를 그대로 옮겼다:
 * 명중·회피 랭크를 각각 따로 소수로 곱하고, 그 값이 **정수일 때만** 보정(렌즈·복안 등)이 적용되며(sim/battle.ts runEvent),
 * 판정은 `random(100) < accuracy`(0~99 정수 비교)라 소수 수치는 올림(67.5 → 68%)이다. 본가와 다를 가능성이 첫 타보다 크다(설계서 §7).
 */
export function computePerHitChance(
  baseAccuracy: number | null,
  attackerAccuracyStage: number,
  defenderEvasionStage: number,
  numerators: number[] = [],
): number | null {
  if (baseAccuracy === null) return null;
  let accuracy = baseAccuracy;
  const acc = clampAccuracyStage(attackerAccuracyStage);
  accuracy = acc > 0 ? accuracy * PER_HIT_BOOST_TABLE[acc] : accuracy / PER_HIT_BOOST_TABLE[-acc];
  const eva = clampAccuracyStage(defenderEvasionStage);
  if (eva > 0) accuracy /= PER_HIT_BOOST_TABLE[eva];
  else if (eva < 0) accuracy *= PER_HIT_BOOST_TABLE[-eva];
  if (Number.isInteger(accuracy) && numerators.length > 0) accuracy = modify4096(accuracy, chainNumerators(numerators) / 4096);
  return Math.max(0, Math.min(100, Math.ceil(accuracy))) / 100;
}

/**
 * 급소율 단계별 확률표. 급소율은 -6~+6 랭크가 아니라 0~3의 별도 카운터로,
 * 3단계에서 100%(필중 급소)에 도달한다.
 * 0단계는 1/24(4.17%) — 본가(1/16)와 다른 챔피언스 고유 수치. Phase 2에서 1/16으로
 * 잘못 기록했던 걸 사용자가 실제 자료로 정정(Phase 3, 1-2 작업 중 확인).
 */
const CRIT_CHANCE_TABLE: Record<CritStage, number> = {
  0: 1 / 24,
  1: 1 / 8,
  2: 1 / 2,
  3: 1,
};

/**
 * 급소율 단계별 확률. highCritRatio는 섀도클로·스톤에지 등 "급소에 맞을 확률이 높다"고
 * 표시된 기술 전용 — 지속 랭크 변화가 아니라 그 기술을 쓸 때만 급소율 카운터에 +1단계를
 * 임시로 얹는 일회성 보정이라 stage 자체를 건드리지 않고 이 함수 안에서만 반영한다.
 * stage를 CritStage가 아니라 number로 받는 건, 초점렌즈(Item.critStageBonus)처럼 지속 랭크에
 * 도구 보너스를 더한 값을 그대로 넘길 수 있게 하기 위해서다 — 어차피 clampCritStage가 0~3으로
 * 잘라주므로 호출부가 미리 클램프할 필요는 없다.
 */
export function critChance(stage: number = NEUTRAL_CRIT_STAGE, highCritRatio = false): number {
  const effectiveStage = clampCritStage(stage + (highCritRatio ? 1 : 0));
  return CRIT_CHANCE_TABLE[effectiveStage];
}

interface ApplyStatusStagesOptions {
  /** 조건부 효과(저주 등) 판정에 쓸, 기술을 사용한 쪽의 실제 타입 */
  userTypes?: PokemonType[];
  /** 확률부여 효과를 포함할지. 기본 true(적중한다고 가정) */
  includeChanceBased?: boolean;
}

/** move.statChanges 중 target에 해당하는 accuracy/evasion 항목만 골라 적용한다 */
export function applyMoveAccuracyEvasionChanges(
  stages: AccuracyEvasionStages,
  move: Move,
  target: "self" | "opponent",
  options: ApplyStatusStagesOptions = {},
): AccuracyEvasionStages {
  if (!move.statChanges) return stages;
  const { userTypes, includeChanceBased = true } = options;

  let next = stages;
  for (const effect of move.statChanges) {
    if (effect.target !== target) continue;
    if (!isAccuracyEvasionKey(effect.stat)) continue;
    if (effect.chance !== undefined && !includeChanceBased) continue;
    if (effect.userIsType !== undefined && (!userTypes || !userTypes.includes(effect.userIsType))) continue;
    if (effect.userIsNotType !== undefined && (!userTypes || userTypes.includes(effect.userIsNotType))) continue;

    const key: AccuracyEvasionKey = effect.stat;
    const value = effect.setTo !== undefined ? effect.setTo : next[key] + (effect.delta ?? 0);
    next = { ...next, [key]: clampAccuracyStage(value) };
  }
  return next;
}

/** move.statChanges 중 target에 해당하는 critStage 항목만 골라 적용한다 (안개제거 등은 0으로 재설정) */
export function applyMoveCritStageChanges(
  stage: CritStage,
  move: Move,
  target: "self" | "opponent",
  options: ApplyStatusStagesOptions = {},
): CritStage {
  if (!move.statChanges) return stage;
  const { userTypes, includeChanceBased = true } = options;

  let next = stage;
  for (const effect of move.statChanges) {
    if (effect.target !== target) continue;
    if (effect.stat !== "critStage") continue;
    if (effect.chance !== undefined && !includeChanceBased) continue;
    if (effect.userIsType !== undefined && (!userTypes || !userTypes.includes(effect.userIsType))) continue;
    if (effect.userIsNotType !== undefined && (!userTypes || userTypes.includes(effect.userIsNotType))) continue;

    next = clampCritStage(effect.setTo !== undefined ? effect.setTo : next + (effect.delta ?? 0));
  }
  return next;
}
