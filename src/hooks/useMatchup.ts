import { useState } from "react";
import type { MatchupSlot } from "../types/matchup";
import type { AbilityPoints } from "../types/party";
import type { BattleStatKey } from "../types/battleStats";
import type { WeatherKind } from "../types/weather";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import { NEUTRAL_STAGES } from "../types/battleStats";
import { getMove, getPokemon } from "../lib/data";
import { findMegaFormByStone } from "../lib/pokemonForm";
import {
  MAX_ABILITY_POINTS_PER_STAT,
  MAX_ABILITY_POINTS_TOTAL,
  totalAbilityPoints,
} from "../lib/statCalculator";
import { applyStageDelta, setStage } from "../lib/statStages";

export const EMPTY_MATCHUP_SLOT: MatchupSlot = {
  pokemonId: null,
  ability: null,
  item: null,
  nature: null,
  points: { ...EMPTY_ABILITY_POINTS },
  stages: { ...NEUTRAL_STAGES },
  moveId: null,
};

function useMatchupSlot() {
  const [slot, setSlot] = useState<MatchupSlot>(EMPTY_MATCHUP_SLOT);

  function setPokemon(pokemonId: string) {
    setSlot({ ...EMPTY_MATCHUP_SLOT, pokemonId });
  }

  function clearPokemon() {
    setSlot(EMPTY_MATCHUP_SLOT);
  }

  function setAbility(abilityId: string | null) {
    setSlot((prev) => ({ ...prev, ability: abilityId }));
  }

  function setItem(itemId: string | null) {
    setSlot((prev) => {
      const pokemon = prev.pokemonId ? getPokemon(prev.pokemonId) : undefined;
      const matchedMega = pokemon ? findMegaFormByStone(pokemon, itemId) : undefined;
      return { ...prev, item: itemId, activeMegaForm: matchedMega?.form };
    });
  }

  function setNature(natureId: string | null) {
    setSlot((prev) => ({ ...prev, nature: natureId }));
  }

  /** 기술을 고르면 다단히트 기술 여부에 따라 적중 타수를 최대치로 기본 설정한다 */
  function setMove(moveId: string | null) {
    setSlot((prev) => {
      const move = moveId ? getMove(moveId) : undefined;
      const multiHitCount = move?.multiHitPowers ? move.multiHitPowers.length : undefined;
      return { ...prev, moveId, multiHitCount };
    });
  }

  function setMultiHitCount(count: number) {
    setSlot((prev) => ({ ...prev, multiHitCount: count }));
  }

  function setPoint(stat: keyof AbilityPoints, value: number) {
    setSlot((prev) => {
      const clampedValue = Math.max(0, value);
      const restTotal = totalAbilityPoints(prev.points) - prev.points[stat];
      const maxForStat = Math.min(
        MAX_ABILITY_POINTS_PER_STAT,
        MAX_ABILITY_POINTS_TOTAL - restTotal,
      );
      return { ...prev, points: { ...prev.points, [stat]: Math.min(clampedValue, maxForStat) } };
    });
  }

  function stepPoint(stat: keyof AbilityPoints, delta: number) {
    setSlot((prev) => {
      const currentValue = prev.points[stat];
      const restTotal = totalAbilityPoints(prev.points) - currentValue;
      const maxForStat = Math.min(
        MAX_ABILITY_POINTS_PER_STAT,
        MAX_ABILITY_POINTS_TOTAL - restTotal,
      );
      const nextValue = Math.min(Math.max(0, currentValue + delta), maxForStat);
      if (nextValue === currentValue) return prev;
      return { ...prev, points: { ...prev.points, [stat]: nextValue } };
    });
  }

  function setStageValue(stat: BattleStatKey, value: number) {
    setSlot((prev) => ({ ...prev, stages: setStage(prev.stages, stat, value) }));
  }

  function stepStage(stat: BattleStatKey, delta: number) {
    setSlot((prev) => ({ ...prev, stages: applyStageDelta(prev.stages, stat, delta) }));
  }

  return {
    slot,
    setPokemon,
    clearPokemon,
    setAbility,
    setItem,
    setNature,
    setMove,
    setMultiHitCount,
    setPoint,
    stepPoint,
    setStageValue,
    stepStage,
  };
}

export function useMatchup() {
  const attacker = useMatchupSlot();
  const defender = useMatchupSlot();
  const [weather, setWeather] = useState<WeatherKind | null>(null);

  return { attacker, defender, weather, setWeather };
}
