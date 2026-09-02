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

/**
 * 기사회생(Reversal)·바둥바둥(Flail) 위력표 — 사용자 현재 HP 비율(%)로 갈린다(사용자 제공 수치, F-2).
 * 71~100 → 20 / 36~70 → 40 / 21~35 → 80 / 11~20 → 100 / 5~10 → 150 / 1~4 → 200.
 * (경계는 백분율 내림 기준 — 예: 35.9%는 "35 이하" 구간이 아니라 "36 이상"으로 본다.)
 * battleSimulator(실 HP)와 matchupEvaluator(스냅샷 HP 비율)가 공유한다.
 */
export function reversalPowerFromHp(currentHp: number, maxHp: number): number {
  const pct = (currentHp / maxHp) * 100;
  if (pct > 70) return 20;
  if (pct > 35) return 40;
  if (pct > 20) return 80;
  if (pct > 10) return 100;
  if (pct > 4) return 150;
  return 200;
}

/**
 * 자이로볼(Gyro Ball) 위력 — 사용자 확정식: `min(150, floor(25 × (상대 실효 스피드 / 자신 실효 스피드 + 1)))`.
 * (본가의 "+1 바깥" 공식과 다르게 괄호 안에 +1.) 실효 스피드 산출(랭크·마비·도구 반영)은 호출부 몫.
 * 자신 스피드가 0 이하면(이론상) 최대 위력 150.
 */
export function gyroBallPowerFromSpeeds(userEffectiveSpeed: number, targetEffectiveSpeed: number): number {
  if (userEffectiveSpeed <= 0) return 150;
  return Math.min(150, Math.max(1, Math.floor(25 * (targetEffectiveSpeed / userEffectiveSpeed + 1))));
}

/**
 * 기어오르기(Power Trip)·어시스트파워(Stored Power) 위력 — `base + perStage × Σ max(0, 랭크)`.
 * 이 프로젝트 stages엔 명중률·회피율 랭크가 없어 5스탯(공/방/특공/특방/스피드) 양수분만 합산한다.
 */
export function positiveStagesPowerValue(stages: StatStages, base: number, perStage: number): number {
  const sum = (["atk", "def", "spa", "spd", "spe"] as const).reduce(
    (acc, key) => acc + Math.max(0, stages[key]),
    0,
  );
  return base + perStage * sum;
}

/**
 * 헤비봄버·히트스탬프(Move.weightRatioPower) 위력 — 상대 몸무게가 자신 대비 얼마나 가벼운지로 갈린다.
 * ≤1/5 → 120 · ≤1/4 → 100 · ≤1/3 → 80 · ≤1/2 → 60 · 그 외 → 40 (§3-6).
 */
export function weightRatioPowerValue(userKg: number, targetKg: number): number {
  if (userKg <= 0) return 40;
  const ratio = targetKg / userKg;
  if (ratio <= 1 / 5) return 120;
  if (ratio <= 1 / 4) return 100;
  if (ratio <= 1 / 3) return 80;
  if (ratio <= 1 / 2) return 60;
  return 40;
}

/**
 * 풀묶기·안다리걸기(Move.targetAbsoluteWeightPower) 위력 — 상대의 절대 몸무게(kg)로 갈린다.
 * <10 → 20 · <25 → 40 · <50 → 60 · <100 → 80 · <200 → 100 · 그 이상 → 120 (§3-6).
 */
export function absoluteWeightPowerValue(targetKg: number): number {
  if (targetKg < 10) return 20;
  if (targetKg < 25) return 40;
  if (targetKg < 50) return 60;
  if (targetKg < 100) return 80;
  if (targetKg < 200) return 100;
  return 120;
}

/** pokemon.weightKg가 아직 안 채워진 동안 몸무게 기반 4기술이 쓸 임시 위력 (§3-6 데이터 입력 시 자동 해소) */
export const WEIGHT_MOVE_FALLBACK_POWER = 60;

/**
 * 데미지·결정력에 쓸 "공격 측 스탯" 실능과 그 랭크를 고른다.
 *  - 기본: 물리 = 공격 / 특수 = 특공 (그 스탯의 자신 랭크)
 *  - offensiveStatOverride(바디프레스): 자신의 def/spd/spe 실능·랭크 (분류는 그대로)
 *  - usesTargetAttackStat(속임수): 방어자의 공격 실능·랭크 (자신 공격 랭크는 무시). 방어자
 *    정보가 없으면 자신 공격으로 폴백.
 * 급소 시 "공격측에 불리한 음수 랭크 무시"는 호출부에서 이 stage에 그대로 적용한다.
 */
function resolveAttackStat(
  move: Move,
  attackerRealStats: BaseStats,
  attackerStages: StatStages,
  defenderRealStats?: BaseStats,
  defenderStages: StatStages = NEUTRAL_STAGES,
): { stat: number; stage: number } {
  if (move.usesTargetAttackStat && defenderRealStats) {
    return { stat: defenderRealStats.atk, stage: defenderStages.atk };
  }
  if (move.offensiveStatOverride) {
    const key = move.offensiveStatOverride;
    return { stat: attackerRealStats[key], stage: attackerStages[key] };
  }
  const key = move.category === "physical" ? "atk" : "spa";
  return { stat: attackerRealStats[key], stage: attackerStages[key] };
}

/**
 * 데미지·내구력에 쓸 "방어 측 스탯" 실능과 그 랭크를 고른다.
 *  - 기본: 물리 = 방어 / 특수 = 특방
 *  - hitsDefensiveStat(사이코쇼크): 분류가 특수여도 방어자의 물리 방어(또는 지정 스탯)로 받는다
 */
function resolveDefenseStat(
  move: Move,
  defenderRealStats: BaseStats,
  defenderStages: StatStages,
): { stat: number; stage: number } {
  const key = move.hitsDefensiveStat ?? (move.category === "physical" ? "def" : "spd");
  return { stat: defenderRealStats[key], stage: defenderStages[key] };
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
  /** 속임수(usesTargetAttackStat)가 방어자의 공격 실능·랭크를 읽을 때만 필요. 없으면 자신 공격으로 폴백 */
  defenderRealStats?: BaseStats;
  defenderStages?: StatStages;
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
    defenderRealStats,
    defenderStages,
  } = options;

  const { stat: attackStat, stage } = resolveAttackStat(
    move,
    attackerRealStats,
    attackerStages,
    defenderRealStats,
    defenderStages,
  );
  const stab = move.type && attackerTypes.includes(move.type) ? stabMultiplier : 1;
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
  /**
   * 사이코쇼크류(Move.hitsDefensiveStat) — 분류가 특수여도 상대의 물리 방어(또는 지정 스탯)로
   * 내구력을 낸다. category 인자는 결정력·스크린 판정용 그대로 두고, 방어 스탯 축만 이걸로 바꾼다.
   */
  defensiveStatOverride?: "def" | "spd";
}

/**
 * 내구력 = (체력 실능 × 방어(또는 특방) 실능 ÷ 0.411) × 방어 랭크업 배율 × 기타 배율
 */
export function computeBulkPower(
  defenderRealStats: BaseStats,
  category: "physical" | "special",
  options: DefensePowerOptions = {},
): number {
  const { defenderStages = NEUTRAL_STAGES, bulkMultiplier = 1, defensiveStatOverride } = options;
  const defenseKey = defensiveStatOverride ?? (category === "physical" ? "def" : "spd");
  const defenseStat = defenderRealStats[defenseKey];
  const stage = defenderStages[defenseKey];
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

/** 데미지 난수 단계 수. 0.85, 0.86, ..., 1.00을 0.01 간격으로 끊은 16개 값을 각 1/16 균등으로 근사한다 */
export const DAMAGE_ROLL_STEPS = 16;

export interface MatchupChance {
  verdict: MatchupVerdict;
  /** 그 판정의 타수로 상대를 격파할 확률(0~1). 확정 1·2타면 1, "3타 이상 필요"면 null */
  koChance: number | null;
  /** 난수 1타일 때만 채운다: [격파하는 난수 롤 수, DAMAGE_ROLL_STEPS(=16)] */
  killingRolls?: readonly [number, number];
}

/**
 * 한 방이 상대 현재 HP를 정확히 채우는 "최소 격파 난수" rho*.
 * evaluateMatchup이 쓰는 관계식 offensePower = bulkPower × 0.411 / (0.44 × rho) 를 rho에 대해 푼 것.
 * random-1hit이면 rho* ∈ [0.85, 1.00], random-2hit이면 rho* ∈ [1.70, 2.00] 범위에 들어온다.
 */
function minKillingRoll(offensePower: number, bulkPower: number): number {
  return (bulkPower * BULK_BASELINE_DIVISOR) / (GUARANTEED_SURVIVE_2HIT_DIVISOR * offensePower);
}

/** k번째(0~15) 데미지 난수 값. (85+k)/100 으로 잡아 0.85·…·1.00을 정확히 표현한다 */
function damageRoll(k: number): number {
  return (85 + k) / 100;
}

/** 16개 난수 중 rhoStar 이상인 롤 수 (0~16). 1e-9는 부동소수점 경계 흔들림 보정 */
function rollsAtLeast(rhoStar: number): number {
  let n = 0;
  for (let k = 0; k < DAMAGE_ROLL_STEPS; k++) {
    if (damageRoll(k) + 1e-9 >= rhoStar) n++;
  }
  return n;
}

/**
 * evaluateMatchup의 5단계 판정에 더해, 난수 판정일 때 "그 타수로 격파할 확률"까지 낸다.
 * - random-1hit: 16개 난수 중 격파 롤 수 / 16
 * - random-2hit: 독립 두 난수(16×16=256쌍) 중 rho1+rho2 ≥ rho* 인 비율
 *   (한 방 데미지 = 상대 HP × rho/rho* 이므로 두 방 합이 rho* 이상이면 2타에 격파)
 * - 확정 1·2타: 1 (표기는 UI에서 생략), 3타 이상 필요: null
 * offensePower가 0(타입 무효)이면 evaluateMatchup이 needs-3hit-plus를 주므로 rho* 계산에 안 들어간다.
 */
export function evaluateMatchupChance(offensePower: number, bulkPower: number): MatchupChance {
  const verdict = evaluateMatchup(offensePower, bulkPower);

  if (verdict === "guaranteed-1hit" || verdict === "guaranteed-2hit") {
    return { verdict, koChance: 1 };
  }
  if (verdict === "needs-3hit-plus") {
    return { verdict, koChance: null };
  }

  const rhoStar = minKillingRoll(offensePower, bulkPower);

  if (verdict === "random-1hit") {
    const killing = rollsAtLeast(rhoStar);
    return { verdict, koChance: killing / DAMAGE_ROLL_STEPS, killingRolls: [killing, DAMAGE_ROLL_STEPS] };
  }

  // random-2hit
  let killingPairs = 0;
  for (let i = 0; i < DAMAGE_ROLL_STEPS; i++) {
    for (let j = 0; j < DAMAGE_ROLL_STEPS; j++) {
      if (damageRoll(i) + damageRoll(j) + 1e-9 >= rhoStar) killingPairs++;
    }
  }
  return { verdict, koChance: killingPairs / (DAMAGE_ROLL_STEPS * DAMAGE_ROLL_STEPS) };
}

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
  /** 급소 데미지 배율 오버라이드(스나이퍼=2.25). 생략하면 기본 CRITICAL_DAMAGE_MULTIPLIER(1.5). */
  critDamageMultiplier?: number;
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
    critDamageMultiplier = CRITICAL_DAMAGE_MULTIPLIER,
    randomRoll = MAX_DAMAGE_ROLL,
  } = options;

  // 공격/방어 스탯 축은 카테고리 기본값 + 특수 로직 플래그(바디프레스=offensiveStatOverride,
  // 속임수=usesTargetAttackStat, 사이코쇼크=hitsDefensiveStat)를 반영해 고른다.
  const { stat: rawAttackStat, stage: attackStage } = resolveAttackStat(
    move,
    attackerRealStats,
    attackerStages,
    defenderRealStats,
    defenderStages,
  );
  const { stat: rawDefenseStat, stage: defenseStage } = resolveDefenseStat(move, defenderRealStats, defenderStages);
  // 급소 맞으면 공격측에 불리한(음수) 랭크와 방어측에 유리한(양수) 랭크를 무시한다 (본가 규칙, 미확인 — 위 주석 참고)
  const attackMultiplier = rankStageMultiplier(isCritical ? Math.max(0, attackStage) : attackStage);
  const defenseMultiplier = rankStageMultiplier(isCritical ? Math.min(0, defenseStage) : defenseStage);

  const attackStat = rawAttackStat * attackMultiplier;
  const defenseStat = rawDefenseStat * defenseMultiplier;

  const stab = move.type && attackerTypes.includes(move.type) ? stabMultiplier : 1;
  const critMultiplier = isCritical ? critDamageMultiplier : 1;

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
