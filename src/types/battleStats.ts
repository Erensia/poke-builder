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
