import type { RollSet } from "./damageFormula";

/** 8.2 I1 평균 방식 — 상대가 몇 실수치인지 모를 때 가능한 값 전체를 가중 평균내기 위한 도우미 */

export interface WeightedStat {
  value: number;
  /** 합이 1이 되는 가중치 */
  weight: number;
}

/**
 * 상대 실수치 후보. 포인트 0~32 × 성격 보정(×0.9 / ×1 / ×1.1)에서 나오는 서로 다른 실수치를 모으고,
 * 보정은 성격 수 비율(↓ 4 : 무보정 17 : ↑ 4)로 가중한다. 포인트는 균등. range가 있으면 그 안의 값만 쓰고,
 * 범위 안에 후보가 없으면(폼이 달라 어긋난 경우) 범위를 무시한다.
 */
export function statCandidates(baseStat: number, range?: { min: number; max: number } | null): WeightedStat[] {
  const collect = (inRange: (v: number) => boolean) => {
    const byValue = new Map<number, number>();
    for (const [mult, count] of [[0.9, 4], [1, 17], [1.1, 4]] as const) {
      for (let p = 0; p <= 32; p++) {
        const v = Math.floor((baseStat + 20 + p) * mult);
        if (inRange(v)) byValue.set(v, (byValue.get(v) ?? 0) + count);
      }
    }
    return byValue;
  };
  let byValue = range ? collect((v) => v >= range.min && v <= range.max) : collect(() => true);
  if (byValue.size === 0) byValue = collect(() => true);
  let total = 0;
  for (const w of byValue.values()) total += w;
  return [...byValue].map(([value, w]) => ({ value, weight: w / total }));
}

/** 가중치로 섞은 데미지 분포 — 같은 데미지 값은 확률을 합친다. 가중치 합은 1이어야 한다 */
export function mixRollSets(sets: { rolls: RollSet; weight: number }[]): RollSet {
  const dist = new Map<number, number>();
  for (const { rolls, weight } of sets) {
    const equal = 1 / rolls.values.length;
    rolls.values.forEach((d, k) => dist.set(d, (dist.get(d) ?? 0) + weight * (rolls.probs ? rolls.probs[k] : equal)));
  }
  const values = [...dist.keys()].sort((a, b) => a - b);
  return { values, probs: values.map((d) => dist.get(d)!) };
}
