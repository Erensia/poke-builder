/**
 * 챔피언스 정수 데미지 공식(2.4 B3 — 사용자 검증 사례 ①~⑩ 16/16 일치). 배틀 엔진(computeDamage)·매치업 난수표·상대 실능치 역산이
 * 모두 이 한 곳을 쓴다. 단계별로 내려서 곱한다:
 *
 *   위력 보정(특성·도구·필드·열거 안 된 곱) → 기본 데미지 ⌊⌊22×위력×공격÷방어⌋÷50⌋+2
 *   → 날씨(내림 쪽 반올림) → 급소(내림) → 난수(내림) → 자속(내림 쪽 반올림) → 상성(내림)
 *   → 최종 보정(생명의구슬·벽·화상·하드록·반감 열매 등을 곱해 내림 쪽 반올림)
 *
 * 근거가 없는 보정(필드·특성·도구 중 미확인분)은 "위력 보정" 한 값으로 묶어 위력에 곱한다 — 사례가 생기면 단계를 옮긴다.
 */

/** 레벨 50 고정 데미지 공식의 22 = ⌊2×50÷5⌋+2 */
const LEVEL_50_TERM = 22;

/** 난수 단계 수와 최솟값(%) — 0.85 ~ 1.00을 1% 간격 16개로 */
export const DAMAGE_ROLL_STEP_COUNT = 16;
export const DAMAGE_ROLL_MIN_PERCENT = 85;

/** 부동소수점 오차(예: 150×(2/3)=99.99999999999999)로 정수 경계가 틀어지지 않게 하는 내림 */
function fl(x: number): number {
  return Math.floor(x + 1e-9);
}

/** 0.5는 내림 쪽으로 반올림(본가 pokeRound). 1e-9는 부동소수점 경계 보정 */
export function roundHalfDown(x: number): number {
  return Math.ceil(x - 0.5 - 1e-9);
}

/**
 * 정수 데미지 공식 재계산용 조각. 방어 실능만 바꿔 다시 돌릴 수 있게(상대 실능치 역산) 방어 스탯은 따로 받는다.
 * 다단히트·고정 데미지 기술은 hitPowers로 타마다 이 공식을 따로 적용한다(고정 데미지 기술은 쓰지 말 것).
 */
export interface DamageParts {
  /** 타별 위력. 단타는 [위력], 스케일샷 5타는 [25×5], 트리플악셀은 [20,40,60], 부자유친은 추가타 포함 */
  hitPowers: number[];
  /** 공격 실능 × 랭크 배율 (급소면 공격측 음수 랭크 무시 반영) */
  attackTerm: number;
  /** 방어측에서 이 기술이 읽는 스탯 */
  defenseKey: "def" | "spd";
  /** 방어 랭크 배율 (급소면 양수 랭크 무시 반영) */
  defenseRankMultiplier: number;
  /** 위력 단계 배율 — 특성·도구(타입 강화 등)·필드·투쟁심 등. 위력에 곱해 내림 쪽 반올림 */
  baseMultiplier: number;
  /** 방어 스탯 단계 배율 — 두꺼운지방 등 스탯·위력을 바꾸는 방어 특성, 날씨 방어 보정 */
  bulkMultiplier: number;
  weatherMultiplier: number;
  /** 급소 배율(1.5, 스나이퍼 2.25). 급소가 아니면 1 */
  critMultiplier: number;
  /** 실제로 적용되는 자속 배율(타입 불일치면 1) */
  stabMultiplier: number;
  typeEffectiveness: number;
  /** 최종 보정(데미지에 곱하는 값) — 생명의구슬·벽·화상·하드록·열매 등 */
  finalMultiplier: number;
  /** 첫 타에만 추가로 곱하는 최종 보정(반감 열매는 첫 타에서 소모). 생략하면 1 */
  firstHitFinalMultiplier?: number;
}

/** 한 타의 정수 데미지. roll은 0.85~1.00(1% 단위면 정수 %로 내린다). 타입 면역이면 0, 아니면 최소 1 */
export function integerHitDamage(
  p: Omit<DamageParts, "hitPowers" | "firstHitFinalMultiplier">,
  power: number,
  defenseRealStat: number,
  roll: number,
  isFirstHit = true,
  firstHitFinalMultiplier = 1,
): number {
  if (p.typeEffectiveness === 0) return 0;
  const boostedPower = Math.max(1, roundHalfDown(power * p.baseMultiplier));
  const attack = fl(p.attackTerm);
  const defense = Math.max(1, fl(fl(defenseRealStat * p.defenseRankMultiplier) * p.bulkMultiplier));
  let d = fl(fl((LEVEL_50_TERM * boostedPower * attack) / defense) / 50) + 2;
  if (p.weatherMultiplier !== 1) d = roundHalfDown(d * p.weatherMultiplier);
  if (p.critMultiplier !== 1) d = fl(d * p.critMultiplier);
  const pct = roll * 100;
  const wholePct = Math.abs(pct - Math.round(pct)) < 1e-9 ? Math.round(pct) : pct;
  d = fl((d * wholePct) / 100);
  if (p.stabMultiplier !== 1) d = roundHalfDown(d * p.stabMultiplier);
  d = fl(d * p.typeEffectiveness);
  const finalMultiplier = p.finalMultiplier * (isFirstHit ? firstHitFinalMultiplier : 1);
  if (finalMultiplier !== 1) d = roundHalfDown(d * finalMultiplier);
  return Math.max(1, d);
}

/** 모든 타가 같은 난수라고 보고 합친 총 데미지(다단히트 포함). 외부 계산기 표기와 같은 방식 */
export function integerTotalDamage(parts: DamageParts, defenseRealStat: number, roll: number): number {
  return parts.hitPowers.reduce(
    (sum, power, i) => sum + integerHitDamage(parts, power, defenseRealStat, roll, i === 0, parts.firstHitFinalMultiplier ?? 1),
    0,
  );
}

/** 16단계 난수(85~100%)별 총 데미지. 난수 순서 그대로(중복 포함) */
export function damageRollTotals(parts: DamageParts, defenseRealStat: number): number[] {
  return Array.from({ length: DAMAGE_ROLL_STEP_COUNT }, (_, k) =>
    integerTotalDamage(parts, defenseRealStat, (DAMAGE_ROLL_MIN_PERCENT + k) / 100),
  );
}
