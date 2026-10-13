import { POKEMON } from "./data";
import type { SpriteFormOptions } from "./sprites";
import { MAX_ABILITY_POINTS_PER_STAT } from "./statCalculator";

/**
 * 스피드 실수치 표(3.4 T1) — 로스터 전체의 (종·폼 × 스피드 성격 3종 × 포인트 0~32) 실수치를 가상의 내림차순 표로 보고,
 * 기준 스피드 주변의 실수치 라인(같은 실수치를 내는 폼들을 한 줄로)만 뽑아 준다. 표 자체는 만들지 않는다(폼마다 값 99개를 훑는 걸로 충분).
 * 도구·순풍·랭크 같은 배율은 표 쪽엔 걸지 않는다 — 기준 포켓몬의 실효 스피드를 넘겨 받는 쪽에서 적용한다.
 */

export interface SpeedForm {
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

/** 같은 실수치를 내는 폼들 — 표의 한 라인 */
export interface SpeedLine {
  value: number;
  rows: SpeedRow[];
}

export interface SpeedNeighbors {
  /** 기준보다 빠른 쪽 가까운 라인들 — 빠른 순(표 위쪽부터) */
  above: SpeedLine[];
  /** 기준과 같은 실수치를 낼 수 있는 폼들(폼마다 가장 적은 포인트의 경우) */
  tie: SpeedRow[];
  /** 기준보다 느린 쪽 가까운 라인들 — 빠른 순 */
  below: SpeedLine[];
  /** 투자와 무관하게 항상 더 빠른 폼·항상 더 느린 폼 수, 나머지(투자에 따라 갈림)는 mixed */
  alwaysFaster: number;
  alwaysSlower: number;
  mixed: number;
}

/** computeRealStats의 스피드 식과 같다(test:inference가 두 값을 대조한다) */
export function speedValue(baseSpe: number, mult: number, points: number): number {
  return Math.floor((baseSpe + 20 + points) * mult);
}

/** 폼 하나의 모든 경우(성격 3종 × 포인트 0~32) */
function formRows(f: SpeedForm): SpeedRow[] {
  return SPEED_NATURES.flatMap((n) =>
    Array.from({ length: MAX_ABILITY_POINTS_PER_STAT + 1 }, (_, points) => ({ form: f, name: f.name, value: speedValue(f.baseSpe, n.mult, points), nature: n.label, points })),
  );
}

/** 비교 함수가 가장 앞서는 줄 하나(없으면 undefined). 동률은 앞쪽 줄이 남아 보정 없음이 대표가 된다 */
const best = (rows: SpeedRow[], cmp: (a: SpeedRow, b: SpeedRow) => number) => rows.reduce<SpeedRow | undefined>((b, r) => (!b || cmp(r, b) < 0 ? r : b), undefined);

/** 값 순으로 정렬된 줄을 같은 값끼리 묶어, 폼이 `count`개 이상 모일 때까지(마지막 라인은 통째로) 라인을 돌려준다 */
function takeLines(sorted: SpeedRow[], count: number): SpeedLine[] {
  const lines: SpeedLine[] = [];
  let taken = 0;
  for (const row of sorted) {
    const last = lines.at(-1);
    if (last?.value === row.value) last.rows.push(row);
    else if (taken >= count) break;
    else lines.push({ value: row.value, rows: [row] });
    taken++;
  }
  return lines;
}

/**
 * 기준 스피드 `speed`보다 빠른/느린 쪽으로 가까운 폼 `count`개 이상(같은 실수치 라인은 통째로)과 동속 가능 폼을 돌려준다.
 * 폼마다 한 줄만 낸다(가장 가까운 값, 값이 같으면 포인트가 적은 쪽).
 */
export function speedNeighbors(speed: number, count = 5): SpeedNeighbors {
  const above: SpeedRow[] = [];
  const below: SpeedRow[] = [];
  const tie: SpeedRow[] = [];
  let alwaysFaster = 0;
  let alwaysSlower = 0;
  for (const f of SPEED_FORMS) {
    const rows = formRows(f);
    const up = best(rows.filter((r) => r.value > speed), (a, b) => a.value - b.value || a.points - b.points);
    const down = best(rows.filter((r) => r.value < speed), (a, b) => b.value - a.value || a.points - b.points);
    const eq = best(rows.filter((r) => r.value === speed), (a, b) => a.points - b.points);
    if (up) above.push(up);
    if (down) below.push(down);
    if (eq) tie.push(eq);
    if (up && !down && !eq) alwaysFaster++;
    if (down && !up && !eq) alwaysSlower++;
  }
  return {
    above: takeLines(above.sort((a, b) => a.value - b.value), count).reverse(),
    tie,
    below: takeLines(below.sort((a, b) => b.value - a.value), count),
    alwaysFaster,
    alwaysSlower,
    mixed: SPEED_FORMS.length - alwaysFaster - alwaysSlower,
  };
}
