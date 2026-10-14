import { damageRollSet, type DamageParts } from "./damageFormula";
import { hpMarks } from "./hpMagic";
import { computeRealStats, MAX_ABILITY_POINTS_PER_STAT } from "./statCalculator";
import type { BaseStats } from "../types/stats";
import type { AbilityPoints } from "../types/party";

/** 내구 조정(3.7 A3): 이 공격을 맞아도 버티는 HP·방어(또는 특방) 포인트 조합 */
export interface BulkOption {
  hpPoints: number;
  defPoints: number;
  maxHp: number;
  /** 이 공격이 읽는 방어 스탯(방어 또는 특방) 실수치 */
  stat: number;
  /** 버틸 확률(0~1) */
  survival: number;
  /** HP가 최적 조건(16n+15 등)을 만족하면 가장 강한 조건 이름 */
  mark: string | null;
}

const POINTS = MAX_ABILITY_POINTS_PER_STAT;

/** 데미지 분포에서 총 데미지가 hp 미만일 확률 */
export function survivalAt({ values, probs }: ReturnType<typeof damageRollSet>, hp: number): number {
  return values.reduce((sum, v, k) => sum + (v < hp ? (probs ? probs[k] : 1 / values.length) : 0), 0);
}

/**
 * HP 포인트별로 목표 확률(target, 0~1) 이상 버티는 최소 방어 포인트를 찾고, 같은 방어 포인트면 HP가 더 낮은 쪽만 남긴다.
 * 결과는 HP·방어 포인트 합이 적은 순. 나머지 포인트·성격은 지금 슬롯 그대로.
 */
export function bulkOptions(parts: DamageParts, base: BaseStats, nature: string | null, points: AbilityPoints, target: number): BulkOption[] {
  const key = parts.defenseKey;
  const rolls = new Map<number, ReturnType<typeof damageRollSet>>();
  const marks = new Map(hpMarks(base.hp, POINTS).map((m) => [m.points, m.chain[0]?.label ?? "10n+9"]));
  const out: BulkOption[] = [];
  let lastDef = POINTS + 1;
  for (let hpPoints = 0; hpPoints <= POINTS; hpPoints++) {
    for (let defPoints = 0; defPoints < lastDef; defPoints++) {
      const real = computeRealStats(base, { ...points, hp: hpPoints, [key]: defPoints }, nature);
      const stat = real[key];
      let set = rolls.get(stat);
      if (!set) rolls.set(stat, (set = damageRollSet(parts, stat)));
      const survival = survivalAt(set, real.hp);
      if (survival < target - 1e-9) continue;
      out.push({ hpPoints, defPoints, maxHp: real.hp, stat, survival, mark: marks.get(hpPoints) ?? null });
      lastDef = defPoints;
      break;
    }
  }
  return out.sort((a, b) => a.hpPoints + a.defPoints - (b.hpPoints + b.defPoints) || a.hpPoints - b.hpPoints);
}
