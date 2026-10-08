import type { Move } from "../types/move";
import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import type { StatStages } from "../types/battleStats";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import type { StatusCondition } from "../types/status";
import { ABILITIES, ITEMS, NATURES, getAbility, getPokemon } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost } from "./statusConditions";
import { damageRollTotals } from "./damageFormula";
import { evaluateSlotMatchup, type EvaluatorSlot, type DamageParts } from "./matchupEvaluator";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";

/**
 * 상대 실능치 역산(ver.2.1 C) — 상대의 HP·방어(특방) 능력 포인트와 성격을 "내가 입힌 데미지 %"로 거꾸로 좁힌다.
 *
 * 게임은 상대 HP를 정수 %(100~0)로만 보여 준다. 후보(HP 포인트 × 방어 포인트 × 특방 포인트 × 성격)마다
 * 관측을 순서대로 재생해서(난수 16단계를 전부 시험) 화면 %와 하나라도 맞는 후보만 남긴다.
 * 데미지는 배틀 엔진(computeDamage)과 같은 정수 공식으로 낸다.
 * 상세: docs/00_기획문서/02_backlog/02_ver.2.0/2.1-backlog.md C.
 */

/**
 * 화면 %를 HP에서 만드는 규칙 — 내림, 단 HP가 남아 있으면 최소 1%. 사용자 실측(2026-10-05, 2.4 X1): 124/215 → 57%(올림이면 58),
 * 30/215 → 13%(올림이면 14), "HP 1이 남아도 1%". 확정되지 않았으니 이 함수 한 곳에서만 바꾼다.
 */
export function displayPercent(hp: number, maxHp: number): number {
  if (hp <= 0) return 0;
  return Math.min(100, Math.max(1, Math.floor((hp * 100) / maxHp)));
}

export interface InferenceObservation {
  move: Move;
  critical: boolean;
  /** 맞기 전 화면 % (정수) */
  before: number;
  /** 맞은 뒤 화면 % (정수) */
  after: number;
  /**
   * 이 관측을 맞을 때 상대가 메가진화한 상태면 그 메가폼 이름(`MegaEvolution.form`). 없으면 `InferenceInput.defender`의 폼(2.5 L1).
   * 메가진화는 HP 종족값·포인트·성격이 그대로라, 같은 배분 후보가 관측마다 그 폼의 방어·특방 종족값으로 검사된다.
   */
  megaForm?: string;
}

export interface InferenceInput {
  /** 내 포켓몬 (포켓몬·특성·도구·성격·포인트). 기술은 관측마다 따로 받는다 */
  attacker: EvaluatorSlot;
  /**
   * 상대 포켓몬의 종·폼. ability/item은 "이렇다고 가정"한 값(모르면 null), nature/points는 무시한다(역산 대상).
   * 관측에 메가폼 태그(`megaForm`)가 하나라도 있으면 메가스톤을 들고 있었던 것이라 모든 관측에서 도구 가정을 끄고,
   * 태그가 붙은 관측은 그 메가폼의 특성으로 계산한다.
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
  /** 후보로 볼 성격 id 목록 — 공격 역산이 이미 걸러낸 성격을 넘겨 같은 상대의 성격을 공유한다(3.1 C2-b). 생략하면 전부 */
  natureIds?: readonly string[];
  /** HP+방어+특방 포인트 합의 상한 — 공격·특공 쪽에 이미 쓴 최소 포인트를 뺀 값(3.1 C2-b 포인트 예산). 생략하면 66 */
  maxPointsSum?: number;
}

export interface NatureGroup {
  id: string;
  label: string;
  natureNames: string[];
  feasible: number;
  total: number;
  /** 가능도 가중 비율(0~1, 전체 합 1) — 이 성격 묶음이 얼마나 그럴듯한지 */
  weight: number;
}

export interface Range {
  min: number;
  max: number;
}

/** 가능도 가중 중심 구간(10%~90%)과 중앙값 — 가능한 후보의 양 끝(Range)보다 훨씬 좁다 */
export interface CentralRange {
  lo: number;
  median: number;
  hi: number;
}

/** 내구 지수(실제 HP × 방어/특방 실수치) — 데미지 %가 실제로 알려 주는 값. support는 가능한 후보 전체의 양 끝 */
export interface BulkEstimate {
  support: Range;
  central: CentralRange;
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
  /**
   * 가능도 가중 결과(2.4 X1) — 난수 16단계 중 관측과 맞는 비율로 후보를 가중한다. 관측이 하나뿐이면 HP·방어가 서로 바뀌어도 같은
   * 내구라 포인트 범위가 0~32로 넓어지지만, 내구 지수와 중심 구간은 훨씬 좁다.
   */
  hpCentral: CentralRange | null;
  defCentral: CentralRange | null;
  spdCentral: CentralRange | null;
  bulkPhysical: BulkEstimate | null;
  bulkSpecial: BulkEstimate | null;
  /** 분포 격자의 가중 값(0~1, 가장 그럴듯한 칸 = 1). hpDefGrid와 같은 배치 */
  hpDefWeights: Float32Array | null;
  hpSpdWeights: Float32Array | null;
}

/** 분포 격자 한 변 칸 수(포인트 0~32) */
export const GRID = MAX_ABILITY_POINTS_PER_STAT + 1;

/**
 * 극보정 형태인지(3.1 C2-a) — 능력 포인트를 최대(32)로 몰아 넣는 흔한 샘플 배분의 모양: 32가 두 개 이하이고, 32가 아닌 나머지는
 * 합쳐 2 이하(합계 66 = 32 + 32 + 남은 2). 어디까지나 **표시용**이라 역산 계산·가중에는 쓰지 않는다 — 극보정이 아닌 배분을 잡아내는 게
 * 역산의 가치이고, 극보정 후보가 하나도 없으면 "일반적이지 않은 배분"이라는 정보가 된다.
 */
export function isExtremePoints(values: readonly number[]): boolean {
  const rest = values.filter((v) => v !== MAX_ABILITY_POINTS_PER_STAT);
  return values.length - rest.length <= 2 && rest.reduce((sum, v) => sum + v, 0) <= 2;
}

/** 분포 격자(가로 HP × 세로 방어/특방 포인트)에서 가능한 칸 수와 그중 극보정 형태인 칸 수 */
export function countExtremeCells(grid: Uint8Array): { feasible: number; extreme: number } {
  let feasible = 0;
  let extreme = 0;
  grid.forEach((on, i) => {
    if (!on) return;
    feasible++;
    if (isExtremePoints([i % GRID, Math.floor(i / GRID)])) extreme++;
  });
  return { feasible, extreme };
}

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

export function natureMult(stat: "atk" | "def" | "spa" | "spd" | "spe", increased: string | null | undefined, decreased: string | null | undefined): number {
  if (increased === stat) return 1.1;
  if (decreased === stat) return 0.9;
  return 1;
}

function buildNatureCombos(useDef: boolean, useSpd: boolean, allowed?: ReadonlySet<string>): NatureCombo[] {
  const map = new Map<string, NatureCombo>();
  for (const n of NATURES) {
    if (allowed && !allowed.has(n.id)) continue;
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
    hpCentral: null,
    defCentral: null,
    spdCentral: null,
    bulkPhysical: null,
    bulkSpecial: null,
    hpDefWeights: null,
    hpSpdWeights: null,
  };
}

interface PreparedObservation {
  parts: DamageParts;
  before: number;
  after: number;
  /** 이 관측 시점 폼의 방어·특방 종족값 */
  baseDef: number;
  baseSpd: number;
}

/** 관측마다 evaluateSlotMatchup으로 정수 데미지 공식 조각을 구한다. 실패하면 사유 문자열. */
function prepareObservations(input: InferenceInput): { prepared: PreparedObservation[]; errors: (string | null)[] } {
  const { attacker, defender, observations, attackerStages, attackerStatus, defenderStages, weather, field, screen } = input;
  const pokemon = getPokemon(defender.pokemonId);
  // 메가 전·후를 섞은 관측이면 메가스톤 보유 → 반감 열매 가정을 모든 관측에서 끈다
  const hasMega = observations.some((o) => o.megaForm);
  const probeDefender: EvaluatorSlot = {
    ...defender,
    item: hasMega ? null : defender.item,
    nature: null,
    points: { ...EMPTY_ABILITY_POINTS },
  };
  const prepared: PreparedObservation[] = [];
  const errors: (string | null)[] = [];
  let itemConsumed = false;
  observations.forEach((obs, i) => {
    const unsupported = inferenceUnsupportedReason(obs.move);
    if (unsupported) {
      errors.push(unsupported);
      return;
    }
    const mega = obs.megaForm ? pokemon?.megaEvolutions?.find((m) => m.form === obs.megaForm) : undefined;
    if (obs.megaForm && !mega) {
      errors.push("이 포켓몬에게 없는 메가폼이에요");
      return;
    }
    const slotAtHit: EvaluatorSlot = mega ? { ...probeDefender, activeMegaForm: mega.form, ability: mega.ability } : probeDefender;
    if (!(obs.before >= 0 && obs.before <= 100) || !(obs.after >= 0 && obs.after <= 100)) {
      errors.push("%는 0~100 사이 정수여야 해요");
      return;
    }
    if (obs.after > obs.before) {
      errors.push("맞은 뒤 %가 맞기 전 %보다 클 수 없어요");
      return;
    }
    const res = evaluateSlotMatchup(attacker, obs.move, slotAtHit, {
      attackerStages,
      defenderStages,
      weather,
      field,
      screen,
      critical: obs.critical,
      // 멀티스케일 등: 처음 맞는 한 방만 풀피
      defenderHpIsFull: i === 0 && obs.before >= 100,
      defenderItemConsumed: itemConsumed,
      attackerStatus: attackerStatus ?? null,
      // 근성류 상승은 위력 단계, 화상 ×0.5는 최종 단계(2.4 B3)
      extraOffenseMultiplier: statusedAttackBoost(
        attackerStatus ?? null,
        obs.move.category,
        attacker.ability ? getAbility(attacker.ability)?.physicalAttackMultiplierWhenStatused : undefined,
      ),
      finalOffenseMultiplier: burnDamageMultiplier(
        attackerStatus ?? null,
        obs.move.category,
        ignoresBurnAttackPenalty(attacker.ability ?? undefined, obs.move.id),
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
    const { baseStats } = getEffectiveForm(pokemon!, slotAtHit);
    prepared.push({ parts: res.damageParts, before: obs.before, after: obs.after, baseDef: baseStats.def, baseSpd: baseStats.spd });
  });
  return { prepared, errors };
}

/** 방어측 방어 스탯 D에서 16단계 난수 데미지를 낸다 (엔진 computeDamage·난수표와 같은 damageFormula 정수식). 가능도 계산이라 중복도 그대로 둔다 */
function damageRolls(parts: DamageParts, defenseRealStat: number): number[] {
  // 타입 면역(상성 0)은 prepareObservations에서 걸러져 여기 오지 않는다
  return damageRollTotals(parts, defenseRealStat);
}

/**
 * 후보 하나(최대 HP + 관측별 16단계 난수 데미지)가 관측 전체와 얼마나 맞는지(가능도, 0~1). 0이면 불가능.
 * 첫 관측 "맞기 전 %"에 맞는 HP는 균등하다고 보고, 매 관측마다 난수 16단계를 같은 확률(1/16)로 굴려 화면 %가 맞는 경우만 이어 간다.
 * 이어서 오는 관측은 "맞기 전 %"가 직전 결과와 맞는 HP만 남긴다(관측 사이 회복 없음 가정).
 */
function candidateLikelihood(maxHp: number, rolls: number[][], obs: PreparedObservation[], tol: number): number {
  let current = new Map<number, number>();
  for (let h = 1; h <= maxHp; h++) {
    if (Math.abs(displayPercent(h, maxHp) - obs[0].before) <= tol) current.set(h, 1);
  }
  if (current.size === 0) return 0;
  for (const h of current.keys()) current.set(h, 1 / current.size);
  for (let i = 0; i < obs.length; i++) {
    if (i > 0) {
      for (const h of current.keys()) {
        if (Math.abs(displayPercent(h, maxHp) - obs[i].before) > tol) current.delete(h);
      }
      if (current.size === 0) return 0;
    }
    const next = new Map<number, number>();
    for (const [h, w] of current) {
      for (const d of rolls[i]) {
        const h2 = Math.max(0, h - d);
        if (Math.abs(displayPercent(h2, maxHp) - obs[i].after) <= tol) next.set(h2, (next.get(h2) ?? 0) + w / rolls[i].length);
      }
    }
    if (next.size === 0) return 0;
    current = next;
  }
  let sum = 0;
  for (const w of current.values()) sum += w;
  return sum;
}

/** 값(정수)별 가중치를 쌓았다가 중심 80%(10%~90%) 구간과 중앙값을 낸다 */
export class WeightedValues {
  private readonly bins = new Map<number, number>();
  private total = 0;
  add(value: number, weight: number): void {
    this.bins.set(value, (this.bins.get(value) ?? 0) + weight);
    this.total += weight;
  }
  central(): CentralRange | null {
    if (this.total <= 0) return null;
    const keys = [...this.bins.keys()].sort((x, y) => x - y);
    const at = (q: number): number => {
      let cum = 0;
      for (const k of keys) {
        cum += this.bins.get(k)!;
        if (cum / this.total >= q - 1e-9) return k;
      }
      return keys[keys.length - 1];
    };
    return { lo: at(0.1), median: at(0.5), hi: at(0.9) };
  }
}

const realStat = (natureMult: number, baseStat: number, points: number): number => Math.floor((baseStat + 20 + points) * natureMult);

/** HP·방어·특방 포인트 배분 후보 [hp, def, spd] — 합계 maxSum(기본 66) 이하, 관측이 없는 쪽 스탯은 0 고정 */
function enumerateAllocations(useDef: boolean, useSpd: boolean, maxSum: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const maxDef = useDef ? MAX_ABILITY_POINTS_PER_STAT : 0;
  const maxSpd = useSpd ? MAX_ABILITY_POINTS_PER_STAT : 0;
  for (let hp = 0; hp <= MAX_ABILITY_POINTS_PER_STAT; hp++) {
    for (let def = 0; def <= maxDef; def++) {
      for (let spd = 0; spd <= maxSpd; spd++) {
        if (hp + def + spd <= maxSum) out.push([hp, def, spd]);
      }
    }
  }
  return out;
}

function runCandidates(input: InferenceInput, prepared: PreparedObservation[], detailed = false): InferenceResult {
  const n = prepared.length;
  const pokemon = getPokemon(input.defender.pokemonId);
  if (!pokemon) return emptyResult("invalid", n);
  // HP 종족값은 메가 전·후가 같다. 표시용 방어·특방 실수치와 내구 지수는 그 스탯을 쓴 마지막 관측(현재 폼) 기준
  const base = getEffectiveForm(pokemon, input.defender).baseStats;
  const lastDef = prepared.findLast((o) => o.parts.defenseKey === "def");
  const lastSpd = prepared.findLast((o) => o.parts.defenseKey === "spd");
  const tol = input.tolerance ?? 0;
  const useDef = prepared.some((o) => o.parts.defenseKey === "def");
  const useSpd = prepared.some((o) => o.parts.defenseKey === "spd");
  const combos = buildNatureCombos(useDef, useSpd, input.natureIds ? new Set(input.natureIds) : undefined);
  const groups: NatureGroup[] = combos.map((c) => ({ id: c.key, label: c.label, natureNames: c.natureNames, feasible: 0, total: 0, weight: 0 }));

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
  // 가능도 가중 집계(detailed일 때만 — 관측 하나씩 빼 보는 보조 호출에는 필요 없다)
  const hpDefWeights = detailed && useDef ? new Float32Array(GRID * GRID) : null;
  const hpSpdWeights = detailed && useSpd ? new Float32Array(GRID * GRID) : null;
  const hpW = new WeightedValues();
  const defW = new WeightedValues();
  const spdW = new WeightedValues();
  const bulkPhysW = new WeightedValues();
  const bulkSpecW = new WeightedValues();
  const bulkPhysRange: Range = { min: Infinity, max: -Infinity };
  const bulkSpecRange: Range = { min: Infinity, max: -Infinity };
  let totalWeight = 0;
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

  for (const [hpP, defP, spdP] of enumerateAllocations(useDef, useSpd, Math.min(MAX_ABILITY_POINTS_TOTAL, input.maxPointsSum ?? MAX_ABILITY_POINTS_TOTAL))) {
    const maxHp = Math.floor(base.hp + 75 + hpP);
    for (let c = 0; c < combos.length; c++) {
      const combo = combos[c];
      const defStat = realStat(combo.defMult, lastDef?.baseDef ?? base.def, defP);
      const spdStat = realStat(combo.spdMult, lastSpd?.baseSpd ?? base.spd, spdP);
      total++;
      groups[c].total++;
      const rolls = prepared.map((o, i) =>
        o.parts.defenseKey === "def" ? rollsFor(i, realStat(combo.defMult, o.baseDef, defP)) : rollsFor(i, realStat(combo.spdMult, o.baseSpd, spdP)),
      );
      const likelihood = candidateLikelihood(maxHp, rolls, prepared, tol);
      if (likelihood <= 0) continue;
      feasible++;
      groups[c].feasible++;
      record(hpP, defP, spdP, maxHp, defStat, spdStat);
      if (detailed) {
        totalWeight += likelihood;
        groups[c].weight += likelihood;
        hpW.add(hpP, likelihood);
        if (hpDefWeights) {
          hpDefWeights[defP * GRID + hpP] += likelihood;
          defW.add(defP, likelihood);
          const bulk = maxHp * defStat;
          bulkPhysW.add(bulk, likelihood);
          bulkPhysRange.min = Math.min(bulkPhysRange.min, bulk);
          bulkPhysRange.max = Math.max(bulkPhysRange.max, bulk);
        }
        if (hpSpdWeights) {
          hpSpdWeights[spdP * GRID + hpP] += likelihood;
          spdW.add(spdP, likelihood);
          const bulk = maxHp * spdStat;
          bulkSpecW.add(bulk, likelihood);
          bulkSpecRange.min = Math.min(bulkSpecRange.min, bulk);
          bulkSpecRange.max = Math.max(bulkSpecRange.max, bulk);
        }
      }
    }
  }

  const range = (r: Range): Range | null => (r.min === Infinity ? null : r);
  const normalize = (w: Float32Array | null): Float32Array | null => {
    if (!w) return null;
    let max = 0;
    for (const v of w) max = Math.max(max, v);
    if (max > 0) for (let i = 0; i < w.length; i++) w[i] /= max;
    return w;
  };
  const bulkOf = (w: WeightedValues, r: Range): BulkEstimate | null => {
    const central = w.central();
    return central && r.min !== Infinity ? { support: r, central } : null;
  };
  if (totalWeight > 0) for (const g of groups) g.weight /= totalWeight;
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
    hpCentral: hpW.central(),
    defCentral: useDef ? defW.central() : null,
    spdCentral: useSpd ? spdW.central() : null,
    bulkPhysical: useDef ? bulkOf(bulkPhysW, bulkPhysRange) : null,
    bulkSpecial: useSpd ? bulkOf(bulkSpecW, bulkSpecRange) : null,
    hpDefWeights: normalize(hpDefWeights),
    hpSpdWeights: normalize(hpSpdWeights),
  };
}

/**
 * 관측 전체와 맞는 상대 배분 후보를 좁힌다. 관측이 없으면 null.
 * 관측 사이에 상대가 회복하지 않았다고 가정한다(먹다남은음식·재생력 등은 2차).
 */
export function inferDefense(input: InferenceInput, diagnostics = true): InferenceResult | null {
  const total = input.observations.length;
  if (total === 0) return null;
  const { prepared, errors } = prepareObservations(input);
  if (errors.some((e) => e !== null)) {
    return { ...emptyResult("invalid", total), observationErrors: errors };
  }
  const result = runCandidates(input, prepared, true);
  result.observationErrors = errors;

  if (total > 1 && diagnostics) {
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
