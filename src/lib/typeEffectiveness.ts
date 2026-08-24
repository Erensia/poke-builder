import typeChart from "../data/typeChart.json";
import type { PokemonType } from "../types/pokemon-type";

/**
 * 공격 타입 하나가 방어 타입(1~2개)에 들어가는 배율 (예: 0, 0.25, 0.5, 1, 2, 4).
 * bypassImmunity를 true로 주면(배짱 등) 방어 타입 중 "이 공격 타입에 면역(0배)"인 타입만
 * 그 요인을 1배로 무시하고, 나머지 타입의 배율은 그대로 곱한다 — 배짱은 면역만 없앨 뿐 반감/
 * 약점 관계는 안 건드리는 본가 규칙. 예: 고스트/독에게 격투 기술 → 고스트의 면역(0)만 1로
 * 바뀌고 독의 반감(0.5)은 그대로 남아 최종 0.5배. 고스트/악이면 악의 약점(2)이 그대로 남아 2배.
 */
export function getEffectiveness(
  attacking: PokemonType,
  defending: PokemonType[],
  options?: { bypassImmunity?: boolean },
): number {
  const row = (typeChart as Record<string, Record<string, number>>)[attacking];
  return defending.reduce((mult, def) => {
    const factor = row[def] ?? 1;
    return mult * (options?.bypassImmunity && factor === 0 ? 1 : factor);
  }, 1);
}

/** 해당 포켓몬(1~2타입)이 각 공격 타입에 대해 갖는 배율 요약 */
export function getDefensiveProfile(
  defending: PokemonType[],
): Record<PokemonType, number> {
  const chart = typeChart as Record<string, Record<string, number>>;
  const profile = {} as Record<PokemonType, number>;
  for (const attacking of Object.keys(chart) as PokemonType[]) {
    profile[attacking] = getEffectiveness(attacking, defending);
  }
  return profile;
}
