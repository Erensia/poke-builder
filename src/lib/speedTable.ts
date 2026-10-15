import { POKEMON } from "./data";
import type { SpriteFormOptions } from "./sprites";

/**
 * 스피드 실수치 표 — 로스터 전체의 (종·폼 × 스피드 성격 3종 × 포인트 0~32) 실수치로, 상대 단계(최속·준속·무투자·최저속)별
 * 추월 분류(3.6 T2)와 포인트 조정(추월 지점·최소 포인트)을 계산한다.
 * 도구·순풍·랭크 같은 배율은 표 쪽엔 걸지 않는다 — 기준 포켓몬의 실효 스피드를 넘겨 받는 쪽에서 적용한다.
 */

interface SpeedForm {
  name: string;
  baseSpe: number;
  /** 스프라이트를 찾는 데 쓰는 종 id·폼 옵션 */
  pokemonId: string;
  sprite: SpriteFormOptions;
}

/** 표의 단위: 종 하나 + 메가폼·폼 변종·크기 변종은 각각 따로(종족값 스피드가 다르다) */
export const SPEED_FORMS: SpeedForm[] = POKEMON.flatMap((p): SpeedForm[] => [
  ...(p.formVariants
    ? p.formVariants.map((f) => ({ name: `${p.name}(${f.label})`, baseSpe: f.baseStats.spe, pokemonId: p.id, sprite: { formVariant: f.id } }))
    : p.sizeForms
      ? p.sizeForms.map((s) => ({ name: `${p.name}(${s.label})`, baseSpe: s.spe, pokemonId: p.id, sprite: { sizeForm: s.id } }))
      : [{ name: p.name, baseSpe: p.baseStats.spe, pokemonId: p.id, sprite: {} }]),
  ...(p.megaEvolutions ?? []).map((m) => ({ name: m.form, baseSpe: m.baseStats.spe, pokemonId: p.id, sprite: { activeMegaForm: m.form } })),
]);

/** 같은 값이면 앞쪽(보정 없음)을 대표로 삼는다 */
const SPEED_NATURES = [
  { label: "보정 없음", mult: 1 },
  { label: "스피드↑", mult: 1.1 },
  { label: "스피드↓", mult: 0.9 },
] as const;

export interface SpeedRow {
  form: SpeedForm;
  name: string;
  value: number;
  nature: string;
  points: number;
}

/** computeRealStats의 스피드 식과 같다(test:inference가 두 값을 대조한다) */
export function speedValue(baseSpe: number, mult: number, points: number): number {
  return Math.floor((baseSpe + 20 + points) * mult);
}

/** 상대 스피드 단계(3.6 T2) — 일반적인 최속·준속·무투자와 트릭룸용 최저속. nature는 `SPEED_NATURES` 인덱스 */
export const SPEED_TIERS = [
  { label: "최속", note: "스피드↑ · 32pt", nature: 1, points: 32 },
  { label: "준속", note: "보정 없음 · 32pt", nature: 0, points: 32 },
  { label: "무투자", note: "보정 없음 · 0pt", nature: 0, points: 0 },
  { label: "최저속", note: "스피드↓ · 0pt", nature: 2, points: 0 },
] as const;
type SpeedTier = (typeof SPEED_TIERS)[number];

export function tierRow(f: SpeedForm, t: SpeedTier): SpeedRow {
  const n = SPEED_NATURES[t.nature];
  return { form: f, name: f.name, value: speedValue(f.baseSpe, n.mult, t.points), nature: n.label, points: t.points };
}

/** 단계마다 모든 폼의 줄 — 값 오름차순(모듈 로드 때 한 번) */
const TIER_ROWS = SPEED_TIERS.map((t) => SPEED_FORMS.map((f) => tierRow(f, t)).sort((a, b) => a.value - b.value));

export interface TierOutlook {
  tier: SpeedTier;
  /** 상대가 더 빠름(추월 못 함) — 가까운 순 */
  fail: SpeedRow[];
  tie: SpeedRow[];
  /** 내가 더 빠름(추월) — 가까운 순 */
  pass: SpeedRow[];
}

/** 내 스피드 `speed`로 단계마다 추월·동속·못 추월하는 폼 */
export function speedOutlook(speed: number): TierOutlook[] {
  return SPEED_TIERS.map((tier, i) => ({
    tier,
    fail: TIER_ROWS[i].filter((r) => r.value > speed),
    tie: TIER_ROWS[i].filter((r) => r.value === speed),
    pass: TIER_ROWS[i].filter((r) => r.value < speed).reverse(),
  }));
}

/** 포인트 0~32별 내 스피드(`speedAt`)가 `value`를 처음 넘는(>) 포인트. 32pt로도 못 넘으면 null */
export function minPointsToPass(speedAt: readonly number[], value: number): number | null {
  const p = speedAt.findIndex((s) => s > value);
  return p < 0 ? null : p;
}

interface SpeedBreakpoint {
  points: number;
  speed: number;
  /** 단계(SPEED_TIERS 순)마다 이 포인트에서 새로 추월하게 된 폼 */
  gains: SpeedRow[][];
}

/** 포인트를 올리다 새로 추월하는 폼이 생기는 지점(0pt와 현재 포인트 `keep`은 항상 포함) */
export function speedBreakpoints(speedAt: readonly number[], keep: number): SpeedBreakpoint[] {
  return speedAt.flatMap((speed, points) => {
    const prev = speedAt[points - 1];
    const gains = TIER_ROWS.map((rows) => (prev === undefined ? [] : rows.filter((r) => r.value >= prev && r.value < speed)));
    return points === 0 || points === keep || gains.some((g) => g.length) ? [{ points, speed, gains }] : [];
  });
}
