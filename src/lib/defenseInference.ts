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
import { damageRollSet, type RollSet } from "./damageFormula";
import { evaluateSlotMatchup, type EvaluatorSlot, type DamageParts } from "./matchupEvaluator";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";
import type { BaseStats } from "../types/stats";
import type { Pokemon } from "../types/pokemon";
import { rollMatchOf, TOTAL_POINTS, TopLists, type CandidateLists } from "./candidateCards";

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

/** 턴 종료 HP 변화(3.7 A4) — 최대 HP의 n/16을 버림한 값을 더한다(+ 회복, − 피해). 독은 1/8 = 2/16 */
export const END_TURN_EFFECTS = [
  { id: "leftovers", label: "먹다남은음식", sixteenths: 1 },
  { id: "grassy", label: "그래스필드", sixteenths: 1 },
  { id: "poison", label: "독", sixteenths: -2 },
  { id: "leechSeed", label: "씨뿌리기", sixteenths: -2 },
  { id: "curse", label: "저주", sixteenths: -4 },
  { id: "burn", label: "화상", sixteenths: -1 },
  { id: "sandstorm", label: "모래바람", sixteenths: -1 },
  // 자뭉열매는 턴 종료 효과가 아니라 맞은 직후 먹는다 — 화면의 "맞은 뒤 %"에 회복이 이미 섞여 있다는 표시(4.0 F2). 16분율 값은 쓰지 않는다
  { id: "sitrus", label: "자뭉열매 발동", sixteenths: 0 },
] as const;

/** 도구가 있어야 일어나는 효과 — 메가진화하는 포켓몬은 메가스톤을 들고 있어 쓸 수 없다 */
export const ITEM_END_TURN_IDS: readonly string[] = ["leftovers", "sitrus"];

/** 자뭉열매: 맞은 뒤 HP가 최대 HP 1/2 이하면 1회 최대 HP ÷ 이 값만큼 회복(숙성이면 2배) */
const SITRUS_DENOMINATOR = ITEMS.find((i) => i.id === "자뭉열매")?.healsBelowHalfHpDenominator ?? 4;

/** 맹독은 경과 턴 n에 따라 n/16 — id를 `toxic<n>`(1~15)으로 쓴다 */
export const TOXIC_ID = /^toxic([1-9]|1[0-5])$/;

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
  /** 다단히트 기술이 실제로 맞은 타수(3.3 V4). 타수가 하나뿐인 기술은 생략해도 된다 */
  hits?: number;
  /** 맞은 뒤 다음 관측 전까지 일어난 턴 종료 효과(`END_TURN_EFFECTS`의 id). 마지막 관측에서는 쓰지 않는다 */
  endTurn?: readonly string[];
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
  /** HP+방어+특방 포인트 합의 하한 — 합계 66을 다 쓴다는 전제에서 다른 쪽이 최대로 쓸 수 있는 포인트를 뺀 값(3.3 V5). 관측하지 않은 방어·특방은 남는 포인트를 흡수할 수 있어 그만큼 낮춰 적용한다. 생략하면 0 */
  minPointsSum?: number;
  /** 다른 쪽 관측(공격·스피드)에 쓰인 메가폼 이름 — 이 쪽에 메가 태그가 없어도 메가 전·후를 나란히 보이려고 받는다(3.1 L1-b) */
  viewMegaForms?: readonly string[];
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

/** 폼별 표시값(3.1 L1-b) — 같은 포인트·성격 후보가 그 폼의 종족값에서 낳는 실수치 범위·내구 지수. 메가 태그가 있을 때만 만든다 */
export interface FormView {
  /** 메가폼 이름(`MegaEvolution.form`), 메가 전은 "" */
  form: string;
  label: string;
  real: Partial<Record<"hp" | "def" | "spd" | "atk" | "spa" | "spe", Range>>;
  bulkPhysical?: BulkEstimate | null;
  bulkSpecial?: BulkEstimate | null;
}

interface FormBase {
  form: string;
  label: string;
  baseStats: BaseStats;
}

/**
 * 표시할 폼 목록 — 메가 태그(관측에 붙은 것 + 다른 쪽 관측이 쓴 것 `extra`)가 하나라도 있으면 [메가 전, 나온 메가폼들], 없으면 [].
 * 메가진화는 포인트·성격이 그대로라 폼마다 종족값만 바꿔 실수치를 낸다.
 */
export function viewForms(pokemon: Pokemon, slot: EvaluatorSlot, tags: (string | undefined)[], extra: readonly string[] = []): FormBase[] {
  const megas = [...new Set([...tags, ...extra].filter((t): t is string => !!t))].filter((f) => pokemon.megaEvolutions?.some((m) => m.form === f));
  if (megas.length === 0) return [];
  const statsOf = (activeMegaForm?: string) => getEffectiveForm(pokemon, { ...slot, activeMegaForm }).baseStats;
  return [
    { form: "", label: "메가 전", baseStats: statsOf() },
    ...megas.map((f) => ({ form: f, label: `메가 후 (${f.replace(/^.*?-/, "")})`, baseStats: statsOf(f) })),
  ];
}

export const emptyRange = (): Range => ({ min: Infinity, max: -Infinity });
export const growRange = (r: Range, v: number) => {
  r.min = Math.min(r.min, v);
  r.max = Math.max(r.max, v);
};
export const finishRange = (r: Range): Range | null => (r.min === Infinity ? null : r);

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
  /** 남은 후보 전체에서 본 HP+방어+특방 포인트 합의 범위 — 스탯별 범위를 더한 것보다 좁다(HP·방어는 서로 보완하는 관계). 결합의 포인트 예산이 쓴다(3.6 I1-d) */
  sums: Range | null;
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
  /** 메가 전·후 실수치·내구 지수 나란히 보기(3.1 L1-b) — 메가 태그가 없으면 빈 배열 */
  formViews: FormView[];
  /** 구체적인 후보 카드(3.6 I2) — 남은 SP 순·가능도 순 상위 목록. 후보가 없거나 가중 계산을 하지 않은 호출이면 null */
  candidates: CandidateLists | null;
}

/**
 * 후보(HP·방어·특방 포인트 × 성격 묶음)별 가능도 캐시 — 결합 되풀이(`inferCombined`)처럼 **같은 관측**으로 성격·포인트 합 제한만 바꿔 여러 번 부를 때
 * 후보 하나의 가능도가 그대로라 다시 계산하지 않는다(3.6 I1-a). 관측·상대 종·가정이 바뀌면 새로 만들어야 한다.
 */
interface LikelihoodCache {
  /** [hp][def][spd][성격 묶음 칸] 가능도 — 음수는 아직 계산하지 않음 */
  values: Float64Array;
  /** 성격 묶음 key(`방어배율|특방배율`) → 칸 번호 */
  slots: Map<string, number>;
}

/** 성격 묶음은 방어·특방 보정 3×3 = 최대 9가지 */
const COMBO_SLOTS = 9;

export function createLikelihoodCache(): LikelihoodCache {
  return { values: new Float64Array(33 * 33 * 33 * COMBO_SLOTS).fill(-1), slots: new Map() };
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

/** 다단히트 기술의 가능한 타수 범위. 다단히트가 아니면 null (3.3 V4) */
export function multiHitRange(move: Move): Range | null {
  if (move.multiHitPowers) return { min: move.minHits ?? 1, max: Math.min(move.maxHits ?? move.multiHitPowers.length, move.multiHitPowers.length) };
  if (move.minHits !== undefined && move.maxHits !== undefined) return { min: move.minHits, max: move.maxHits };
  return null;
}

/** 다단히트 기술에 타수가 맞게 들어왔는지 — 타수가 정해진 기술(더블어택)은 생략 가능. 맞으면 null */
export function multiHitError(move: Move, hits: number | undefined): string | null {
  const range = multiHitRange(move);
  if (!range) return null;
  const n = hits ?? (range.min === range.max ? range.min : undefined);
  if (n === undefined) return "맞은 타수를 골라 주세요";
  return Number.isInteger(n) && n >= range.min && n <= range.max ? null : `타수는 ${range.min}~${range.max}회예요`;
}

/** 고정 데미지·변화기 등은 정수 데미지 공식이 맞지 않아 역산에서 뺀다 */
export function inferenceUnsupportedReason(move: Move): string | null {
  if (move.category === "status" || move.category === null) return "데미지를 주지 않는 기술";
  if (move.fixedDamage !== undefined) return "고정 데미지 기술은 역산할 수 없어요";
  if (move.usesTargetAttackStat) return "상대의 공격 스탯을 쓰는 기술은 아직 지원하지 않아요";
  // 셸암즈: 물리/특수가 역산 대상 능력(상대 방어·공격)에 따라 정해져 관측만으로 분류를 고정할 수 없다
  if (move.dynamicCategoryByHigherDamage) return "물리/특수가 능력치에 따라 바뀌는 기술은 아직 지원하지 않아요";
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
    sums: null,
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
    formViews: [],
    candidates: null,
  };
}

interface PreparedObservation {
  parts: DamageParts;
  before: number;
  after: number;
  /** 턴 종료 효과의 16분율(부호 있음) 목록 */
  endTurn: number[];
  /** 자뭉열매를 맞은 직후 먹은 관측이면 회복 배수(1, 숙성 2). 아니면 0 */
  berry: number;
  /** 이 관측 시점 폼의 방어·특방 종족값 */
  baseDef: number;
  baseSpd: number;
}

export function endTurnSixteenths(ids: readonly string[] | undefined): number[] {
  return (ids ?? []).flatMap((id) => {
    const toxic = TOXIC_ID.exec(id);
    return toxic ? -Number(toxic[1]) : (END_TURN_EFFECTS.find((e) => e.id === id)?.sixteenths || []);
  });
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
  let berryEaten = false;
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
    // 메가 전·후를 섞은 관측이면 메가스톤을 들었으므로 도구 효과(먹다남은음식·자뭉열매)는 무시한다
    const endTurn = hasMega ? obs.endTurn?.filter((id) => !ITEM_END_TURN_IDS.includes(id)) : obs.endTurn;
    const berry = endTurn?.includes("sitrus") ? (getAbility(slotAtHit.ability ?? "")?.doublesBerryEffect ? 2 : 1) : 0;
    if (berry && berryEaten) {
      errors.push("자뭉열매는 한 번만 먹을 수 있어요");
      return;
    }
    if (obs.after > obs.before && !berry) {
      errors.push("맞은 뒤 %가 맞기 전 %보다 클 수 없어요");
      return;
    }
    if (berry) berryEaten = true;
    const hitsError = multiHitError(obs.move, obs.hits);
    if (hitsError) {
      errors.push(hitsError);
      return;
    }
    // 멀티스케일·섀도실드는 첫 타에만 듣는데 계산은 전 타에 곱하므로 다단히트에서는 뺀다
    if (multiHitRange(obs.move) && slotAtHit.ability && getAbility(slotAtHit.ability)?.modifiers?.some((m) => m.condition?.defenderHpIsFull === true)) {
      errors.push("풀피에서 첫 타만 줄이는 특성(멀티스케일 등)을 가정한 상대의 다단히트는 아직 지원하지 않아요");
      return;
    }
    const res = evaluateSlotMatchup(attacker, obs.move, slotAtHit, {
      multiHitCount: multiHitRange(obs.move) ? (obs.hits ?? multiHitRange(obs.move)!.min) : undefined,
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
    prepared.push({ parts: res.damageParts, before: obs.before, after: obs.after, endTurn: endTurnSixteenths(endTurn), berry, baseDef: baseStats.def, baseSpd: baseStats.spd });
  });
  return { prepared, errors };
}

/** 방어측 방어 스탯 D에서 16단계 난수 데미지를 낸다 (엔진 computeDamage·난수표와 같은 damageFormula 정수식). 가능도 계산이라 중복도 그대로 둔다 */
function damageRolls(parts: DamageParts, defenseRealStat: number): RollSet {
  // 타입 면역(상성 0)은 prepareObservations에서 걸러져 여기 오지 않는다
  return damageRollSet(parts, defenseRealStat);
}

// 가능도 계산용 재사용 버퍼 — 후보마다 Map을 새로 만들지 않는다. HP 실수치는 400을 넘지 않는다(종족값 255 + 75 + 32)
const HP_BUF = 1024;
let curW = new Float64Array(HP_BUF);
let curList = new Int32Array(HP_BUF);
let nextW = new Float64Array(HP_BUF);
let nextList = new Int32Array(HP_BUF);
const nextSeen = new Int32Array(HP_BUF);
let seenStamp = 0;

/** 최대 HP별 화면 % 표(`displayPercent(h, maxHp)`를 h = 0..maxHp에 미리 계산) — 가능도 계산이 같은 값을 수없이 되묻는다 */
const percentTables = new Map<number, Uint8Array>();
function percentTable(maxHp: number): Uint8Array {
  let table = percentTables.get(maxHp);
  if (!table) percentTables.set(maxHp, (table = Uint8Array.from({ length: maxHp + 1 }, (_, h) => displayPercent(h, maxHp))));
  return table;
}

/** 자뭉열매를 먹은 줄 — 맞은 뒤 HP가 1/2 이하일 때만 가능(아니면 -1)하고, 화면 %는 회복한 뒤의 HP로 만든다 */
function eatSitrus(hpHit: number, maxHp: number, mult: number): number {
  return hpHit === 0 || hpHit * 2 > maxHp ? -1 : Math.min(maxHp, hpHit + Math.floor(maxHp / SITRUS_DENOMINATOR) * mult);
}

/**
 * 후보 하나(최대 HP + 관측별 16단계 난수 데미지)가 관측 전체와 얼마나 맞는지(가능도, 0~1). 0이면 불가능.
 * 첫 관측 "맞기 전 %"에 맞는 HP는 균등하다고 보고, 매 관측마다 난수 16단계를 같은 확률(1/16)로 굴려 화면 %가 맞는 경우만 이어 간다.
 * 이어서 오는 관측은 "맞기 전 %"가 직전 결과(+ 턴 종료 효과)와 맞는 HP만 남긴다. 효과를 고르지 않으면 관측 사이 회복 없음.
 * HP별 가중치를 배열(curW)에 두고 살아 있는 HP를 처음 들어온 순서대로 목록(curList)에 둔다 — Map과 같은 순서로 더해 결과가 같다.
 */
function candidateLikelihood(maxHp: number, rolls: RollSet[], obs: PreparedObservation[], tol: number): number {
  const pct = percentTable(maxHp);
  let n = 0;
  for (let h = 1; h <= maxHp; h++) {
    if (Math.abs(pct[h] - obs[0].before) <= tol) curList[n++] = h;
  }
  if (n === 0) return 0;
  for (let j = 0; j < n; j++) curW[curList[j]] = 1 / n;
  for (let i = 0; i < obs.length; i++) {
    if (i > 0) {
      let kept = 0;
      for (let j = 0; j < n; j++) {
        const h = curList[j];
        if (Math.abs(pct[h] - obs[i].before) <= tol) curList[kept++] = h;
      }
      n = kept;
      if (n === 0) return 0;
    }
    const { values, probs } = rolls[i];
    const equal = 1 / values.length;
    const { after, endTurn, berry } = obs[i];
    // 턴 종료 효과는 후보 최대 HP로 정해지는 상수 — 맞은 뒤 %를 판정한 다음 HP에 더해 이어 간다
    let delta = 0;
    for (const k of endTurn) delta += Math.sign(k) * Math.floor((maxHp * Math.abs(k)) / 16);
    seenStamp++;
    let m = 0;
    for (let j = 0; j < n; j++) {
      const h = curList[j];
      const w = curW[h];
      for (let k = 0; k < values.length; k++) {
        const h2 = berry ? eatSitrus(Math.max(0, h - values[k]), maxHp, berry) : Math.max(0, h - values[k]);
        if (h2 < 0 || Math.abs(pct[h2] - after) > tol) continue;
        const add = w * (probs ? probs[k] : equal);
        const h3 = h2 > 0 ? Math.min(maxHp, Math.max(0, h2 + delta)) : 0;
        if (nextSeen[h3] === seenStamp) nextW[h3] += add;
        else {
          nextSeen[h3] = seenStamp;
          nextW[h3] = add;
          nextList[m++] = h3;
        }
      }
    }
    if (m === 0) return 0;
    [curW, nextW] = [nextW, curW];
    [curList, nextList] = [nextList, curList];
    n = m;
  }
  let sum = 0;
  for (let j = 0; j < n; j++) sum += curW[curList[j]];
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
function enumerateAllocations(useDef: boolean, useSpd: boolean, maxSum: number, minSum = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  const maxDef = useDef ? MAX_ABILITY_POINTS_PER_STAT : 0;
  const maxSpd = useSpd ? MAX_ABILITY_POINTS_PER_STAT : 0;
  for (let hp = 0; hp <= MAX_ABILITY_POINTS_PER_STAT; hp++) {
    for (let def = 0; def <= maxDef; def++) {
      for (let spd = 0; spd <= maxSpd; spd++) {
        if (hp + def + spd <= maxSum && hp + def + spd >= minSum) out.push([hp, def, spd]);
      }
    }
  }
  return out;
}

interface FormAccumulator {
  f: FormBase;
  real: { hp: Range; def: Range; spd: Range };
  phys: { w: WeightedValues; r: Range };
  spec: { w: WeightedValues; r: Range };
}

/** 후보 하나(포인트·성격)를 이 폼의 종족값으로 환산해 실수치 범위·내구 지수 가중에 더한다 */
function accumulateForm(
  a: FormAccumulator,
  [hpP, defP, spdP]: [number, number, number],
  combo: NatureCombo,
  [useDef, useSpd]: [boolean, boolean],
  likelihood: number,
): void {
  const hp = Math.floor(a.f.baseStats.hp + 75 + hpP);
  growRange(a.real.hp, hp);
  if (useDef) {
    const d = realStat(combo.defMult, a.f.baseStats.def, defP);
    growRange(a.real.def, d);
    a.phys.w.add(hp * d, likelihood);
    growRange(a.phys.r, hp * d);
  }
  if (useSpd) {
    const d = realStat(combo.spdMult, a.f.baseStats.spd, spdP);
    growRange(a.real.spd, d);
    a.spec.w.add(hp * d, likelihood);
    growRange(a.spec.r, hp * d);
  }
}

function runCandidates(input: InferenceInput, prepared: PreparedObservation[], detailed = false, likeCache?: LikelihoodCache): InferenceResult {
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
  const comboSlot = combos.map((c) => {
    if (!likeCache) return 0;
    let slot = likeCache.slots.get(c.key);
    if (slot === undefined) likeCache.slots.set(c.key, (slot = likeCache.slots.size));
    return slot;
  });

  // 방어 스탯 값별 난수 데미지 캐시 (관측 번호 × 스탯 값)
  const cache = prepared.map(() => new Map<number, RollSet>());
  const rollsFor = (i: number, stat: number): RollSet => {
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
  const [hpRange, defRange, spdRange, realHp, realDef, realSpd, sumRange] = Array.from({ length: 7 }, emptyRange);
  let total = 0;
  let feasible = 0;
  // 메가 전·후 표시(3.1 L1-b): 폼마다 같은 후보를 그 폼의 종족값으로 환산해 실수치 범위·내구 지수를 따로 모은다(가중 계산을 하는 detailed일 때만)
  const forms = detailed ? viewForms(pokemon, input.defender, input.observations.map((o) => o.megaForm), input.viewMegaForms) : [];
  const formAcc: FormAccumulator[] = forms.map((f) => ({
    f,
    real: { hp: emptyRange(), def: emptyRange(), spd: emptyRange() },
    phys: { w: new WeightedValues(), r: emptyRange() },
    spec: { w: new WeightedValues(), r: emptyRange() },
  }));

  // 후보 데미지 범위의 중앙(%)과 관측한 손실 %의 차이(3.6 I2) — 방어 스탯 값별로 한 번만 계산한다
  const centers = prepared.map(() => new Float64Array(1024).fill(Number.NaN));
  const observedLoss = prepared.map((o) => o.before - o.after);
  const centerOf = (i: number, stat: number): number => {
    let v = centers[i][stat];
    if (Number.isNaN(v)) {
      const { values } = rollsFor(i, stat);
      centers[i][stat] = v = (Math.min(...values) + Math.max(...values)) / 2;
    }
    return v;
  };
  const centerGap = (combo: NatureCombo, defP: number, spdP: number, maxHp: number): number => {
    let gap = 0;
    for (let i = 0; i < n; i++) {
      const o = prepared[i];
      const stat = o.parts.defenseKey === "def" ? realStat(combo.defMult, o.baseDef, defP) : realStat(combo.spdMult, o.baseSpd, spdP);
      // 열매를 먹은 줄은 화면 %에 회복이 섞여 있어 그만큼 더한 값이 실제 손실이다
      const loss = observedLoss[i] + (o.berry ? (Math.floor(maxHp / SITRUS_DENOMINATOR) * o.berry * 100) / maxHp : 0);
      gap += Math.abs((centerOf(i, stat) * 100) / maxHp - loss);
    }
    return gap;
  };
  // 구체적인 후보 카드용 상위 목록(3.6 I2) — 가중 계산을 하는 detailed일 때만
  const top = detailed ? new TopLists<[number, number, number, number]>() : null;
  const grow = growRange;
  const record = (hpP: number, defP: number, spdP: number, maxHp: number, defStat: number, spdStat: number) => {
    grow(hpRange, hpP);
    grow(sumRange, hpP + defP + spdP);
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

  for (const [hpP, defP, spdP] of enumerateAllocations(
    useDef,
    useSpd,
    Math.min(MAX_ABILITY_POINTS_TOTAL, input.maxPointsSum ?? MAX_ABILITY_POINTS_TOTAL),
    (input.minPointsSum ?? 0) - MAX_ABILITY_POINTS_PER_STAT * (Number(!useDef) + Number(!useSpd)),
  )) {
    const maxHp = Math.floor(base.hp + 75 + hpP);
    for (let c = 0; c < combos.length; c++) {
      const combo = combos[c];
      const defStat = realStat(combo.defMult, lastDef?.baseDef ?? base.def, defP);
      const spdStat = realStat(combo.spdMult, lastSpd?.baseSpd ?? base.spd, spdP);
      total++;
      groups[c].total++;
      const cacheIdx = likeCache ? ((hpP * GRID + defP) * GRID + spdP) * COMBO_SLOTS + comboSlot[c] : -1;
      let likelihood = likeCache ? likeCache.values[cacheIdx] : -1;
      if (likelihood < 0) {
        const rolls = prepared.map((o, i) =>
          o.parts.defenseKey === "def" ? rollsFor(i, realStat(combo.defMult, o.baseDef, defP)) : rollsFor(i, realStat(combo.spdMult, o.baseSpd, spdP)),
        );
        likelihood = candidateLikelihood(maxHp, rolls, prepared, tol);
        if (likeCache) likeCache.values[cacheIdx] = likelihood;
      }
      if (likelihood <= 0) continue;
      feasible++;
      groups[c].feasible++;
      record(hpP, defP, spdP, maxHp, defStat, spdStat);
      if (detailed) {
        top!.add(TOTAL_POINTS - (hpP + defP + spdP), likelihood, centerGap(combo, defP, spdP, maxHp), () => [hpP, defP, spdP, c]);
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
        for (const a of formAcc) accumulateForm(a, [hpP, defP, spdP], combo, [useDef, useSpd], likelihood);
      }
    }
  }

  const buildCard = ([hpP, defP, spdP, c]: [number, number, number, number], spare: number, likelihood: number, gap: number) => {
    const combo = combos[c];
    const maxHp = Math.floor(base.hp + 75 + hpP);
    const rollSets = prepared.map((o, i) => rollsFor(i, o.parts.defenseKey === "def" ? realStat(combo.defMult, o.baseDef, defP) : realStat(combo.spdMult, o.baseSpd, spdP)));
    return {
      natureLabel: combo.label,
      natureNames: combo.natureNames,
      points: [{ label: "HP", value: hpP }, ...(useDef ? [{ label: "방어", value: defP }] : []), ...(useSpd ? [{ label: "특방", value: spdP }] : [])],
      spare,
      likelihood,
      rollMatch: rollMatchOf(likelihood, n, rollSets[0].values.length, !rollSets[0].probs),
      damagePercent: rollSets.map((r) => ({ min: (Math.min(...r.values) * 100) / maxHp, max: (Math.max(...r.values) * 100) / maxHp })),
      centerGap: gap,
    };
  };
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
    sums: range(sumRange),
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
    candidates: top && feasible > 0 ? top.toCards(buildCard) : null,
    formViews: formAcc.map((a) => ({
      form: a.f.form,
      label: a.f.label,
      real: {
        hp: finishRange(a.real.hp) ?? undefined,
        def: useDef ? (finishRange(a.real.def) ?? undefined) : undefined,
        spd: useSpd ? (finishRange(a.real.spd) ?? undefined) : undefined,
      },
      bulkPhysical: useDef ? bulkOf(a.phys.w, a.phys.r) : null,
      bulkSpecial: useSpd ? bulkOf(a.spec.w, a.spec.r) : null,
    })),
  };
}

/**
 * 관측 전체와 맞는 상대 배분 후보를 좁힌다. 관측이 없으면 null.
 * 관측 사이에 상대가 회복하지 않았다고 가정한다(먹다남은음식·재생력 등은 2차).
 */
export function inferDefense(input: InferenceInput, diagnostics = true, cache?: LikelihoodCache): InferenceResult | null {
  const total = input.observations.length;
  if (total === 0) return null;
  const { prepared, errors } = prepareObservations(input);
  if (errors.some((e) => e !== null)) {
    return { ...emptyResult("invalid", total), observationErrors: errors };
  }
  const result = runCandidates(input, prepared, true, cache);
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
