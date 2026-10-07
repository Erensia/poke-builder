import type { Move } from "../types/move";
import type { StatStages } from "../types/battleStats";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { StatusCondition } from "../types/status";
import { ABILITIES, ITEMS, NATURES, getAbility, getPokemon } from "./data";
import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import { getEffectiveForm } from "./pokemonForm";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost } from "./statusConditions";
import { damageRollTotals } from "./damageFormula";
import { evaluateSlotMatchup, type EvaluatorSlot } from "./matchupEvaluator";
import { computeRealStats, MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { inferenceUnsupportedReason, natureMult, WeightedValues, type CentralRange, type NatureGroup, type Range } from "./defenseInference";

/**
 * 상대 공격(특공) 포인트·성격 역산(3.1 C2-b) — 상대가 내게 입힌 데미지(내 HP 수치 "맞기 전 → 맞은 뒤")로 상대 공격 능력을 거꾸로 좁힌다.
 * 방어 역산(defenseInference)은 상대 HP가 정수 %로만 보여 범위가 넓지만, 내 HP는 정확한 수치라 데미지 값이 그대로 나와 훨씬 좁게 나온다.
 * 내 포켓몬(방어자)은 능력·특성·도구를 전부 알고 있어서 변수는 상대 공격(물리면 공격, 특수면 특공) 포인트·성격·난수 16단계뿐이다.
 * 후보(포인트 0~32 × 성격 보정 묶음)마다 evaluateSlotMatchup으로 데미지 조각을 만들고 정수 공식(damageRollTotals)의 16단계가
 * 관측과 맞는지 본다. 관측마다 난수는 독립이라 가능도는 (맞는 난수 수 / 16)의 곱이다.
 * 상세: docs/00_기획문서/02_backlog/03_ver.3.0/3.1-backlog.md C2-b.
 */

/** 공격(위력·공격 스탯)에 영향을 주는 특성 — 역산 화면의 "상대 공격 보정 특성 가정" 목록 */
export const ATTACK_ABILITY_CANDIDATES: Ability[] = ABILITIES.filter(
  (a) =>
    a.modifiers?.some((m) => m.scope === "offense") ||
    a.physicalAttackMultiplierWhenStatused !== undefined ||
    a.changesUserTypeToMoveType ||
    a.tradesSecondaryEffectForPower ||
    a.powerMultiplierWhenMovingLast !== undefined,
);

/** 공격에 영향을 주는 도구 — 생명의구슬·달인의띠·타입 강화·분류 강화·메트로놈 */
export const ATTACK_ITEM_CANDIDATES: Item[] = ITEMS.filter(
  (i) =>
    i.moveTypeMultiplier !== undefined ||
    i.moveCategoryMultiplier !== undefined ||
    i.powerMultiplier !== undefined ||
    i.superEffectiveMultiplier !== undefined ||
    i.consecutiveSameMoveMultiplier !== undefined,
);

export interface AttackObservation {
  /** 상대가 쓴 공격 기술 */
  move: Move;
  critical: boolean;
  /** 맞기 전 내 HP 수치 */
  hpBefore: number;
  /** 맞은 직후 내 HP 수치 (턴 종료 효과가 섞이지 않은 값) — 쓰러지면 정확한 데미지를 알 수 없어 지원하지 않는다 */
  hpAfter: number;
  /** 이 관측을 줄 때 상대가 메가진화한 상태면 그 메가폼 이름. 없으면 `attacker`의 폼. 메가폼은 공격 종족값·특성이 달라진다 */
  megaForm?: string;
}

export interface AttackInferenceInput {
  /**
   * 상대 포켓몬의 종·폼. ability/item은 "이렇다고 가정"한 값(모르면 null — 생명의구슬·달인의띠·테크니션 등 공격 보정은 가정으로 넣는다),
   * nature/points는 무시한다(역산 대상). 관측에 메가폼 태그(`megaForm`)가 하나라도 있으면 메가스톤을 들고 있었던 것이라 모든 관측에서
   * 도구 가정을 끄고, 태그가 붙은 관측은 그 메가폼의 특성으로 계산한다.
   */
  attacker: EvaluatorSlot;
  /** 내 포켓몬 — 능력(포인트·성격)·특성·도구를 전부 알고 있는 방어자 */
  defender: EvaluatorSlot;
  observations: AttackObservation[];
  /** 상대 공격 랭크 */
  attackerStages?: StatStages;
  /** 상대의 주 상태이상 (화상이면 물리 공격 반감, 근성·객기는 예외) */
  attackerStatus?: StatusCondition | null;
  /** 내 랭크 */
  defenderStages?: StatStages;
  weather?: WeatherKind;
  field?: FieldKind;
  screen?: "reflect" | "lightScreen" | "auroraVeil";
  /** 후보로 볼 성격 id 목록 — 방어 역산이 이미 걸러낸 성격을 넘겨 같은 상대의 성격을 공유한다. 생략하면 전부 */
  natureIds?: readonly string[];
  /** 공격+특공 포인트 합의 상한 — 방어 쪽(HP+방어+특방)이 이미 쓴 최소 포인트를 뺀 값(포인트 예산). 생략하면 66 */
  maxPointsSum?: number;
}

export interface AttackInferenceResult {
  status: "ok" | "contradiction" | "invalid";
  /** invalid 사유(관측마다). 없으면 null */
  observationErrors: (string | null)[];
  /** 각 관측 하나만으로도 가능한 후보가 있는가 (invalid면 false) */
  singleFeasible: boolean[];
  /** contradiction일 때, 이 관측 하나를 빼면 가능해지는 관측 번호(0부터) */
  culprits: number[];
  /** 전체 후보 수·관측과 맞는 후보 수(관측이 쓰는 쪽 스탯만 센다) */
  total: number;
  feasible: number;
  /** 공격·특공 포인트 가능 범위(그 스탯을 쓰는 관측이 없으면 null) */
  atk: Range | null;
  spa: Range | null;
  /** 가능도 가중 중심 구간(10%~90%)과 중앙값 */
  atkCentral: CentralRange | null;
  spaCentral: CentralRange | null;
  /** 상대 공격·특공 실수치 범위(참고용) */
  realAtk: Range | null;
  realSpa: Range | null;
  /** 공격·특공 보정 묶음별 가능 여부·가능도 가중 비율 — 방어 역산의 성격 묶음과 같은 모양 */
  groups: NatureGroup[];
}

type AttackKey = "atk" | "spa";

interface NatureCombo {
  key: string;
  atkMult: number;
  spaMult: number;
  label: string;
  natureNames: string[];
  /** 이 묶음의 대표 성격(evaluateSlotMatchup 호출용) */
  repNatureId: string;
}

interface PreparedObservation {
  key: AttackKey;
  /** 이 관측 시점 폼의 공격·특공 종족값(결과의 실수치 범위 표시용) */
  baseStat: number;
  /** 이 관측에서 받은 데미지 */
  damage: number;
  /** 후보(성격·포인트)로 상대 슬롯을 만들어 이 관측의 16단계 난수 데미지를 낸다. 계산할 수 없으면 null */
  rolls: (natureId: string, points: number) => number[] | null;
}

/** 이 관측이 읽는 상대 공격 스탯 — 물리는 공격, 특수는 특공 */
const attackKeyOf = (move: Move): AttackKey => (move.category === "special" ? "spa" : "atk");

/** 스피드·HP 등 상대의 다른 스탯으로 위력이 정해져 공격 포인트만으로는 계산할 수 없는 기술을 거른다 */
export function attackInferenceUnsupportedReason(move: Move): string | null {
  const base = inferenceUnsupportedReason(move);
  if (base) return base;
  if (move.gyroBallPower || move.electroBallPower) return "스피드로 위력이 정해지는 기술은 아직 지원하지 않아요";
  if (move.power === null) return "위력이 상황에 따라 달라지는 기술은 아직 지원하지 않아요";
  return null;
}

/** 상대 공격·특공 보정 묶음(성격 15종 → 관측이 쓰는 스탯의 보정이 같은 것끼리) */
function buildNatureCombos(useAtk: boolean, useSpa: boolean, allowed?: ReadonlySet<string>): NatureCombo[] {
  const map = new Map<string, NatureCombo>();
  for (const n of NATURES) {
    if (allowed && !allowed.has(n.id)) continue;
    const atkMult = useAtk ? natureMult("atk", n.increased, n.decreased) : 1;
    const spaMult = useSpa ? natureMult("spa", n.increased, n.decreased) : 1;
    const key = `${atkMult}|${spaMult}`;
    let combo = map.get(key);
    if (!combo) {
      const parts: string[] = [];
      if (useAtk) parts.push(atkMult > 1 ? "공격↑" : atkMult < 1 ? "공격↓" : "");
      if (useSpa) parts.push(spaMult > 1 ? "특공↑" : spaMult < 1 ? "특공↓" : "");
      const label = parts.filter(Boolean).join("·") || (useAtk && useSpa ? "공격·특공 보정 없음" : useAtk ? "공격 보정 없음" : "특공 보정 없음");
      combo = { key, atkMult, spaMult, label, natureNames: [], repNatureId: n.id };
      map.set(key, combo);
    }
    combo.natureNames.push(n.name);
  }
  return [...map.values()];
}

function emptyResult(status: AttackInferenceResult["status"], n: number): AttackInferenceResult {
  return {
    status,
    observationErrors: Array(n).fill(null),
    singleFeasible: Array(n).fill(false),
    culprits: [],
    total: 0,
    feasible: 0,
    atk: null,
    spa: null,
    atkCentral: null,
    spaCentral: null,
    realAtk: null,
    realSpa: null,
    groups: [],
  };
}

/** 관측마다 내 HP·상성·특성 상태를 확인하고, 후보로 데미지 난수를 내는 함수를 만든다. 실패하면 사유 문자열 */
function prepareObservations(input: AttackInferenceInput): { prepared: PreparedObservation[]; errors: (string | null)[] } {
  const { attacker, defender, observations, attackerStages, attackerStatus, defenderStages, weather, field, screen } = input;
  const prepared: PreparedObservation[] = [];
  const errors: (string | null)[] = [];
  const myPokemon = getPokemon(defender.pokemonId);
  const myMaxHp = myPokemon ? computeRealStats(getEffectiveForm(myPokemon, defender).baseStats, defender.points, defender.nature).hp : 0;
  const attackerPokemon = getPokemon(attacker.pokemonId);
  // 메가 전·후를 섞은 관측이면 메가스톤 보유 → 공격 보정 도구 가정을 모든 관측에서 끈다
  const hasMega = observations.some((o) => o.megaForm);
  const baseAttacker: EvaluatorSlot = { ...attacker, item: hasMega ? null : attacker.item };
  let itemConsumed = false;

  observations.forEach((obs) => {
    const unsupported = attackInferenceUnsupportedReason(obs.move);
    if (unsupported) {
      errors.push(unsupported);
      return;
    }
    const mega = obs.megaForm ? attackerPokemon?.megaEvolutions?.find((m) => m.form === obs.megaForm) : undefined;
    if (obs.megaForm && !mega) {
      errors.push("이 포켓몬에게 없는 메가폼이에요");
      return;
    }
    const attackerAtHit: EvaluatorSlot = mega ? { ...baseAttacker, activeMegaForm: mega.form, ability: mega.ability } : baseAttacker;
    const probe: EvaluatorSlot = { ...attackerAtHit, nature: null, points: { ...EMPTY_ABILITY_POINTS } };
    if (!(Number.isInteger(obs.hpBefore) && Number.isInteger(obs.hpAfter)) || obs.hpBefore < 1 || obs.hpAfter < 0) {
      errors.push("HP는 1 이상의 정수여야 해요");
      return;
    }
    if (obs.hpBefore > myMaxHp) {
      errors.push(`맞기 전 HP가 내 최대 HP(${myMaxHp})보다 클 수 없어요`);
      return;
    }
    if (obs.hpAfter >= obs.hpBefore) {
      errors.push("맞은 뒤 HP가 맞기 전 HP보다 작아야 해요");
      return;
    }
    if (obs.hpAfter === 0) {
      errors.push("쓰러진 공격은 정확한 데미지를 알 수 없어 지원하지 않아요");
      return;
    }
    const options = {
      attackerStages,
      defenderStages,
      weather,
      field,
      screen,
      critical: obs.critical,
      // 멀티스케일 등: 내 HP가 가득 찼을 때의 첫 피격
      defenderHpIsFull: obs.hpBefore >= myMaxHp,
      defenderItemConsumed: itemConsumed,
      attackerStatus: attackerStatus ?? null,
      // 근성류 상승은 위력 단계, 화상 ×0.5는 최종 단계(2.4 B3) — 방어 역산과 같은 처리
      extraOffenseMultiplier: statusedAttackBoost(
        attackerStatus ?? null,
        obs.move.category,
        attackerAtHit.ability ? getAbility(attackerAtHit.ability)?.physicalAttackMultiplierWhenStatused : undefined,
      ),
      finalOffenseMultiplier: burnDamageMultiplier(attackerStatus ?? null, obs.move.category, ignoresBurnAttackPenalty(attackerAtHit.ability ?? undefined, obs.move.id)),
    };
    const res = evaluateSlotMatchup(probe, obs.move, defender, { ...options, skipVerdict: true });
    if (!res || !res.damageParts) {
      errors.push("이 기술로는 데미지를 계산할 수 없어요");
      return;
    }
    if (res.damageParts.typeEffectiveness === 0) {
      errors.push("내게 효과가 없는 기술이에요 (타입 면역)");
      return;
    }
    if (res.berryBulkMultiplier > 1) itemConsumed = true;
    const memo = new Map<string, number[] | null>();
    const baseStats = getEffectiveForm(attackerPokemon!, attackerAtHit).baseStats;
    prepared.push({
      key: attackKeyOf(obs.move),
      baseStat: baseStats[attackKeyOf(obs.move)],
      damage: obs.hpBefore - obs.hpAfter,
      rolls: (natureId, points) => {
        const memoKey = `${natureId}|${points}`;
        if (memo.has(memoKey)) return memo.get(memoKey)!;
        const slot: EvaluatorSlot = { ...attackerAtHit, nature: natureId, points: { ...EMPTY_ABILITY_POINTS, [attackKeyOf(obs.move)]: points } };
        const r = evaluateSlotMatchup(slot, obs.move, defender, { ...options, skipVerdict: true });
        const rolls = r?.damageParts ? damageRollTotals(r.damageParts, r.defenseStat) : null;
        memo.set(memoKey, rolls);
        return rolls;
      },
    });
    errors.push(null);
  });
  return { prepared, errors };
}

/** 후보(성격 묶음 c, 이 스탯 포인트 p)가 이 스탯을 쓰는 관측 전체와 얼마나 맞는지(가능도, 0~1). 0이면 불가능 */
function sideLikelihood(prepared: PreparedObservation[], key: AttackKey, combo: NatureCombo, points: number): number {
  let likelihood = 1;
  for (const o of prepared) {
    if (o.key !== key) continue;
    const rolls = o.rolls(combo.repNatureId, points);
    if (!rolls) return 0;
    const hit = rolls.filter((d) => d === o.damage).length;
    if (hit === 0) return 0;
    likelihood *= hit / rolls.length;
  }
  return likelihood;
}

function runCandidates(input: AttackInferenceInput, prepared: PreparedObservation[]): AttackInferenceResult {
  const n = prepared.length;
  const pokemon = getPokemon(input.attacker.pokemonId);
  if (!pokemon) return emptyResult("invalid", n);
  // 실수치 범위(표시용)는 그 스탯을 쓴 마지막 관측(현재 폼)의 종족값 기준
  const baseOf = (key: AttackKey) => prepared.findLast((o) => o.key === key)?.baseStat ?? getEffectiveForm(pokemon, input.attacker).baseStats[key];
  const useAtk = prepared.some((o) => o.key === "atk");
  const useSpa = prepared.some((o) => o.key === "spa");
  const combos = buildNatureCombos(useAtk, useSpa, input.natureIds ? new Set(input.natureIds) : undefined);
  const maxSum = Math.min(MAX_ABILITY_POINTS_TOTAL, input.maxPointsSum ?? MAX_ABILITY_POINTS_TOTAL);
  const groups: NatureGroup[] = combos.map((c) => ({ id: c.key, label: c.label, natureNames: c.natureNames, feasible: 0, total: 0, weight: 0 }));
  const pointRange = Array.from({ length: MAX_ABILITY_POINTS_PER_STAT + 1 }, (_, p) => p);
  const emptyRange = (): Range => ({ min: Infinity, max: -Infinity });
  const [atkRange, spaRange, realAtk, realSpa] = Array.from({ length: 4 }, emptyRange);
  const grow = (r: Range, v: number) => {
    r.min = Math.min(r.min, v);
    r.max = Math.max(r.max, v);
  };
  const atkW = new WeightedValues();
  const spaW = new WeightedValues();
  let total = 0;
  let feasible = 0;
  let totalWeight = 0;

  combos.forEach((combo, c) => {
    // 관측이 쓰는 쪽만 센다 — 안 쓰는 쪽은 한 칸(=그냥 통과)
    const atkCandidates = useAtk ? pointRange : [0];
    const spaCandidates = useSpa ? pointRange : [0];
    total += atkCandidates.length * spaCandidates.length;
    groups[c].total += atkCandidates.length * spaCandidates.length;
    const atkL = atkCandidates.map((p) => (useAtk ? sideLikelihood(prepared, "atk", combo, p) : 1));
    const spaL = spaCandidates.map((p) => (useSpa ? sideLikelihood(prepared, "spa", combo, p) : 1));
    // 공격+특공 포인트 합이 상한을 넘는 쌍은 뺀다(포인트 예산). 한 가지만 쓰는 관측이면 그 포인트 하나가 상한 이하여야 한다
    const atkWeight = new Float64Array(atkCandidates.length);
    const spaWeight = new Float64Array(spaCandidates.length);
    let comboWeight = 0;
    let okPairs = 0;
    atkCandidates.forEach((a, i) => {
      if (atkL[i] <= 0) return;
      spaCandidates.forEach((b, j) => {
        if (spaL[j] <= 0 || a + b > maxSum) return;
        const w = atkL[i] * spaL[j];
        okPairs++;
        comboWeight += w;
        atkWeight[i] += w;
        spaWeight[j] += w;
        if (useAtk) {
          grow(atkRange, a);
          grow(realAtk, Math.floor((baseOf("atk") + 20 + a) * combo.atkMult));
        }
        if (useSpa) {
          grow(spaRange, b);
          grow(realSpa, Math.floor((baseOf("spa") + 20 + b) * combo.spaMult));
        }
      });
    });
    if (okPairs === 0) return;
    feasible += okPairs;
    groups[c].feasible += okPairs;
    totalWeight += comboWeight;
    groups[c].weight += comboWeight;
    if (useAtk) atkCandidates.forEach((p, i) => atkWeight[i] > 0 && atkW.add(p, atkWeight[i]));
    if (useSpa) spaCandidates.forEach((p, j) => spaWeight[j] > 0 && spaW.add(p, spaWeight[j]));
  });

  if (totalWeight > 0) for (const g of groups) g.weight /= totalWeight;
  const range = (r: Range): Range | null => (r.min === Infinity ? null : r);
  return {
    status: feasible > 0 ? "ok" : "contradiction",
    observationErrors: Array(n).fill(null),
    singleFeasible: Array(n).fill(true),
    culprits: [],
    total,
    feasible,
    atk: useAtk ? range(atkRange) : null,
    spa: useSpa ? range(spaRange) : null,
    atkCentral: useAtk ? atkW.central() : null,
    spaCentral: useSpa ? spaW.central() : null,
    realAtk: useAtk ? range(realAtk) : null,
    realSpa: useSpa ? range(realSpa) : null,
    groups,
  };
}

/**
 * 관측 전체와 맞는 상대 공격(특공) 포인트·성격 묶음을 좁힌다. 관측이 없으면 null.
 * 관측 사이에 내 HP가 회복하지 않았다고 가정한다(관측마다 맞기 전 HP를 직접 받으므로 사실상 상관없다).
 */
export function inferAttack(input: AttackInferenceInput, diagnostics = true): AttackInferenceResult | null {
  const total = input.observations.length;
  if (total === 0) return null;
  const { prepared, errors } = prepareObservations(input);
  if (errors.some((e) => e !== null)) return { ...emptyResult("invalid", total), observationErrors: errors };
  const result = runCandidates(input, prepared);
  result.observationErrors = errors;
  if (total > 1 && diagnostics) {
    result.singleFeasible = prepared.map((o) => runCandidates(input, [o]).status === "ok");
    if (result.status === "contradiction") {
      result.culprits = prepared
        .map((_, skip) => skip)
        .filter((skip) => runCandidates(input, prepared.filter((__, i) => i !== skip)).status === "ok");
    }
  }
  return result;
}
