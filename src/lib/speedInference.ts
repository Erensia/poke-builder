import type { StatusCondition } from "../types/status";
import type { StatStages } from "../types/battleStats";
import { NEUTRAL_STAGES } from "../types/battleStats";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import { ABILITIES, ITEMS, NATURES, getPokemon } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import { evaluateSpeedMatchup, type EvaluatorSlot } from "./matchupEvaluator";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import {
  emptyRange,
  finishRange,
  growRange,
  natureMult,
  viewForms,
  WeightedValues,
  type CentralRange,
  type FormView,
  type NatureGroup,
  type Range,
} from "./defenseInference";

/**
 * 상대 스피드 포인트·성격 보정 역산(3.1 C2-c) — "이번 턴 누가 먼저 움직였나"(우선도가 같은 기술끼리)로 상대 스피드를 좁힌다.
 * 관측은 숫자가 아니라 부등식이다: 내가 먼저 → 상대 실효 스피드 ≤ 내 실효 스피드, 상대가 먼저 → ≥ (트릭룸이면 방향이 반대).
 * 완전 동속은 랜덤이라 어느 쪽 결과든 가능하지만 가능도는 ½이다. 한 번의 관측은 "이 값보다 빠르다/느리다"만 알려 주고,
 * 조건(랭크·순풍·스카프 등)이 다른 관측을 모을수록 구간이 좁아진다.
 * 실효 스피드는 기존 선후공 판정(evaluateSpeedMatchup — 엔진 computeTurnOrderSpeed 미러)을 그대로 쓴다.
 * 상세: docs/00_기획문서/02_backlog/03_ver.3.0/3.1-backlog.md C2-c.
 */

/** 선후공 관측 하나의 조건 — 행마다 다르다(턴마다 순풍·랭크·마비 등이 달라질 수 있다) */
export interface SpeedConditions {
  trickRoom: boolean;
  myTailwind: boolean;
  oppTailwind: boolean;
  myParalyzed: boolean;
  oppParalyzed: boolean;
  /** 마비 외 상태이상(화상·독 등) — 속보 특성일 때만 스피드에 영향을 준다(×1.5). 마비 체크가 우선 */
  myOtherStatus: boolean;
  oppOtherStatus: boolean;
  /** 상대 스피드 랭크(-6~6) */
  oppStage: number;
  /** 상대 속도 보정 도구 가정(구애스카프·검은철구). 모르면 null */
  oppItemId: string | null;
  /** 상대 속도 보정 특성 가정(엽록소류·곡예·서핑테일·시간벌기). 모르면 null */
  oppAbilityId: string | null;
  /** 곡예 발동 후(도구를 잃은 뒤)라고 가정 — 상대 스피드 ×2. 상대 특성이 곡예일 때만 의미가 있다 */
  oppUnburden: boolean;
}

export const NEUTRAL_SPEED_CONDITIONS: SpeedConditions = {
  trickRoom: false,
  myTailwind: false,
  oppTailwind: false,
  myParalyzed: false,
  oppParalyzed: false,
  myOtherStatus: false,
  oppOtherStatus: false,
  oppStage: 0,
  oppItemId: null,
  oppAbilityId: null,
  oppUnburden: false,
};

export interface SpeedObservation {
  /** 이번 턴 먼저 움직인 쪽 (우선도가 같은 기술끼리) */
  first: "me" | "opponent";
  conditions: SpeedConditions;
  /** 이 관측 때 상대가 메가진화한 상태면 그 메가폼 이름(스피드 종족값·특성이 달라진다). 없으면 `attacker`의 폼 */
  megaForm?: string;
}

export interface SpeedInferenceInput {
  /** 상대 포켓몬의 종·폼. 특성·도구·성격·포인트는 무시한다(조건과 역산 대상) */
  attacker: EvaluatorSlot;
  /** 내 포켓몬 — 스피드(포인트·성격)·특성·도구를 전부 알고 있는 쪽 */
  defender: EvaluatorSlot;
  /** 내 스피드 랭크 등 */
  defenderStages?: StatStages;
  weather?: WeatherKind;
  field?: FieldKind;
  observations: SpeedObservation[];
  /** 후보로 볼 성격 id 목록 — 다른 역산이 이미 걸러낸 성격(성격 공유). 생략하면 전부 */
  natureIds?: readonly string[];
  /** 스피드 포인트 상한 — 합계 66에서 다른 스탯의 최소를 뺀 값(포인트 예산). 생략하면 32 */
  maxPoints?: number;
  /** 다른 쪽 관측(방어·공격)에 쓰인 메가폼 이름 — 이 쪽에 메가 태그가 없어도 메가 전·후를 나란히 보이려고 받는다(3.1 L1-b) */
  viewMegaForms?: readonly string[];
}

export interface SpeedInferenceResult {
  status: "ok" | "contradiction" | "invalid";
  observationErrors: (string | null)[];
  singleFeasible: boolean[];
  culprits: number[];
  /** 전체 후보 수(스피드 보정 묶음 × 포인트 0~32)·관측과 맞는 후보 수 */
  total: number;
  feasible: number;
  /** 스피드 포인트 가능 범위·가능도 가중 중심 구간 */
  spe: Range | null;
  speCentral: CentralRange | null;
  /** 상대 스피드 실수치 범위(마지막 관측 폼 기준, 조건 배율 전) */
  realSpe: Range | null;
  /** 스피드 보정(↑/↓/없음) 묶음별 가능 여부·가능도 가중 */
  groups: NatureGroup[];
  /** 메가 전·후 스피드 실수치 나란히 보기(3.1 L1-b) — 메가 태그가 없으면 빈 배열 */
  formViews: FormView[];
}

/** 속도 보정 특성 후보 — 날씨·필드 속도 특성, 곡예(발동 후 ×2), 시간벌기(항상 마지막), 속보(상태이상 ×1.5) */
export const SPEED_ABILITY_CANDIDATES: Ability[] = ABILITIES.filter(
  (a) =>
    a.weatherSpeedMultiplier !== undefined ||
    a.fieldSpeedMultiplier !== undefined ||
    a.speedMultiplierWhenStatused !== undefined ||
    a.movesLastInPriorityBracket ||
    a.id === "곡예",
);

/** 조건 체크 → 선후공 판정용 상태이상. 마비 외에는 화상으로 대신한다(속도에는 화상이 영향 없고 속보만 "상태이상"으로 본다) */
function statusOf(paralyzed: boolean, other: boolean): StatusCondition | null {
  return paralyzed ? "paralysis" : other ? "burn" : null;
}

/** 속도 보정 도구 후보 — 구애스카프(×1.5)·검은철구(×0.5) */
export const SPEED_ITEM_CANDIDATES: Item[] = ITEMS.filter((i) => i.speedMultiplier !== undefined);

interface SpeedCombo {
  key: string;
  mult: number;
  label: string;
  natureNames: string[];
  repNatureId: string;
}

interface PreparedObservation {
  first: "me" | "opponent";
  /** 이 관측 시점 상대 폼의 스피드 종족값(표시용) */
  baseSpe: number;
  /** 후보(성격·스피드 포인트)가 이 관측과 맞는 정도(0 = 불가능, ½ = 동속, 1 = 맞음) */
  fit: (natureId: string, points: number) => number;
}

function buildCombos(allowed?: ReadonlySet<string>): SpeedCombo[] {
  const map = new Map<string, SpeedCombo>();
  for (const n of NATURES) {
    if (allowed && !allowed.has(n.id)) continue;
    const mult = natureMult("spe", n.increased, n.decreased);
    const key = String(mult);
    let combo = map.get(key);
    if (!combo) {
      combo = { key, mult, label: mult > 1 ? "스피드↑" : mult < 1 ? "스피드↓" : "스피드 보정 없음", natureNames: [], repNatureId: n.id };
      map.set(key, combo);
    }
    combo.natureNames.push(n.name);
  }
  return [...map.values()];
}

function emptyResult(status: SpeedInferenceResult["status"], n: number): SpeedInferenceResult {
  return { status, observationErrors: Array(n).fill(null), singleFeasible: Array(n).fill(false), culprits: [], total: 0, feasible: 0, spe: null, speCentral: null, realSpe: null, groups: [], formViews: [] };
}

function prepareObservations(input: SpeedInferenceInput): { prepared: PreparedObservation[]; errors: (string | null)[] } {
  const { attacker, defender, defenderStages, weather, field, observations } = input;
  const pokemon = getPokemon(attacker.pokemonId);
  const prepared: PreparedObservation[] = [];
  const errors: (string | null)[] = [];
  // 메가 태그가 하나라도 있으면 메가스톤을 들고 있었던 것 — 모든 관측에서 도구 가정을 끈다(방어·공격 역산과 같은 규칙)
  const hasMega = observations.some((o) => o.megaForm);
  observations.forEach((obs) => {
    const c = obs.conditions;
    const mega = obs.megaForm ? pokemon?.megaEvolutions?.find((m) => m.form === obs.megaForm) : undefined;
    if (obs.megaForm && !mega) {
      errors.push("이 포켓몬에게 없는 메가폼이에요");
      return;
    }
    if (!Number.isInteger(c.oppStage) || c.oppStage < -6 || c.oppStage > 6) {
      errors.push("스피드 랭크는 -6~+6 정수여야 해요");
      return;
    }
    const base: EvaluatorSlot = { ...attacker, item: hasMega ? null : c.oppItemId, ability: mega ? mega.ability : c.oppAbilityId };
    const atHit: EvaluatorSlot = mega ? { ...base, activeMegaForm: mega.form } : base;
    const baseSpe = getEffectiveForm(pokemon!, atHit).baseStats.spe;
    prepared.push({
      first: obs.first,
      baseSpe,
      fit: (natureId, points) => {
        const slot: EvaluatorSlot = { ...atHit, nature: natureId, points: { ...EMPTY_ABILITY_POINTS, spe: points } };
        const res = evaluateSpeedMatchup(slot, defender, {
          weather,
          field,
          attackerStatus: statusOf(c.oppParalyzed, c.oppOtherStatus),
          defenderStatus: statusOf(c.myParalyzed, c.myOtherStatus),
          attackerTailwind: c.oppTailwind,
          defenderTailwind: c.myTailwind,
          attackerUnburden: c.oppUnburden,
          trickRoom: c.trickRoom,
          attackerStages: { ...NEUTRAL_STAGES, spe: c.oppStage },
          defenderStages,
        });
        if (!res) return 0;
        if (res.firstMover === "tie") return 0.5;
        return (res.firstMover === "attacker") === (obs.first === "opponent") ? 1 : 0;
      },
    });
    errors.push(null);
  });
  return { prepared, errors };
}

function runCandidates(input: SpeedInferenceInput, prepared: PreparedObservation[]): SpeedInferenceResult {
  const n = prepared.length;
  const pokemon = getPokemon(input.attacker.pokemonId);
  if (!pokemon) return emptyResult("invalid", n);
  const combos = buildCombos(input.natureIds ? new Set(input.natureIds) : undefined);
  const groups: NatureGroup[] = combos.map((c) => ({ id: c.key, label: c.label, natureNames: c.natureNames, feasible: 0, total: 0, weight: 0 }));
  const maxPoints = Math.min(MAX_ABILITY_POINTS_PER_STAT, input.maxPoints ?? MAX_ABILITY_POINTS_TOTAL);
  const lastBase = prepared[prepared.length - 1]?.baseSpe ?? getEffectiveForm(pokemon, input.attacker).baseStats.spe;
  const speRange = emptyRange();
  const realRange = emptyRange();
  const formAcc = viewForms(pokemon, input.attacker, input.observations.map((o) => o.megaForm), input.viewMegaForms).map((f) => ({ f, real: emptyRange() }));
  const speW = new WeightedValues();
  let total = 0;
  let feasible = 0;
  let totalWeight = 0;
  combos.forEach((combo, c) => {
    for (let p = 0; p <= MAX_ABILITY_POINTS_PER_STAT; p++) {
      total++;
      groups[c].total++;
      if (p > maxPoints) continue;
      let likelihood = 1;
      for (const o of prepared) {
        likelihood *= o.fit(combo.repNatureId, p);
        if (likelihood === 0) break;
      }
      if (likelihood === 0) continue;
      feasible++;
      groups[c].feasible++;
      groups[c].weight += likelihood;
      totalWeight += likelihood;
      speW.add(p, likelihood);
      growRange(speRange, p);
      growRange(realRange, Math.floor((lastBase + 20 + p) * combo.mult));
      for (const x of formAcc) growRange(x.real, Math.floor((x.f.baseStats.spe + 20 + p) * combo.mult));
    }
  });
  if (totalWeight > 0) for (const g of groups) g.weight /= totalWeight;
  return {
    status: feasible > 0 ? "ok" : "contradiction",
    observationErrors: Array(n).fill(null),
    singleFeasible: Array(n).fill(true),
    culprits: [],
    total,
    feasible,
    spe: feasible > 0 ? speRange : null,
    speCentral: speW.central(),
    realSpe: feasible > 0 ? realRange : null,
    groups,
    formViews: formAcc.map((x) => ({ form: x.f.form, label: x.f.label, real: { spe: finishRange(x.real) ?? undefined } })),
  };
}

/**
 * 선후공 관측 전체와 맞는 상대 스피드 포인트·스피드 보정 묶음을 좁힌다. 관측이 없으면 null.
 * `diagnostics`를 끄면 관측별 단독 가능 여부·모순 원인 계산을 건너뛴다(결합 재계산용).
 */
export function inferSpeed(input: SpeedInferenceInput, diagnostics = true): SpeedInferenceResult | null {
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
