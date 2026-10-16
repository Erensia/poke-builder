import { damageRollSet, type DamageParts } from "./damageFormula";
import { hpMarks } from "./hpMagic";
import { computeRealStats, MAX_ABILITY_POINTS_PER_STAT } from "./statCalculator";
import type { BaseStats } from "../types/stats";
import type { AbilityPoints } from "../types/party";
import type { BulkMove, MatchupSlot } from "../types/matchup";

export const BULK_MOVE_SLOTS = 3;

/** 상대 슬롯의 내구 조정 기술 3칸 — 기술 칸이 생기기 전에 단일 기술(moveId)로 저장된 것은 첫 칸으로 읽는다 */
export function bulkMovesOf(slot: MatchupSlot): (BulkMove | null)[] {
  const legacy = !slot.bulkMoves && slot.moveId ? { moveId: slot.moveId, hits: slot.multiHitCount } : null;
  return Array.from({ length: BULK_MOVE_SLOTS }, (_, i) => slot.bulkMoves?.[i] ?? (i === 0 ? legacy : null));
}

/** 내구 조정(3.7 A3): 이 공격(들)을 맞아도 버티는 HP·방어·특방 포인트 조합 */
interface BulkOption {
  hpPoints: number;
  defPoints: number;
  spdPoints: number;
  maxHp: number;
  /** 방어·특방 실수치 */
  defStat: number;
  spdStat: number;
  /** 버틸 확률(0~1) */
  survival: number;
  /** HP가 최적 조건(16n+15 등)을 만족하면 가장 강한 조건 이름 */
  mark: string | null;
}

const POINTS = MAX_ABILITY_POINTS_PER_STAT;

/** 총 데미지 분포 — 값 오름차순, cum[i]는 values[0..i]의 확률 합 */
interface Dist {
  values: number[];
  probs: number[];
  cum: number[];
}

function makeDist(map: Map<number, number>): Dist {
  const values = [...map.keys()].sort((a, b) => a - b);
  const probs = values.map((v) => map.get(v)!);
  let sum = 0;
  return { values, probs, cum: probs.map((p) => (sum += p)) };
}

function distOf({ values, probs }: ReturnType<typeof damageRollSet>): Dist {
  const map = new Map<number, number>();
  values.forEach((v, k) => map.set(v, (map.get(v) ?? 0) + (probs ? probs[k] : 1 / values.length)));
  return makeDist(map);
}

/** 독립인 두 총 데미지의 합 분포 */
function convolve(a: Dist, b: Dist): Dist {
  const map = new Map<number, number>();
  a.values.forEach((x, i) => b.values.forEach((y, j) => map.set(x + y, (map.get(x + y) ?? 0) + a.probs[i] * b.probs[j])));
  return makeDist(map);
}

/** P(총 데미지 < limit) */
function below(d: Dist, limit: number): number {
  let lo = 0;
  let hi = d.values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d.values[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : d.cum[lo - 1];
}

/**
 * 공격 여러 개를 모두 맞았을 때 버틸 확률을 내는 함수를 만든다 — 같은 방어 스탯을 읽는 공격끼리 먼저 합성곱해 두고(스탯 값별 캐시),
 * 방어 쪽과 특방 쪽 두 분포는 합산 확률을 이분 탐색으로 센다.
 */
function makeSurvival(partsList: DamageParts[]) {
  const groups = { def: partsList.filter((p) => p.defenseKey === "def"), spd: partsList.filter((p) => p.defenseKey === "spd") };
  const caches = { def: new Map<number, Dist>(), spd: new Map<number, Dist>() };
  const distFor = (key: "def" | "spd", stat: number): Dist | null => {
    if (groups[key].length === 0) return null;
    let d = caches[key].get(stat);
    if (!d) caches[key].set(stat, (d = groups[key].map((p) => distOf(damageRollSet(p, stat))).reduce(convolve)));
    return d;
  };
  return {
    used: { def: groups.def.length > 0, spd: groups.spd.length > 0 },
    at(hp: number, defStat: number, spdStat: number): number {
      const a = distFor("def", defStat);
      const b = distFor("spd", spdStat);
      if (!a || !b) return below((a ?? b)!, hp);
      return a.values.reduce((sum, x, i) => sum + a.probs[i] * below(b, hp - x), 0);
    },
  };
}

/** 지금 포인트로 공격들을 모두 버틸 확률 */
export function bulkSurvival(partsList: DamageParts[], base: BaseStats, nature: string | null, points: AbilityPoints): number {
  const real = computeRealStats(base, points, nature);
  return makeSurvival(partsList).at(real.hp, real.def, real.spd);
}

/**
 * HP 포인트별로 목표 확률(target, 0~1) 이상 버티는 최소 방어+특방 포인트를 찾고, 합이 더 적어질 때만 남긴다(HP가 더 높은데 합이 같거나 많은 조합은 뺀다).
 * 공격이 방어·특방 둘 다 읽으면 합이 같은 조합 중 버틸 확률이 높은 쪽을 고른다. 결과는 세 포인트 합이 적은 순. 나머지 포인트·성격은 지금 슬롯 그대로.
 */
export function bulkOptions(partsList: DamageParts[], base: BaseStats, nature: string | null, points: AbilityPoints, target: number): BulkOption[] {
  const surv = makeSurvival(partsList);
  const marks = new Map(hpMarks(base.hp, POINTS).map((m) => [m.points, m.chain[0]?.label ?? "10n+9"]));
  const defRange = surv.used.def ? POINTS : 0;
  const spdRange = surv.used.spd ? POINTS : 0;
  const out: BulkOption[] = [];
  let lastSum = Infinity;
  for (let hpPoints = 0; hpPoints <= POINTS; hpPoints++) {
    let best: BulkOption | null = null;
    // 합이 이 값 미만인 조합만 본다: 앞 HP보다 합이 줄어야 하고, 이 HP에서 찾은 최선보다 나빠질 수 없다
    const limit = () => Math.min(lastSum, best ? best.defPoints + best.spdPoints + 1 : Infinity);
    for (let defPoints = 0; defPoints <= defRange && defPoints < limit(); defPoints++) {
      for (let spdPoints = 0; spdPoints <= spdRange && defPoints + spdPoints < limit(); spdPoints++) {
        const real = computeRealStats(base, { ...points, hp: hpPoints, def: surv.used.def ? defPoints : points.def, spd: surv.used.spd ? spdPoints : points.spd }, nature);
        const survival = surv.at(real.hp, real.def, real.spd);
        if (survival < target - 1e-9) continue;
        const bestSum = best ? best.defPoints + best.spdPoints : Infinity;
        if (defPoints + spdPoints < bestSum || survival > best!.survival + 1e-12) {
          best = { hpPoints, defPoints, spdPoints, maxHp: real.hp, defStat: real.def, spdStat: real.spd, survival, mark: marks.get(hpPoints) ?? null };
        }
        break;
      }
    }
    if (best) {
      out.push(best);
      lastSum = best.defPoints + best.spdPoints;
    }
  }
  return out.sort((a, b) => a.hpPoints + a.defPoints + a.spdPoints - (b.hpPoints + b.defPoints + b.spdPoints) || a.hpPoints - b.hpPoints);
}
