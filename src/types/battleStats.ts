import type { StatKey } from "./nature";

/** HP는 랭크 변화 대상이 아니므로 제외한 5개 전투 스탯 */
export type BattleStatKey = Exclude<StatKey, "hp">;

/** 각 스탯의 현재 랭크(-6 ~ +6). 배틀 중 칼춤/배북 등으로 바뀌는 상태를 담는다 */
export type StatStages = Record<BattleStatKey, number>;

export const NEUTRAL_STAGES: StatStages = {
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

/**
 * 명중률/회피율 랭크. atk/def 등 5스탯과는 완전히 다른 공식(rankStageMultiplier의 k=2 방식이 아니라
 * 분수 배율 (3+s)/3 · 3/(3+|s|))을 쓰기 때문에 StatStages와 같은 Record에 섞지 않고 분리한다.
 * -6~+6. computeAccuracyMultiplier(lib/accuracyCrit.ts)에서 소비한다.
 */
export type AccuracyEvasionKey = "accuracy" | "evasion";
export type AccuracyEvasionStages = Record<AccuracyEvasionKey, number>;

export const NEUTRAL_ACCURACY_STAGES: AccuracyEvasionStages = {
  accuracy: 0,
  evasion: 0,
};

/**
 * 급소율 단계. -6~+6 랭크가 아니라 0~3의 별도 카운터(기충전 등으로만 올라가고, 3단계에서 100% 필중).
 * critChance(lib/accuracyCrit.ts)에서 소비한다.
 */
export type CritStage = 0 | 1 | 2 | 3;
export const NEUTRAL_CRIT_STAGE: CritStage = 0;

/** Move.statChanges가 건드릴 수 있는 전체 대상: 기존 5스탯 + 명중/회피 + 급소율 */
export type EffectStatKey = BattleStatKey | AccuracyEvasionKey | "critStage";

export function isBattleStatKey(stat: EffectStatKey): stat is BattleStatKey {
  return stat === "atk" || stat === "def" || stat === "spa" || stat === "spd" || stat === "spe";
}

export function isAccuracyEvasionKey(stat: EffectStatKey): stat is AccuracyEvasionKey {
  return stat === "accuracy" || stat === "evasion";
}
