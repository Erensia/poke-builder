import { NATURES } from "./data";
import { MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";
import { inferDefense, type InferenceInput, type InferenceResult, type NatureGroup } from "./defenseInference";
import { inferAttack, type AttackInferenceInput, type AttackInferenceResult } from "./attackInference";

/**
 * 방어·공격 역산 결합(3.1 C2-b) — 같은 상대의 두 관측 묶음("내가 입힌 데미지"→HP·방어, "내가 받은 데미지"→공격·특공)이 서로를 좁힌다.
 *  1) 성격 공유: 성격은 한 값이라 방어 쪽이 가능한 성격과 공격 쪽이 가능한 성격의 교집합만 두 쪽 모두의 후보로 쓴다.
 *  2) 포인트 예산: 합계 66을 넘을 수 없다 — 한쪽이 최소로 써야 하는 포인트를 뺀 값이 다른 쪽 합의 상한이다.
 *     (관측하지 않은 스탯은 최소 0으로 본다 — 합계를 다 쓴다는 하한은 공격·특공·스피드를 다 알아야 정해져 여기서는 쓰지 않는다.)
 * 상한은 서로의 결과로 정해지고 상한이 좁히면 결과가 다시 좁아질 수 있어서, 바뀌지 않을 때까지(최대 3번) 되풀이한다.
 */

export interface CombinedNature {
  name: string;
  /** 가능도 가중 비율(0~1, 전체 합 1) */
  weight: number;
}

export interface CombinedInference {
  defense: InferenceResult | null;
  attack: AttackInferenceResult | null;
  /** 두 쪽 관측이 모두 있고 서로 맞을 때, 합친 성격 후보(가능도 순). 아니면 null */
  natures: CombinedNature[] | null;
  /** 두 쪽이 서로 안 맞는 이유: nature = 가능한 성격이 안 겹침, points = 포인트 합이 66을 넘음. 맞으면 null */
  conflict: "nature" | "points" | null;
  /** 반영한 포인트 상한(HP+방어+특방 / 공격+특공) — 결합이 일어났을 때만 */
  budget: { defenseMax: number; attackMax: number } | null;
}

const defenseMinPoints = (r: InferenceResult) => (r.hp?.min ?? 0) + (r.def?.min ?? 0) + (r.spd?.min ?? 0);
const attackMinPoints = (r: AttackInferenceResult) => (r.atk?.min ?? 0) + (r.spa?.min ?? 0);

/** 가능한 묶음에 든 성격 이름 */
function feasibleNames(groups: NatureGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.feasible > 0).flatMap((g) => g.natureNames));
}

const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter((n) => b.has(n)));

/** 성격마다 두 쪽 묶음의 가능도(묶음 가중 ÷ 묶음 안 성격 수)를 곱해 합친 비율을 낸다 */
function combineNatures(defense: InferenceResult, attack: AttackInferenceResult): CombinedNature[] {
  const out: CombinedNature[] = [];
  for (const n of NATURES) {
    const gd = defense.groups.find((g) => g.natureNames.includes(n.name));
    const ga = attack.groups.find((g) => g.natureNames.includes(n.name));
    if (!gd || !ga || gd.feasible === 0 || ga.feasible === 0) continue;
    out.push({ name: n.name, weight: (gd.weight / gd.natureNames.length) * (ga.weight / ga.natureNames.length) });
  }
  const total = out.reduce((sum, x) => sum + x.weight, 0);
  return out.map((x) => ({ ...x, weight: total > 0 ? x.weight / total : 0 })).sort((x, y) => y.weight - x.weight);
}

export function inferCombined(defenseInput: InferenceInput | null, attackInput: AttackInferenceInput | null): CombinedInference {
  const defense0 = defenseInput ? inferDefense(defenseInput) : null;
  const attack0 = attackInput ? inferAttack(attackInput) : null;
  const plain: CombinedInference = { defense: defense0, attack: attack0, natures: null, conflict: null, budget: null };
  // 한쪽만 있거나 한쪽이 계산 불가·모순이면 결합할 게 없다(각자의 안내를 그대로 보여 준다)
  if (!defenseInput || !attackInput || !defense0 || !attack0 || defense0.status !== "ok" || attack0.status !== "ok") return plain;

  let defense = defense0;
  let attack = attack0;
  let allowed = intersect(feasibleNames(defense.groups), feasibleNames(attack.groups));
  if (allowed.size === 0) return { ...plain, conflict: "nature" };
  let budget = { defenseMax: MAX_ABILITY_POINTS_TOTAL, attackMax: MAX_ABILITY_POINTS_TOTAL };

  for (let round = 0; round < 3; round++) {
    const natureIds = NATURES.filter((n) => allowed.has(n.name)).map((n) => n.id);
    const nextBudget = {
      defenseMax: MAX_ABILITY_POINTS_TOTAL - attackMinPoints(attack),
      attackMax: MAX_ABILITY_POINTS_TOTAL - defenseMinPoints(defense),
    };
    const nextDefense = inferDefense({ ...defenseInput, natureIds, maxPointsSum: nextBudget.defenseMax }, false);
    const nextAttack = inferAttack({ ...attackInput, natureIds, maxPointsSum: nextBudget.attackMax }, false);
    if (!nextDefense || !nextAttack || nextDefense.status !== "ok" || nextAttack.status !== "ok") return { ...plain, conflict: "points" };
    const nextAllowed = intersect(feasibleNames(nextDefense.groups), feasibleNames(nextAttack.groups));
    const stable =
      nextAllowed.size === allowed.size &&
      defenseMinPoints(nextDefense) === defenseMinPoints(defense) &&
      attackMinPoints(nextAttack) === attackMinPoints(attack);
    defense = nextDefense;
    attack = nextAttack;
    allowed = nextAllowed;
    budget = nextBudget;
    if (stable || allowed.size === 0) break;
  }
  if (allowed.size === 0) return { ...plain, conflict: "nature" };
  // 관측 하나씩 따져 본 결과는 결합 전(각 쪽 관측만) 기준으로 유지한다 — 다른 쪽 제약 때문에 "이 관측만으로도 안 맞아요"로 오해되지 않게
  defense = { ...defense, singleFeasible: defense0.singleFeasible, culprits: defense0.culprits, observationErrors: defense0.observationErrors };
  attack = { ...attack, singleFeasible: attack0.singleFeasible, culprits: attack0.culprits, observationErrors: attack0.observationErrors };
  return { defense, attack, natures: combineNatures(defense, attack), conflict: null, budget };
}
