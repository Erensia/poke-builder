import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { BaseStats } from "../types/stats";
import { NEUTRAL_STAGES, type StatStages } from "../types/battleStats";

/**
 * 랭크업/랭크다운 배율. -6 ~ +6.
 * x랭크일 때 (k + max[0,x]) / (k - min[0,x]).
 * 공격/방어/특공/특방/스피드는 k=2 (기본값) — +1랭크마다 50%씩 증가, -1랭크는 67%, -2랭크는 50%.
 * 명중률/회피율처럼 다른 랭크 체계가 생기면 k=3 등으로 재사용할 수 있게 파라미터화했다.
 */
export function rankStageMultiplier(stage: number, k = 2): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return (k + Math.max(0, clamped)) / (k - Math.min(0, clamped));
}

/** 스피드 랭크까지 반영한 실질 스피드. 턴 순서 계산에 사용 */
export function computeEffectiveSpeed(realSpeed: number, stages: StatStages = NEUTRAL_STAGES): number {
  return realSpeed * rankStageMultiplier(stages.spe);
}

export interface OffensePowerOptions {
  /** 타입 상성 배율 (0, 0.25, 0.5, 1, 2, 4). 상대를 모르면 생략 = 1 */
  typeEffectiveness?: number;
  /** 특성으로 인한 배율 (예: 천하장사 물리 2배) */
  abilityMultiplier?: number;
  /** 지닌 도구로 인한 배율 (예: 타입 강화 도구 1.2배) */
  itemMultiplier?: number;
  /** 날씨로 인한 배율 */
  weatherMultiplier?: number;
  /** 필드(그래스/미스트/사이코/일렉트릭)로 인한 배율 */
  fieldMultiplier?: number;
  /** 공격자의 현재 랭크 상태. 기술 카테고리에 맞춰 공격/특공 랭크를 자동으로 골라 쓴다 */
  attackerStages?: StatStages;
  /** 자속보정 배율. 기본 1.5, 적응력이면 2.0 (resolveStabMultiplier로 구한다) */
  stabMultiplier?: number;
}

/**
 * 결정력 = 공격(또는 특공) 실능 × 기술 위력 × 자속(기본 1.5) × 상성 × 특성 × 도구 × 날씨 × 랭크업 배율
 * status 기술(위력 없음)은 결정력 개념이 없으므로 null을 반환한다.
 */
export function computeOffensePower(
  attackerRealStats: BaseStats,
  attackerTypes: PokemonType[],
  move: Move,
  options: OffensePowerOptions = {},
): number | null {
  if (move.power === null || move.category === "status" || move.category === null) return null;

  const {
    typeEffectiveness = 1,
    abilityMultiplier = 1,
    itemMultiplier = 1,
    weatherMultiplier = 1,
    fieldMultiplier = 1,
    attackerStages = NEUTRAL_STAGES,
    stabMultiplier = 1.5,
  } = options;

  const attackStat = move.category === "physical" ? attackerRealStats.atk : attackerRealStats.spa;
  const stab = move.type && attackerTypes.includes(move.type) ? stabMultiplier : 1;
  const stage = move.category === "physical" ? attackerStages.atk : attackerStages.spa;
  const rankMultiplier = rankStageMultiplier(stage);

  return (
    attackStat *
    move.power *
    stab *
    typeEffectiveness *
    abilityMultiplier *
    itemMultiplier *
    weatherMultiplier *
    fieldMultiplier *
    rankMultiplier
  );
}

/**
 * 내구력 계산에 쓰는 기준 상수들. 전부 레벨 50 상세 데미지 공식에서
 * `HP×방어 ÷ (0.44 × 난수)` 형태로 직접 유도된다 (0.44 = 22÷50, 난수 0.85~1.00).
 *  - 0.374 = 0.44 × 0.85 (최저 난수) → 확정 1타 기준
 *  - 0.411 = 0.44 × 0.9341(대략 50% 지점 난수) → 결정력=내구력이면 50% 확률
 *  - 0.44  = 0.44 × 1.00 (최고 난수) → 확정 2타(=1타로는 절대 안 죽음) 기준
 * 셋 다 "체력×방어"를 각자 독립적으로 나누는 값이지, 내구력(÷0.411)을 한 번 더 나누는 게 아니다.
 */
export const BULK_BASELINE_DIVISOR = 0.411;
export const GUARANTEED_OHKO_DIVISOR = 0.374;
export const GUARANTEED_SURVIVE_2HIT_DIVISOR = 0.44;
/**
 * 확정 2타(난수 없이 2번 만에 확정 격파) 기준.
 * "최저 난수 데미지 하나가 상대 HP의 절반 이상"이면 최저 난수 두 번을 합쳐도 반드시 HP를 넘는다는
 * 원리라서, 확정 1타 기준(0.374)의 정확히 2배(0.748)가 된다.
 */
export const GUARANTEED_2HIT_DIVISOR = GUARANTEED_OHKO_DIVISOR * 2;
/**
 * 난수로라도 2타에 격파 가능한 하한선. "최고 난수 데미지 하나가 상대 HP의 절반 이상"이면
 * 최고 난수 두 번을 합쳐 HP를 넘길 수 있다는 뜻이라, 1타 불가 기준(0.44)의 정확히 2배(0.88)가 된다.
 * 이보다 낮으면 최고 난수로도 2타 안에 못 죽여서 3타 이상이 필요하다.
 */
export const POSSIBLE_2HIT_DIVISOR = GUARANTEED_SURVIVE_2HIT_DIVISOR * 2;

export interface DefensePowerOptions {
  /** 방어자의 현재 랭크 상태. 카테고리에 맞춰 방어/특방 랭크를 자동으로 골라 쓴다 */
  defenderStages?: StatStages;
  /** 방어 관련 특성/도구 배율 (예: 두꺼운지방으로 해당 타입 데미지 절반 → 내구력 2배로 표현 가능) */
  bulkMultiplier?: number;
}

/**
 * 내구력 = (체력 실능 × 방어(또는 특방) 실능 ÷ 0.411) × 방어 랭크업 배율 × 기타 배율
 */
export function computeBulkPower(
  defenderRealStats: BaseStats,
  category: "physical" | "special",
  options: DefensePowerOptions = {},
): number {
  const { defenderStages = NEUTRAL_STAGES, bulkMultiplier = 1 } = options;
  const defenseStat = category === "physical" ? defenderRealStats.def : defenderRealStats.spd;
  const stage = category === "physical" ? defenderStages.def : defenderStages.spd;
  const rankMultiplier = rankStageMultiplier(stage);

  return (
    (defenderRealStats.hp * defenseStat) / BULK_BASELINE_DIVISOR
  ) * rankMultiplier * bulkMultiplier;
}

/**
 * 확정 1타 / 난수 1타 / 확정 2타 / 난수 2타 / 3타 이상 필요 — 전부 상세 데미지 공식
 * (레벨 50, 난수 0.85~1.00)에서 엄밀하게 유도된 5단계 판정.
 */
export type MatchupVerdict =
  | "guaranteed-1hit"
  | "random-1hit"
  | "guaranteed-2hit"
  | "random-2hit"
  | "needs-3hit-plus";

/**
 * 결정력과 (0.411 기준으로 계산된) 내구력을 비교해 판정한다.
 * bulkPower는 반드시 computeBulkPower()의 기본 divisor(0.411)로 계산된 값이어야 한다 —
 * 내부에서 0.411/각 상수 비율로 환산해서 "체력×방어를 각 상수로 직접 나눈 값"과
 * 동등하게 비교한다 (bulkPower를 그 상수로 다시 나누면 안 됨).
 */
export function evaluateMatchup(offensePower: number, bulkPower: number): MatchupVerdict {
  const threshold = (divisor: number) => bulkPower * (BULK_BASELINE_DIVISOR / divisor);

  if (offensePower > threshold(GUARANTEED_OHKO_DIVISOR)) return "guaranteed-1hit";
  if (offensePower >= threshold(GUARANTEED_SURVIVE_2HIT_DIVISOR)) return "random-1hit";
  if (offensePower >= threshold(GUARANTEED_2HIT_DIVISOR)) return "guaranteed-2hit";
  if (offensePower >= threshold(POSSIBLE_2HIT_DIVISOR)) return "random-2hit";
  return "needs-3hit-plus";
}

/**
 * 챔피언스는 랭크전 기준 레벨 50 고정 (Phase 2 기획 문서에서 리서치로 확인).
 * 본가 데미지 공식의 레벨 항 floor(2×Level/5 + 2)에 50을 대입하면 22로 고정된다.
 * evaluateMatchup의 0.374/0.411/0.44 상수도 이 22가 전제된 값이라 서로 정합적이다.
 */
export const LEVEL_50_TERM = Math.floor((2 * 50) / 5 + 2);

/** 데미지 난수(damage roll)의 최저/최고값. 실제로는 이 사이 16단계 중 하나가 뽑힌다 */
export const MIN_DAMAGE_ROLL = 0.85;
export const MAX_DAMAGE_ROLL = 1.0;

/**
 * ⚠️ 급소 데미지 배율은 챔피언스 실측값이 아직 미확인 — 우선 본가 값(1.5배)을 그대로 쓴다.
 * 급소가 랭크 하락을 무시하는지(본가 규칙) 여부도 미확인이라, 우선은 그 규칙을 그대로 적용한다.
 * 착수 후 실제 값으로 확인되면 이 상수만 바꾸면 된다.
 */
const CRITICAL_DAMAGE_MULTIPLIER = 1.5;

export interface DamageOptions {
  typeEffectiveness?: number;
  abilityMultiplier?: number;
  itemMultiplier?: number;
  weatherMultiplier?: number;
  /** 필드(그래스/미스트/사이코/일렉트릭)로 인한 배율. 날씨와 별개 축이라 곱셈 슬롯을 따로 둔다 */
  fieldMultiplier?: number;
  attackerStages?: StatStages;
  defenderStages?: StatStages;
  /** 자속보정 배율. 기본 1.5, 적응력이면 2.0 */
  stabMultiplier?: number;
  /** 방어 관련 특성/도구 배율 (두꺼운지방 등). computeBulkPower의 bulkMultiplier와 같은 값 — 데미지는 반대로 나눈다 */
  bulkMultiplier?: number;
  /** 급소 여부. true면 급소 배율을 곱하고, 방어측 랭크 상승/공격측 랭크 하락은 무시한다(본가 규칙) */
  isCritical?: boolean;
  /** 0.85~1.00 사이 데미지 난수. 생략하면 1.00(최고값)으로 계산 — 최저/평균을 보고 싶으면 명시적으로 넘긴다 */
  randomRoll?: number;
}

export interface DamageResult {
  /** 실제 데미지 정수값 */
  damage: number;
  /** 방어측 최대 HP 대비 비율 (0~1 초과 가능) */
  damagePercent: number;
}

/**
 * 레벨 50 고정 전제로 실제 데미지 숫자와 %HP까지 계산하는 상세 공식.
 * evaluateMatchup(결정력 vs 내구력 비율로 5단계만 판정)과 달리, 대전 로그에 "47%의 데미지를
 * 입었다" 같은 문구를 넣을 때 필요한 실제 숫자를 낸다. status 기술이면 null.
 *
 * 공식: floor(floor(LEVEL_50_TERM × 위력 × 공격/방어) ÷ 50 + 2) × (자속×상성×특성×도구×날씨×급소×난수÷방어배율)
 */
export function computeDamage(
  attackerRealStats: BaseStats,
  defenderRealStats: BaseStats,
  attackerTypes: PokemonType[],
  move: Move,
  options: DamageOptions = {},
): DamageResult | null {
  if (move.power === null || move.category === "status" || move.category === null) return null;

  const {
    typeEffectiveness = 1,
    abilityMultiplier = 1,
    itemMultiplier = 1,
    weatherMultiplier = 1,
    fieldMultiplier = 1,
    attackerStages = NEUTRAL_STAGES,
    defenderStages = NEUTRAL_STAGES,
    stabMultiplier = 1.5,
    bulkMultiplier = 1,
    isCritical = false,
    randomRoll = MAX_DAMAGE_ROLL,
  } = options;

  const isPhysical = move.category === "physical";
  const attackStage = isPhysical ? attackerStages.atk : attackerStages.spa;
  const defenseStage = isPhysical ? defenderStages.def : defenderStages.spd;
  // 급소 맞으면 공격측에 불리한(음수) 랭크와 방어측에 유리한(양수) 랭크를 무시한다 (본가 규칙, 미확인 — 위 주석 참고)
  const attackMultiplier = rankStageMultiplier(isCritical ? Math.max(0, attackStage) : attackStage);
  const defenseMultiplier = rankStageMultiplier(isCritical ? Math.min(0, defenseStage) : defenseStage);

  const attackStat = (isPhysical ? attackerRealStats.atk : attackerRealStats.spa) * attackMultiplier;
  const defenseStat = (isPhysical ? defenderRealStats.def : defenderRealStats.spd) * defenseMultiplier;

  const stab = move.type && attackerTypes.includes(move.type) ? stabMultiplier : 1;
  const critMultiplier = isCritical ? CRITICAL_DAMAGE_MULTIPLIER : 1;

  const base = Math.floor(Math.floor((LEVEL_50_TERM * move.power * attackStat) / defenseStat) / 50) + 2;

  const modifier =
    (stab *
      typeEffectiveness *
      abilityMultiplier *
      itemMultiplier *
      weatherMultiplier *
      fieldMultiplier *
      critMultiplier *
      randomRoll) /
    bulkMultiplier;

  // 타입 상성 0배(면역)면 데미지도 반드시 0이어야 한다 — 아래 최소 1 보정은 면역이 아닌 경우에만 적용
  const damage = typeEffectiveness === 0 ? 0 : Math.max(1, Math.floor(base * modifier));

  return {
    damage,
    damagePercent: damage / defenderRealStats.hp,
  };
}
