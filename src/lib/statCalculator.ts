import type { BaseStats } from "../types/stats";
import type { AbilityPoints } from "../types/party";
import { getNature } from "./data";

/** 챔피언스 능력 포인트 합산 최대치 (본가 노력치 510의 축약판, 레벨/개체값 없음) */
export const MAX_ABILITY_POINTS_TOTAL = 66;

/** 한 스탯에 배분 가능한 능력 포인트 최대치 */
export const MAX_ABILITY_POINTS_PER_STAT = 32;

export function totalAbilityPoints(points: AbilityPoints): number {
  return points.hp + points.atk + points.def + points.spa + points.spd + points.spe;
}

/**
 * 챔피언스 전용 실수치 계산.
 *  HP        = 종족값 + 75 + 포인트
 *  그 외 스탯 = (종족값 + 20 + 포인트) × 성격보정(1.1 / 0.9 / 1.0)
 * 레벨·개체값 개념은 챔피언스에 없다.
 */
export function computeRealStats(
  base: BaseStats,
  points: AbilityPoints,
  natureId: string | null,
): BaseStats {
  const nature = natureId ? getNature(natureId) : undefined;

  function natureMultiplier(stat: Exclude<keyof BaseStats, "hp">): number {
    if (!nature) return 1;
    if (nature.increased === stat) return 1.1;
    if (nature.decreased === stat) return 0.9;
    return 1;
  }

  return {
    hp: Math.floor(base.hp + 75 + points.hp),
    atk: Math.floor((base.atk + 20 + points.atk) * natureMultiplier("atk")),
    def: Math.floor((base.def + 20 + points.def) * natureMultiplier("def")),
    spa: Math.floor((base.spa + 20 + points.spa) * natureMultiplier("spa")),
    spd: Math.floor((base.spd + 20 + points.spd) * natureMultiplier("spd")),
    spe: Math.floor((base.spe + 20 + points.spe) * natureMultiplier("spe")),
  };
}
