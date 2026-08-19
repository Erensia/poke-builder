import typeChart from "../data/typeChart.json";
import type { PokemonType } from "../types/pokemon-type";

/** 공격 타입 하나가 방어 타입(1~2개)에 들어가는 배율 (예: 0, 0.25, 0.5, 1, 2, 4) */
export function getEffectiveness(
  attacking: PokemonType,
  defending: PokemonType[],
): number {
  const row = (typeChart as Record<string, Record<string, number>>)[attacking];
  return defending.reduce((mult, def) => mult * (row[def] ?? 1), 1);
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
