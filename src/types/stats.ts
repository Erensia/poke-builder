export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** 실제 종족값이 아직 확정되지 않은 슬롯. 데이터 정리 전까지 이 값으로 채운다. */
export const TODO_STATS: BaseStats = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};
