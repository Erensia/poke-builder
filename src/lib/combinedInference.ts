import { NATURES } from "./data";
import { MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";
import { createLikelihoodCache, inferDefense, type InferenceInput, type InferenceResult, type NatureGroup } from "./defenseInference";
import { inferAttack, type AttackInferenceInput, type AttackInferenceResult } from "./attackInference";
import { inferSpeed, type SpeedInferenceInput, type SpeedInferenceResult } from "./speedInference";

/**
 * 방어·공격·스피드 역산 결합(3.1 C2-b·C2-c) — 같은 상대의 관측 묶음("내가 입힌 데미지"→HP·방어, "내가 받은 데미지"→공격·특공,
 * "선후공"→스피드)이 서로를 좁힌다. 둘 이상 있을 때만 결합한다.
 *  1) 성격 공유: 성격은 한 값이라 각 쪽이 가능한 성격의 교집합만 모든 쪽의 후보로 쓴다.
 *  2) 포인트 예산: 합계 66을 넘을 수 없다 — 다른 쪽이 최소로 써야 하는 포인트를 뺀 값이 이 쪽 합의 상한이다.
 *     (관측하지 않은 스탯은 최소 0으로 본다.) 스피드의 최소는 "남은 성격 후보를 모두 고려한 최솟값"이라, 성격 후보가 줄수록 올라간다.
 *  3) 포인트 하한(3.3 V5): 합계 66은 항상 다 쓴다(사용자 결정)고 보므로, 이 쪽 합은 66에서 다른 쪽이 쓸 수 있는 최대치를 뺀 값 이상이다.
 *     관측하지 않은 스탯은 스탯당 32까지 흡수할 수 있고, 관측한 스탯은 역산된 최댓값을 쓴다. 다른 쪽을 다 관측해 좁혀야 의미 있는 하한이 나온다.
 * 상한·하한은 서로의 결과로 정해지고 한쪽이 좁히면 결과가 다시 좁아질 수 있어서, 바뀌지 않을 때까지(최대 MAX_ROUNDS번) 되풀이한다.
 */

export interface CombinedNature {
  name: string;
  /** 가능도 가중 비율(0~1, 전체 합 1) */
  weight: number;
}

/** 결합에 들어간 쪽 — 화면 안내 문구에 쓴다 */
export type CombinedPart = "defense" | "attack" | "speed";

export interface CombinedInference {
  defense: InferenceResult | null;
  attack: AttackInferenceResult | null;
  speed: SpeedInferenceResult | null;
  /** 둘 이상의 관측이 있고 서로 맞을 때, 합친 성격 후보(가능도 순). 아니면 null */
  natures: CombinedNature[] | null;
  /** 서로 안 맞는 이유: nature = 가능한 성격이 안 겹침, points = 포인트 합이 66을 넘음. 맞으면 null */
  conflict: "nature" | "points" | null;
  /** 결합에 들어간(관측이 있고 계산이 된) 쪽 */
  parts: CombinedPart[];
  /** 반영한 포인트 상한(HP+방어+특방 / 공격+특공 / 스피드) — 결합이 일어났을 때만. 결합에 안 든 쪽은 null */
  budget: { defenseMax: number | null; attackMax: number | null; speedMax: number | null; defenseMin: number; attackMin: number; speedMin: number } | null;
}

const MAX_ROUNDS = 6;
const PER_STAT = 32;

const defenseMinPoints = (r: InferenceResult | null) => (r ? (r.hp?.min ?? 0) + (r.def?.min ?? 0) + (r.spd?.min ?? 0) : 0);
const attackMinPoints = (r: AttackInferenceResult | null) => (r ? (r.atk?.min ?? 0) + (r.spa?.min ?? 0) : 0);
const speedMinPoints = (r: SpeedInferenceResult | null) => r?.spe?.min ?? 0;

// 쓸 수 있는 최대 포인트 합 — 관측하지 않은 스탯(결과 범위가 없음)은 스탯당 32, 관측 자체가 없는 쪽은 그 쪽 전체 용량
const defenseMaxPoints = (r: InferenceResult | null) => (r ? (r.hp?.max ?? PER_STAT) + (r.def?.max ?? PER_STAT) + (r.spd?.max ?? PER_STAT) : 3 * PER_STAT);
const attackMaxPoints = (r: AttackInferenceResult | null) => (r ? (r.atk?.max ?? PER_STAT) + (r.spa?.max ?? PER_STAT) : 2 * PER_STAT);
const speedMaxPoints = (r: SpeedInferenceResult | null) => (r ? (r.spe?.max ?? PER_STAT) : PER_STAT);

/** 가능한 묶음에 든 성격 이름 */
function feasibleNames(groups: NatureGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.feasible > 0).flatMap((g) => g.natureNames));
}

const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter((n) => b.has(n)));

/** 성격마다 각 쪽 묶음의 가능도(묶음 가중 ÷ 묶음 안 성격 수)를 곱해 합친 비율을 낸다 */
function combineNatures(groupLists: NatureGroup[][]): CombinedNature[] {
  const out: CombinedNature[] = [];
  for (const n of NATURES) {
    let weight = 1;
    for (const groups of groupLists) {
      const g = groups.find((x) => x.natureNames.includes(n.name));
      if (!g || g.feasible === 0) {
        weight = 0;
        break;
      }
      weight *= g.weight / g.natureNames.length;
    }
    if (weight > 0) out.push({ name: n.name, weight });
  }
  const total = out.reduce((sum, x) => sum + x.weight, 0);
  return out.map((x) => ({ ...x, weight: total > 0 ? x.weight / total : 0 })).sort((x, y) => y.weight - x.weight);
}

interface Results {
  defense: InferenceResult | null;
  attack: AttackInferenceResult | null;
  speed: SpeedInferenceResult | null;
}

const activeGroups = (r: Results): NatureGroup[][] => [r.defense?.groups, r.attack?.groups, r.speed?.groups].filter((g): g is NatureGroup[] => !!g);

function allowedNatures(r: Results): Set<string> {
  const sets = activeGroups(r).map(feasibleNames);
  return sets.reduce((acc, s) => intersect(acc, s));
}

export function inferCombined(
  defenseInput: InferenceInput | null,
  attackInput: AttackInferenceInput | null,
  speedInput: SpeedInferenceInput | null = null,
): CombinedInference {
  // 되풀이마다 성격·포인트 합 제한만 바뀌고 후보의 가능도는 그대로라 방어 쪽은 한 번 계산한 값을 재사용한다(3.6 I1-a)
  const defenseCache = createLikelihoodCache();
  const first: Results = {
    defense: defenseInput ? inferDefense(defenseInput, true, defenseCache) : null,
    attack: attackInput ? inferAttack(attackInput) : null,
    speed: speedInput ? inferSpeed(speedInput) : null,
  };
  const parts: CombinedPart[] = [];
  if (first.defense) parts.push("defense");
  if (first.attack) parts.push("attack");
  if (first.speed) parts.push("speed");
  const plain: CombinedInference = { ...first, natures: null, conflict: null, parts, budget: null };
  // 한쪽만 있거나 한쪽이라도 계산 불가·모순이면 결합할 게 없다(각자의 안내를 그대로 보여 준다)
  const statuses = [first.defense?.status, first.attack?.status, first.speed?.status].filter((s) => s !== undefined);
  if (statuses.length < 2 || statuses.some((s) => s !== "ok")) return plain;

  let cur = first;
  let allowed = allowedNatures(cur);
  if (allowed.size === 0) return { ...plain, conflict: "nature" };
  let budget: NonNullable<CombinedInference["budget"]> = { defenseMax: null, attackMax: null, speedMax: null, defenseMin: 0, attackMin: 0, speedMin: 0 };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const natureIds = NATURES.filter((n) => allowed.has(n.name)).map((n) => n.id);
    const dMin = defenseMinPoints(cur.defense);
    const aMin = attackMinPoints(cur.attack);
    const sMin = speedMinPoints(cur.speed);
    const dMax = defenseMaxPoints(cur.defense);
    const aMax = attackMaxPoints(cur.attack);
    const sMax = speedMaxPoints(cur.speed);
    const floor = (othersMax: number) => Math.max(0, MAX_ABILITY_POINTS_TOTAL - othersMax);
    const nextBudget = {
      defenseMax: cur.defense ? MAX_ABILITY_POINTS_TOTAL - aMin - sMin : null,
      attackMax: cur.attack ? MAX_ABILITY_POINTS_TOTAL - dMin - sMin : null,
      speedMax: cur.speed ? MAX_ABILITY_POINTS_TOTAL - dMin - aMin : null,
      defenseMin: floor(aMax + sMax),
      attackMin: floor(dMax + sMax),
      speedMin: floor(dMax + aMax),
    };
    const next: Results = {
      defense: defenseInput && cur.defense ? inferDefense({ ...defenseInput, natureIds, maxPointsSum: nextBudget.defenseMax!, minPointsSum: nextBudget.defenseMin }, false, defenseCache) : null,
      attack: attackInput && cur.attack ? inferAttack({ ...attackInput, natureIds, maxPointsSum: nextBudget.attackMax!, minPointsSum: nextBudget.attackMin }, false) : null,
      speed: speedInput && cur.speed ? inferSpeed({ ...speedInput, natureIds, maxPoints: nextBudget.speedMax!, minPoints: nextBudget.speedMin }, false) : null,
    };
    if ([next.defense, next.attack, next.speed].some((r) => r && r.status !== "ok")) return { ...plain, conflict: "points" };
    const nextAllowed = allowedNatures(next);
    const stable =
      nextAllowed.size === allowed.size &&
      defenseMinPoints(next.defense) === dMin &&
      attackMinPoints(next.attack) === aMin &&
      speedMinPoints(next.speed) === sMin &&
      defenseMaxPoints(next.defense) === dMax &&
      attackMaxPoints(next.attack) === aMax &&
      speedMaxPoints(next.speed) === sMax;
    cur = next;
    allowed = nextAllowed;
    budget = nextBudget;
    if (stable || allowed.size === 0) break;
  }
  if (allowed.size === 0) return { ...plain, conflict: "nature" };
  // 관측 하나씩 따져 본 결과는 결합 전(각 쪽 관측만) 기준으로 유지한다 — 다른 쪽 제약 때문에 "이 관측만으로도 안 맞아요"로 오해되지 않게
  const keep = <T extends { singleFeasible: boolean[]; culprits: number[]; observationErrors: (string | null)[] }>(after: T | null, before: T | null) =>
    after && before ? { ...after, singleFeasible: before.singleFeasible, culprits: before.culprits, observationErrors: before.observationErrors } : after;
  const defense = keep(cur.defense, first.defense);
  const attack = keep(cur.attack, first.attack);
  const speed = keep(cur.speed, first.speed);
  return { defense, attack, speed, natures: combineNatures(activeGroups({ defense, attack, speed })), conflict: null, parts, budget };
}
