/**
 * 챔피언스 정수 데미지 공식(2.4 B3 — 사용자 검증 사례 ①~⑩ 16/16 일치). 배틀 엔진(computeDamage)·매치업 난수표·상대 실능치 역산이
 * 모두 이 한 곳을 쓴다. 단계별로 내려서 곱한다:
 *
 *   위력 보정(특성·도구·필드·열거 안 된 곱) → 기본 데미지 ⌊⌊22×위력×공격÷방어⌋÷50⌋+2
 *   → 날씨(내림 쪽 반올림) → 급소(내림) → 난수(내림) → 자속(내림 쪽 반올림) → 상성(내림)
 *   → 최종 보정(생명의구슬·벽·화상·하드록·반감 열매 등을 곱해 내림 쪽 반올림)
 *
 * 특성 단계(2.5 사용자 사례로 확정): 맹화류·선파워는 공격 스탯에 곱해 내리고(attackTerm), 멀티스케일·복슬복슬·펑크록·파동의방호는
 * 최종 보정(finalMultiplier)에 곱한다. 근거가 없는 보정(미확인 특성·도구)은 "위력 보정" 한 값으로 묶어 위력에 곱한다 — 사례가 생기면 단계를 옮긴다.
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

/**
 * 4096분율(본가·Showdown 방식, 8.3 D3-fix-6). 배율은 분자(정수)로 다루고 value × 분자 ÷ 4096을 0.5는 내림 쪽으로 반올림한다.
 * 한 이벤트의 배율들은 chain4096으로 4096분율을 유지한 채 곱한 뒤 modify4096 한 번으로 적용한다.
 * 데이터의 소수 배율(1.3 등)은 Showdown이 정수 분자로 직접 적는 값과 다를 수 있어 입구(toNumerator)에서 단계별로 바꾼다:
 * 위력 단계 1.3 = 5325(단단한발톱·필드 등), 최종 단계 1.3 = 5324(생명의구슬). 그 밖은 tr(m×4096)(1.2 → 4915, 1.1 → 4505, 0.75·0.5·1.5는 정확).
 */
export type ModifyStage = "power" | "final" | "other";

/** 소수 배율 → 4096분율 분자. 이미 n/4096 꼴(chain4096 결과)이면 그 분자를 그대로 돌려준다 */
export function toNumerator(m: number, stage: ModifyStage = "other"): number {
  const exact = m * 4096;
  const nearest = Math.round(exact);
  if (Math.abs(exact - nearest) < 1e-6) return nearest;
  if (Math.abs(m - 1.3) < 1e-9) return stage === "power" ? 5325 : 5324;
  return Math.trunc(exact);
}

/** value × 배율을 4096분율로 반올림(0.5는 내림). 본가 pokeRound와 같다 */
export function modify4096(value: number, multiplier: number, stage: ModifyStage = "other"): number {
  return Math.trunc((Math.trunc(value * toNumerator(multiplier, stage)) + 2047) / 4096);
}

/** 한 이벤트의 배율들을 4096분율로 이어 곱한 값(분자/4096). 1인 인자는 건너뛴다. 결과는 modify4096에 그대로 넣을 수 있다 */
export function chain4096(stage: ModifyStage, ...factors: number[]): number {
  let acc = 4096;
  for (const f of factors) {
    if (f === 1) continue;
    acc = (acc * toNumerator(f, stage) + 2048) >> 12;
  }
  return acc / 4096;
}

/** 0.5는 내림 쪽으로 반올림(본가 pokeRound). 1e-9는 부동소수점 경계 보정. 방어류를 뚫은 공격의 ×0.25(8.3 B9)도 이 함수를 쓴다 */
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
  /** 공격 실능 × 랭크 배율 (급소면 공격측 음수 랭크 무시 반영) — 맹화류·선파워는 내린 스탯에 곱해 포함한다 */
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
  /** 화상 ×0.5 — 상성 직후 별도 단계(최종 보정 체인 앞, 8.3 D3-fix-6). 생략하면 1 */
  burnMultiplier?: number;
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
  const boostedPower = Math.max(1, modify4096(power, p.baseMultiplier, "power"));
  const attack = fl(p.attackTerm);
  const defense = Math.max(1, modify4096(fl(defenseRealStat * p.defenseRankMultiplier), p.bulkMultiplier));
  let d = fl(fl((LEVEL_50_TERM * boostedPower * attack) / defense) / 50) + 2;
  if (p.weatherMultiplier !== 1) d = modify4096(d, p.weatherMultiplier);
  if (p.critMultiplier !== 1) d = fl(d * p.critMultiplier);
  const pct = roll * 100;
  const wholePct = Math.abs(pct - Math.round(pct)) < 1e-9 ? Math.round(pct) : pct;
  d = fl((d * wholePct) / 100);
  if (p.stabMultiplier !== 1) d = modify4096(d, p.stabMultiplier);
  d = fl(d * p.typeEffectiveness);
  if (p.burnMultiplier !== undefined && p.burnMultiplier !== 1) d = modify4096(d, p.burnMultiplier);
  const finalMultiplier = isFirstHit && firstHitFinalMultiplier !== 1 ? chain4096("final", p.finalMultiplier, firstHitFinalMultiplier) : p.finalMultiplier;
  if (finalMultiplier !== 1) d = modify4096(d, finalMultiplier, "final");
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

/** 총 데미지 후보 — values[k]가 나올 확률이 probs[k](없으면 모두 같은 확률) */
export interface RollSet {
  values: number[];
  probs?: number[];
}

/**
 * 역산용 총 데미지 후보(3.3 V4): 단타는 16단계 난수 그대로, 다단히트는 타마다 독립 난수를 합성곱한 분포.
 * 같은 값은 합쳐서 값 수를 줄인다(3타 4096가지 → 수백 가지).
 */
export function damageRollSet(parts: DamageParts, defenseRealStat: number): RollSet {
  if (parts.hitPowers.length <= 1) return { values: damageRollTotals(parts, defenseRealStat) };
  const dist = singleUseDistribution(parts, defenseRealStat, true);
  return { values: [...dist.keys()], probs: [...dist.values()] };
}

/** 기술을 한 번 쓴 총 데미지 분포(총합 → 확률). 다단히트는 타마다 독립 난수를 합성곱한다(D5). 반감 열매는 첫 사용의 첫 타에만 */
function singleUseDistribution(parts: DamageParts, defenseRealStat: number, isFirstUse: boolean): Map<number, number> {
  let dist = new Map<number, number>([[0, 1]]);
  parts.hitPowers.forEach((power, i) => {
    const next = new Map<number, number>();
    for (let k = 0; k < DAMAGE_ROLL_STEP_COUNT; k++) {
      const d = integerHitDamage(
        parts, power, defenseRealStat, (DAMAGE_ROLL_MIN_PERCENT + k) / 100,
        isFirstUse && i === 0, parts.firstHitFinalMultiplier ?? 1,
      );
      for (const [sum, p] of dist) next.set(sum + d, (next.get(sum + d) ?? 0) + p / DAMAGE_ROLL_STEP_COUNT);
    }
    dist = next;
  });
  return dist;
}

function probabilityAtLeast(dist: Map<number, number>, hp: number): number {
  let sum = 0;
  for (const [damage, p] of dist) if (damage >= hp) sum += p;
  return sum;
}

/**
 * 방어측 HP를 몇 번 쓰면 격파하는지와 그 확률(난수 판정). 1번에 가능하면 uses=1, 아니면 2번(독립 난수), 그래도 안 되면 null.
 * 확정이면 probability가 1(부동소수점 보정 포함).
 */
export function koChanceByUses(parts: DamageParts, defenseRealStat: number, hp: number): { uses: 1 | 2; probability: number } | null {
  const first = singleUseDistribution(parts, defenseRealStat, true);
  const p1 = probabilityAtLeast(first, hp);
  if (p1 > 0) return { uses: 1, probability: p1 > 1 - 1e-9 ? 1 : p1 };
  const second = singleUseDistribution(parts, defenseRealStat, false);
  const two = new Map<number, number>();
  for (const [a, p] of first) for (const [b, q] of second) two.set(a + b, (two.get(a + b) ?? 0) + p * q);
  const p2 = probabilityAtLeast(two, hp);
  return p2 > 0 ? { uses: 2, probability: p2 > 1 - 1e-9 ? 1 : p2 } : null;
}
