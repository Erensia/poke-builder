import type { Move } from "../types/move";
import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import type { StatStages } from "../types/battleStats";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { StatusCondition } from "../types/status";
import { ABILITIES, ITEMS, NATURES, getAbility, getPokemon } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import { computeStatusAttackMultiplier, ignoresBurnAttackPenalty } from "./statusConditions";
import { evaluateSlotMatchup, type EvaluatorSlot, type DamageParts } from "./matchupEvaluator";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { LEVEL_50_TERM, DAMAGE_ROLL_STEPS } from "./battlePower";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";

/**
 * 상대 실능치 역산(ver.2.1 C) — 상대의 HP·방어(특방) 능력 포인트와 성격을 "내가 입힌 데미지 %"로 거꾸로 좁힌다.
 *
 * 게임은 상대 HP를 정수 %(100~0)로만 보여 준다. 후보(HP 포인트 × 방어 포인트 × 특방 포인트 × 성격)마다
 * 관측을 순서대로 재생해서(난수 16단계를 전부 시험) 화면 %와 하나라도 맞는 후보만 남긴다.
 * 데미지는 배틀 엔진(computeDamage)과 같은 정수 공식으로 낸다 — 매치업 화면의 연속값 근사(damageRollPercents)가 아니다.
 * 상세: docs/00_기획문서/2.1-backlog.md C.
 */

/** 화면 %를 HP에서 만드는 규칙 — 사용자 관측("HP 1이 남아도 1%")에 따라 올림. 확정되지 않았으니 이 함수 한 곳에서만 바꾼다. */
export function displayPercent(hp: number, maxHp: number): number {
  if (hp <= 0) return 0;
  return Math.min(100, Math.ceil((hp * 100) / maxHp));
}

export interface InferenceObservation {
  move: Move;
  critical: boolean;
  /** 맞기 전 화면 % (정수) */
  before: number;
  /** 맞은 뒤 화면 % (정수) */
  after: number;
}

export interface InferenceInput {
  /** 내 포켓몬 (포켓몬·특성·도구·성격·포인트). 기술은 관측마다 따로 받는다 */
  attacker: EvaluatorSlot;
  /**
   * 상대 포켓몬의 종·폼. ability/item은 "이렇다고 가정"한 값(모르면 null), nature/points는 무시한다(역산 대상).
   */
  defender: EvaluatorSlot;
  observations: InferenceObservation[];
  attackerStages?: StatStages;
  /** 내 포켓몬의 주 상태이상 (화상이면 물리 공격 반감, 근성·객기는 예외) */
  attackerStatus?: StatusCondition | null;
  defenderStages?: StatStages;
  weather?: WeatherKind;
  field?: FieldKind;
  screen?: "reflect" | "lightScreen" | "auroraVeil";
  /** 화면 % 판정 여유(±%). 0 = 정확히 일치, 1 = ±1% 허용 */
  tolerance?: number;
}

export interface NatureGroup {
  id: string;
  label: string;
  natureNames: string[];
  feasible: number;
  total: number;
}

export interface Range {
  min: number;
  max: number;
}

export interface InferenceResult {
  status: "ok" | "contradiction" | "invalid";
  /** invalid 사유(관측마다). 없으면 null */
  observationErrors: (string | null)[];
  /** 각 관측 하나만으로도 가능한 후보가 있는가 (invalid면 false) */
  singleFeasible: boolean[];
  /** contradiction일 때, 이 관측 하나를 빼면 가능해지는 관측 번호(0부터) */
  culprits: number[];
  total: number;
  feasible: number;
  hp: Range | null;
  def: Range | null;
  spd: Range | null;
  groups: NatureGroup[];
  /** 남은 후보의 HP 포인트(가로 0~32) × 방어/특방 포인트(세로 0~32) 분포. 관측이 없는 쪽은 null */
  hpDefGrid: Uint8Array | null;
  hpSpdGrid: Uint8Array | null;
  /** 실제 HP 실수치·방어/특방 실수치 범위(참고용) */
  realHp: Range | null;
  realDef: Range | null;
  realSpd: Range | null;
}

/** 분포 격자 한 변 칸 수(포인트 0~32) */
export const GRID = MAX_ABILITY_POINTS_PER_STAT + 1;

/** 다단히트·고정 데미지·변화기는 정수 데미지 공식이 맞지 않아 역산에서 뺀다 */
export function inferenceUnsupportedReason(move: Move): string | null {
  if (move.category === "status" || move.category === null) return "데미지를 주지 않는 기술";
  if (move.multiHitPowers || move.minHits !== undefined) return "다단히트 기술은 아직 지원하지 않아요";
  if (move.fixedDamage !== undefined) return "고정 데미지 기술은 역산할 수 없어요";
  if (move.usesTargetAttackStat) return "상대의 공격 스탯을 쓰는 기술은 아직 지원하지 않아요";
  return null;
}

/** 방어에 영향을 주는 특성 (역산 화면의 "상대 특성 가정" 목록) */
export const DEFENSE_ABILITY_CANDIDATES: Ability[] = ABILITIES.filter(
  (a) =>
    a.modifiers?.some((m) => m.scope === "defense") ||
    a.reducesSuperEffectiveDamageMultiplier !== undefined ||
    a.preventsCritsAgainstSelf ||
    a.doublesBerryEffect,
);

/** 방어에 영향을 주는 도구 (반감 열매) */
export const DEFENSE_ITEM_CANDIDATES: Item[] = ITEMS.filter((i) => i.resistsSuperEffectiveType !== undefined);

interface NatureCombo {
  key: string;
  defMult: number;
  spdMult: number;
  label: string;
  natureNames: string[];
}

function natureMult(stat: "def" | "spd", increased: string | null | undefined, decreased: string | null | undefined): number {
  if (increased === stat) return 1.1;
  if (decreased === stat) return 0.9;
  return 1;
}

function buildNatureCombos(useDef: boolean, useSpd: boolean): NatureCombo[] {
  const map = new Map<string, NatureCombo>();
  for (const n of NATURES) {
    const defMult = useDef ? natureMult("def", n.increased, n.decreased) : 1;
    const spdMult = useSpd ? natureMult("spd", n.increased, n.decreased) : 1;
    const key = `${defMult}|${spdMult}`;
    let combo = map.get(key);
    if (!combo) {
      const parts: string[] = [];
      if (useDef) parts.push(defMult > 1 ? "방어↑" : defMult < 1 ? "방어↓" : "");
      if (useSpd) parts.push(spdMult > 1 ? "특방↑" : spdMult < 1 ? "특방↓" : "");
      const label = parts.filter(Boolean).join("·") || (useDef && useSpd ? "방어·특방 보정 없음" : useDef ? "방어 보정 없음" : "특방 보정 없음");
      combo = { key, defMult, spdMult, label, natureNames: [] };
      map.set(key, combo);
    }
    combo.natureNames.push(n.name);
  }
  return [...map.values()];
}

function emptyResult(status: InferenceResult["status"], n: number): InferenceResult {
  return {
    status,
    observationErrors: Array(n).fill(null),
    singleFeasible: Array(n).fill(false),
    culprits: [],
    total: 0,
    feasible: 0,
    hp: null,
    def: null,
    spd: null,
    groups: [],
    hpDefGrid: null,
    hpSpdGrid: null,
    realHp: null,
    realDef: null,
    realSpd: null,
  };
}

interface PreparedObservation {
  parts: DamageParts;
  before: number;
  after: number;
}

/** 관측마다 evaluateSlotMatchup으로 정수 데미지 공식 조각을 구한다. 실패하면 사유 문자열. */
function prepareObservations(input: InferenceInput): { prepared: PreparedObservation[]; errors: (string | null)[] } {
  const { attacker, defender, observations, attackerStages, attackerStatus, defenderStages, weather, field, screen } = input;
  const probeDefender: EvaluatorSlot = { ...defender, nature: null, points: { ...EMPTY_ABILITY_POINTS } };
  const prepared: PreparedObservation[] = [];
  const errors: (string | null)[] = [];
  let itemConsumed = false;
  observations.forEach((obs, i) => {
    const unsupported = inferenceUnsupportedReason(obs.move);
    if (unsupported) {
      errors.push(unsupported);
      return;
    }
    if (!(obs.before >= 0 && obs.before <= 100) || !(obs.after >= 0 && obs.after <= 100)) {
      errors.push("%는 0~100 사이 정수여야 해요");
      return;
    }
    if (obs.after > obs.before) {
      errors.push("맞은 뒤 %가 맞기 전 %보다 클 수 없어요");
      return;
    }
    const res = evaluateSlotMatchup(attacker, obs.move, probeDefender, {
      attackerStages,
      defenderStages,
      weather,
      field,
      screen,
      critical: obs.critical,
      // 멀티스케일 등: 처음 맞는 한 방만 풀피
      defenderHpIsFull: i === 0 && obs.before >= 100,
      defenderItemConsumed: itemConsumed,
      applyMoveOwnStatChanges: false,
      attackerStatus: attackerStatus ?? null,
      extraOffenseMultiplier: computeStatusAttackMultiplier(
        attackerStatus ?? null,
        obs.move.category,
        ignoresBurnAttackPenalty(attacker.ability ?? undefined, obs.move.id),
        attacker.ability ? getAbility(attacker.ability)?.physicalAttackMultiplierWhenStatused : undefined,
      ),
    });
    if (!res || !res.damageParts) {
      errors.push("이 기술로는 데미지를 계산할 수 없어요");
      return;
    }
    if (res.damageParts.typeEffectiveness === 0) {
      errors.push("상대에게 효과가 없는 기술이에요 (타입 면역)");
      return;
    }
    if (res.berryBulkMultiplier > 1) itemConsumed = true;
    errors.push(null);
    prepared.push({ parts: res.damageParts, before: obs.before, after: obs.after });
  });
  return { prepared, errors };
}

/** 방어측 방어 스탯 D에서 16단계 난수 데미지를 낸다 (computeDamage와 같은 식). 중복은 제거한다 */
function damageRolls(parts: DamageParts, defenseRealStat: number): number[] {
  const defenseStat = defenseRealStat * parts.defenseRankMultiplier;
  const base = Math.floor(Math.floor((LEVEL_50_TERM * parts.power * parts.attackTerm) / defenseStat) / 50) + 2;
  const out = new Set<number>();
  for (let k = 0; k < DAMAGE_ROLL_STEPS; k++) {
    const roll = (85 + k) / 100;
    // 타입 면역(상성 0)은 prepareObservations에서 걸러져 여기 오지 않는다
    const modifier = (parts.modifier * parts.typeEffectiveness * roll) / parts.bulkMultiplier;
    out.add(Math.max(1, Math.floor(base * modifier + 1e-9)));
  }
  return [...out];
}

/** 후보 하나(최대 HP + 관측별 데미지 후보)가 관측 전체와 맞는지 */
function candidateMatches(maxHp: number, rolls: number[][], obs: PreparedObservation[], tol: number): boolean {
  let current: number[] = [];
  for (let h = 1; h <= maxHp; h++) {
    if (Math.abs(displayPercent(h, maxHp) - obs[0].before) <= tol) current.push(h);
  }
  for (let i = 0; i < obs.length; i++) {
    if (i > 0) current = current.filter((h) => Math.abs(displayPercent(h, maxHp) - obs[i].before) <= tol);
    if (current.length === 0) return false;
    const next = new Set<number>();
    for (const h of current) {
      for (const d of rolls[i]) {
        const h2 = Math.max(0, h - d);
        if (Math.abs(displayPercent(h2, maxHp) - obs[i].after) <= tol) next.add(h2);
      }
    }
    if (next.size === 0) return false;
    current = [...next];
  }
  return true;
}

/** HP·방어·특방 포인트 배분 후보 [hp, def, spd] — 합계 66 이하, 관측이 없는 쪽 스탯은 0 고정 */
function enumerateAllocations(useDef: boolean, useSpd: boolean): [number, number, number][] {
  const out: [number, number, number][] = [];
  const maxDef = useDef ? MAX_ABILITY_POINTS_PER_STAT : 0;
  const maxSpd = useSpd ? MAX_ABILITY_POINTS_PER_STAT : 0;
  for (let hp = 0; hp <= MAX_ABILITY_POINTS_PER_STAT; hp++) {
    for (let def = 0; def <= maxDef; def++) {
      for (let spd = 0; spd <= maxSpd; spd++) {
        if (hp + def + spd <= MAX_ABILITY_POINTS_TOTAL) out.push([hp, def, spd]);
      }
    }
  }
  return out;
}

function runCandidates(input: InferenceInput, prepared: PreparedObservation[]): InferenceResult {
  const n = prepared.length;
  const pokemon = getPokemon(input.defender.pokemonId);
  if (!pokemon) return emptyResult("invalid", n);
  const base = getEffectiveForm(pokemon, input.defender).baseStats;
  const tol = input.tolerance ?? 0;
  const useDef = prepared.some((o) => o.parts.defenseKey === "def");
  const useSpd = prepared.some((o) => o.parts.defenseKey === "spd");
  const combos = buildNatureCombos(useDef, useSpd);
  const groups: NatureGroup[] = combos.map((c) => ({ id: c.key, label: c.label, natureNames: c.natureNames, feasible: 0, total: 0 }));

  // 방어 스탯 값별 난수 데미지 캐시 (관측 번호 × 스탯 값)
  const cache = prepared.map(() => new Map<number, number[]>());
  const rollsFor = (i: number, stat: number): number[] => {
    let v = cache[i].get(stat);
    if (!v) {
      v = damageRolls(prepared[i].parts, stat);
      cache[i].set(stat, v);
    }
    return v;
  };

  const hpDefGrid = useDef ? new Uint8Array(GRID * GRID) : null;
  const hpSpdGrid = useSpd ? new Uint8Array(GRID * GRID) : null;
  const emptyRange = (): Range => ({ min: Infinity, max: -Infinity });
  const [hpRange, defRange, spdRange, realHp, realDef, realSpd] = Array.from({ length: 6 }, emptyRange);
  let total = 0;
  let feasible = 0;

  const grow = (r: Range, v: number) => {
    r.min = Math.min(r.min, v);
    r.max = Math.max(r.max, v);
  };
  const record = (hpP: number, defP: number, spdP: number, maxHp: number, defStat: number, spdStat: number) => {
    grow(hpRange, hpP);
    grow(realHp, maxHp);
    if (hpDefGrid) {
      grow(defRange, defP);
      grow(realDef, defStat);
      hpDefGrid[defP * GRID + hpP] = 1;
    }
    if (hpSpdGrid) {
      grow(spdRange, spdP);
      grow(realSpd, spdStat);
      hpSpdGrid[spdP * GRID + hpP] = 1;
    }
  };

  for (const [hpP, defP, spdP] of enumerateAllocations(useDef, useSpd)) {
    const maxHp = Math.floor(base.hp + 75 + hpP);
    for (let c = 0; c < combos.length; c++) {
      const combo = combos[c];
      const defStat = Math.floor((base.def + 20 + defP) * combo.defMult);
      const spdStat = Math.floor((base.spd + 20 + spdP) * combo.spdMult);
      total++;
      groups[c].total++;
      const rolls = prepared.map((o, i) => rollsFor(i, o.parts.defenseKey === "def" ? defStat : spdStat));
      if (!candidateMatches(maxHp, rolls, prepared, tol)) continue;
      feasible++;
      groups[c].feasible++;
      record(hpP, defP, spdP, maxHp, defStat, spdStat);
    }
  }

  const range = (r: Range): Range | null => (r.min === Infinity ? null : r);
  return {
    status: feasible > 0 ? "ok" : "contradiction",
    observationErrors: Array(n).fill(null),
    singleFeasible: Array(n).fill(true),
    culprits: [],
    total,
    feasible,
    hp: range(hpRange),
    def: useDef ? range(defRange) : null,
    spd: useSpd ? range(spdRange) : null,
    groups,
    hpDefGrid,
    hpSpdGrid,
    realHp: range(realHp),
    realDef: useDef ? range(realDef) : null,
    realSpd: useSpd ? range(realSpd) : null,
  };
}

/**
 * 관측 전체와 맞는 상대 배분 후보를 좁힌다. 관측이 없으면 null.
 * 관측 사이에 상대가 회복하지 않았다고 가정한다(먹다남은음식·재생력 등은 2차).
 */
export function inferDefense(input: InferenceInput): InferenceResult | null {
  const total = input.observations.length;
  if (total === 0) return null;
  const { prepared, errors } = prepareObservations(input);
  if (errors.some((e) => e !== null)) {
    return { ...emptyResult("invalid", total), observationErrors: errors };
  }
  const result = runCandidates(input, prepared);
  result.observationErrors = errors;

  if (total > 1) {
    // 관측 하나씩만 봤을 때 가능한지 + 모순이면 어느 관측을 빼면 풀리는지
    result.singleFeasible = prepared.map((o) => runCandidates(input, [o]).status === "ok");
    if (result.status === "contradiction") {
      result.culprits = prepared
        .map((_, skip) => skip)
        .filter((skip) => runCandidates(input, prepared.filter((__, i) => i !== skip)).status === "ok");
    }
  }
  return result;
}
