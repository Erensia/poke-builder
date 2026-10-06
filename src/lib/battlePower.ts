import type { Move, MoveCategory } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { BaseStats } from "../types/stats";
import type { Ability } from "../types/ability";
import type { PokemonGender } from "../types/pokemon";
import { integerHitDamage } from "./damageFormula";
import { BATTLE_STAT_KEYS, NEUTRAL_STAGES, type StatStages } from "../types/battleStats";

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
 * 투쟁심(Rivalry): 공격측이 이 특성일 때 상대와의 성별 관계로 데미지 배율을 낸다.
 * 같은 성별 ×1.25 · 다른 성별 ×0.75 · 어느 한쪽이라도 성별 불명(null) ×1.0.
 * battleSimulator(실전)·matchupEvaluator(매치업 스냅샷) 양쪽이 공유한다(ver.1.5 §5).
 */
export function rivalryDamageMultiplier(
  ability: Ability | undefined,
  attackerGender: PokemonGender | null,
  defenderGender: PokemonGender | null,
): number {
  if (!ability?.rivalryDamage) return 1;
  if (attackerGender === null || defenderGender === null) return 1;
  return attackerGender === defenderGender ? 1.25 : 0.75;
}

/**
 * 총대장(Supreme Overlord): 등장 시점에 센 쓰러진 같은 편 수(faintedCount, maxCount까지)만큼
 * 공격 기술 위력 ×(1 + perFainted × 수). 수가 없거나 0이면 1. 실전 엔진(hitResolution)과 배틀 AI가 공유한다.
 */
export function supremeOverlordMultiplier(ability: Ability | undefined, faintedCount: number | undefined): number {
  const boost = ability?.powerBoostPerFaintedAlly;
  if (!boost || !faintedCount) return 1;
  return 1 + boost.perFainted * Math.min(faintedCount, boost.maxCount);
}

/**
 * 의욕(Hustle): 물리 기술 위력 ×1.5 (명중률 페널티는 결정력 계산 대상이 아니라 별도 처리).
 * battleSimulator(실전)·matchupEvaluator(매치업 스냅샷) 양쪽이 공유한다(ver.1.5 §5).
 */
export function hustleDamageMultiplier(category: MoveCategory | null, ability: Ability | undefined): number {
  return category === "physical" && ability?.hustleAttackMultiplier !== undefined
    ? ability.hustleAttackMultiplier
    : 1;
}

/**
 * 리플렉터/빛의장막(카테고리 전용)·오로라베일(물리·특수 공통)이 동시에 걸려있을 수 있는 축을
 * 곱셈으로 합산한다 — 급소·틈새포착 등 "스크린을 아예 무시할지"는 호출부가 각자의 상태 모양에
 * 맞춰 미리 판정해서 두 불리언으로 넘긴다(battleSimulator는 진영 상태 그대로, matchupEvaluator는
 * 1턴 스냅샷의 단일 screen 옵션에서 도출 — 입력 모양이 달라 이 부분만은 각자 유지).
 * battleSimulator(실전)·matchupEvaluator(매치업 스냅샷) 양쪽이 공유한다(ver.1.5 §5).
 */
export function screenMultiplierFromFlags(categoryScreenActive: boolean, auroraVeilActive: boolean): number {
  return (categoryScreenActive ? 2 : 1) * (auroraVeilActive ? 2 : 1);
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

/** 분화·해수스파우팅(ver.1.9): 위력 = max(1, ⌊최대 위력 × HP 비율⌋) */
export function userHpScaledPowerValue(maxPower: number, hpFraction: number): number {
  return Math.max(1, Math.floor(maxPower * Math.max(0, Math.min(1, hpFraction))));
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
 * 일렉트릭볼(Electro Ball, 트랙 M5) 위력 — 본가 표: 자신/상대 실효 스피드 비율이 4배 이상 150, 3배 120, 2배 80, 1배 60, 그 미만 40.
 * 상대 스피드가 0 이하면(이론상) 최대 위력.
 */
export function electroBallPowerFromSpeeds(userEffectiveSpeed: number, targetEffectiveSpeed: number): number {
  if (targetEffectiveSpeed <= 0) return 150;
  const ratio = userEffectiveSpeed / targetEffectiveSpeed;
  if (ratio >= 4) return 150;
  if (ratio >= 3) return 120;
  if (ratio >= 2) return 80;
  if (ratio >= 1) return 60;
  return 40;
}

/** 성묘(Last Respects, 트랙 L) 위력 — base + perAlly × 쓰러진 같은 편 수, 최대 300 */
export function faintedAllyPowerValue(base: number, perAlly: number, faintedAllies: number): number {
  return Math.min(300, base + perAlly * Math.max(0, faintedAllies));
}

/** 하드프레스(Hard Press, 트랙 M5) 위력 — base × 상대 남은 HP 비율(내림, 최소 1) */
export function targetHpRatioPowerValue(base: number, currentHp: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  return Math.max(1, Math.floor((base * currentHp) / maxHp));
}

/**
 * 기어오르기(Power Trip)·어시스트파워(Stored Power) 위력 — `base + perStage × Σ max(0, 랭크)`.
 * 이 프로젝트 stages엔 명중률·회피율 랭크가 없어 5스탯(공/방/특공/특방/스피드) 양수분만 합산한다.
 */
export function positiveStagesPowerValue(stages: StatStages, base: number, perStage: number): number {
  const sum = BATTLE_STAT_KEYS.reduce(
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

/**
 * 공격 측 스탯 × 랭크 배율(= computeDamage의 attackStat). 결정력과 별개로 정수 데미지 공식의 분자를 다시 짜야 하는 호출부
 * (상대 실능치 역산)가 쓴다 — computeOffensePower·computeDamage와 같은 스탯 선택(resolveAttackStat)을 공유한다.
 */
export function computeAttackTerm(
  attackerRealStats: BaseStats,
  move: Move,
  attackerStages: StatStages = NEUTRAL_STAGES,
  defenderRealStats?: BaseStats,
  defenderStages: StatStages = NEUTRAL_STAGES,
): number {
  const { stat, stage } = resolveAttackStat(move, attackerRealStats, attackerStages, defenderRealStats, defenderStages);
  return stat * rankStageMultiplier(stage);
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
 * 내구력(결정력과 비교하는 연속값 지표) 기준 상수 — 레벨 50 공식 `HP×방어 ÷ (0.44 × 난수)`의 평균 난수 지점. 판정·AI 처치 타수는
 * 정수 데미지 공식(damageFormula)으로 옮겨 갔고, 결정력&내구력 페이지의 내구력 표시에만 남아 있다.
 */
export const BULK_BASELINE_DIVISOR = 0.411;

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

/** 데미지 난수(damage roll)의 최고값 */
export const MAX_DAMAGE_ROLL = 1.0;

export interface MatchupChance {
  verdict: MatchupVerdict;
  /** 그 판정의 타수로 상대를 격파할 확률(0~1). 확정 1·2타면 1, "3타 이상 필요"면 null */
  koChance: number | null;
  /** 난수 1타일 때만 채운다: [격파하는 난수 롤 수, 16] */
  killingRolls?: readonly [number, number];
}

/**
 * ⚠️ 급소 데미지 배율은 챔피언스 실측값이 아직 미확인 — 우선 본가 값(1.5배)을 그대로 쓴다.
 * 급소가 랭크 하락을 무시하는지(본가 규칙) 여부도 미확인이라, 우선은 그 규칙을 그대로 적용한다.
 * 착수 후 실제 값으로 확인되면 이 상수만 바꾸면 된다.
 */
export const CRITICAL_DAMAGE_MULTIPLIER = 1.5;

export interface DamageOptions {
  typeEffectiveness?: number;
  abilityMultiplier?: number;
  /** 공격 스탯 단계 배율(맹화류·선파워) — 공격 스탯에 곱해 내린다. abilityMultiplier(위력 단계)에는 넣지 않는다. 생략하면 1 */
  attackStatMultiplier?: number;
  itemMultiplier?: number;
  weatherMultiplier?: number;
  /** 필드(그래스/미스트/사이코/일렉트릭)로 인한 배율. 날씨와 별개 축이라 곱셈 슬롯을 따로 둔다 */
  fieldMultiplier?: number;
  attackerStages?: StatStages;
  defenderStages?: StatStages;
  /** 자속보정 배율. 기본 1.5, 적응력이면 2.0 */
  stabMultiplier?: number;
  /** 방어 스탯 단계 배율(두꺼운지방·날씨 방어 보정 등) — 방어 스탯에 곱한다. 최종 단계 배율(벽·열매·하드록)은 finalMultiplier로 */
  bulkMultiplier?: number;
  /** 최종 보정 단계(상성 뒤)에 곱하는 데미지 배율 — 생명의구슬·화상·벽·하드록·반감 열매 등. 생략하면 1 */
  finalMultiplier?: number;
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
 * 공식: damageFormula.ts의 단계별 정수 공식(위력 보정 → 기본 데미지 → 날씨 → 급소 → 난수 → 자속 → 상성 → 최종 보정, 각 단계 내림)
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
    attackStatMultiplier = 1,
    itemMultiplier = 1,
    weatherMultiplier = 1,
    fieldMultiplier = 1,
    attackerStages = NEUTRAL_STAGES,
    defenderStages = NEUTRAL_STAGES,
    stabMultiplier = 1.5,
    bulkMultiplier = 1,
    finalMultiplier = 1,
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

  // 공격 스탯 단계 특성(맹화류·선파워 ×1.5)은 랭크까지 내린 스탯에 곱해 다시 내린다(2.5 사용자 사례: 129×1.5=193.5 → 193)
  const attackStat = Math.floor(rawAttackStat * attackMultiplier + 1e-9) * attackStatMultiplier;

  const stab = move.type && attackerTypes.includes(move.type) ? stabMultiplier : 1;

  // 정수 데미지 공식(damageFormula.ts, 2.4 B3). 위력 단계(특성·도구·필드)·날씨·급소·난수·자속·상성·최종 보정을 단계별로 내린다.
  // 타입 상성 0배(면역)면 0, 아니면 최소 1 — integerHitDamage가 처리한다.
  const damage = integerHitDamage(
    {
      attackTerm: attackStat,
      defenseKey: "def",
      defenseRankMultiplier: defenseMultiplier,
      baseMultiplier: abilityMultiplier * itemMultiplier * fieldMultiplier,
      bulkMultiplier,
      weatherMultiplier,
      critMultiplier: isCritical ? critDamageMultiplier : 1,
      stabMultiplier: stab,
      typeEffectiveness,
      finalMultiplier,
    },
    move.power,
    rawDefenseStat,
    randomRoll,
  );

  return {
    damage,
    damagePercent: damage / defenderRealStats.hp,
  };
}
