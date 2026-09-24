import { type Ability } from "@/types/ability";
import { type HazardState } from "@/types/battle";
import { type PokemonType } from "@/types/pokemon-type";
import { getEffectiveness } from "@/lib/typeEffectiveness";

/** 압정뿌리기 층수별 등장 데미지 비율 (사용자 확정: 1→1/16 · 2→1/8 · 3→1/4) */
const SPIKES_DAMAGE_FRACTION_BY_LAYER: Record<number, number> = { 1: 1 / 16, 2: 1 / 8, 3: 1 / 4 };
/** 스텔스록 등장 데미지 기준 비율(바위 상성 배율을 곱한다) */
const STEALTH_ROCK_BASE_FRACTION = 1 / 8;

/**
 * 압정뿌리기·독압정·끈적끈적네트가 실제로 발동하는 "접지" 상태인지(Phase 8 §6).
 * 비행 타입, 부유·천정부지(땅 면역 특성) 보유자는 비접지. 에어벌룬·텔레키네시스 등은
 * 로스터에 없어 미반영(fieldEffects와 동일한 단순화). 스텔스록은 접지 무관이라 이 판정을 안 쓴다.
 */
export function isGroundedForHazards(types: PokemonType[], ability: Ability | undefined): boolean {
  if (types.includes("비행")) return false;
  if (ability?.grantsImmunityToTypes?.includes("땅")) return false;
  return true;
}

/** 스텔스록 등장 데미지(바위 상성 배율, 매직가드가 막음). 맞지 않으면 0 */
export function calcStealthRockDamage(
  maxHp: number,
  types: PokemonType[],
  ability: Ability | undefined,
  hazards: HazardState,
): number {
  if (!hazards.stealthRock || ability?.negatesIndirectDamage) return 0;
  const eff = getEffectiveness("바위", types);
  if (eff <= 0) return 0;
  return Math.max(1, Math.floor(maxHp * STEALTH_ROCK_BASE_FRACTION * eff));
}

/** 압정뿌리기 등장 데미지(접지 대상만, 매직가드가 막음). 맞지 않으면 0 */
export function calcSpikesDamage(
  maxHp: number,
  types: PokemonType[],
  ability: Ability | undefined,
  hazards: HazardState,
): number {
  if (hazards.spikesLayers <= 0 || ability?.negatesIndirectDamage) return 0;
  if (!isGroundedForHazards(types, ability)) return 0;
  const frac = SPIKES_DAMAGE_FRACTION_BY_LAYER[hazards.spikesLayers] ?? 1 / 16;
  return Math.max(1, Math.floor(maxHp * frac));
}

/**
 * 교체로 등장할 때 설치물로 즉시 받는 데미지 합계(스텔스록 + 압정뿌리기) — 부수효과 없는 순수 계산.
 * 독압정 중독·끈적끈적네트 스피드 하락은 데미지가 아니라 entry_cost에 포함하지 않는다.
 * 실전 교체 처리(switching.ts의 applyEntryHazardsOnSwitchIn)와 배틀 AI(entry_cost 예측)가 같은 함수를 쓴다.
 */
export function calcEntryHazardDamage(
  maxHp: number,
  types: PokemonType[],
  ability: Ability | undefined,
  hazards: HazardState,
): number {
  return calcStealthRockDamage(maxHp, types, ability, hazards) + calcSpikesDamage(maxHp, types, ability, hazards);
}
