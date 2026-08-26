import { useState } from "react";
import type { MatchupSlot } from "../types/matchup";
import type { AbilityPoints, PartySlot } from "../types/party";
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

  /**
   * 샘플(빌드) 프리셋 불러오기(Phase 6 §1-3). 매치업 페이지는 기술을 1개(moveId)만 갖고 랭크
   * 상태(stages)도 별도로 관리하는 구조라 PartySlot(기술 4개)과 그대로 안 맞는다 — 사용자 확인:
   * "기술 배치는 불러오지 않는다"로 확정(2026-08-27). 그래서 포켓몬/특성/도구/성격/포인트만
   * 가져오고, 기술 관련 필드(moveId·multiHitCount)와 랭크(stages)는 포켓몬을 새로 고를 때와
   * 똑같이 EMPTY_MATCHUP_SLOT 기준으로 초기화한다. 매치업 페이지에서 샘플을 "저장"하는 기능은
   * 만들지 않는다(사용자 확인) — 저장은 파티 편성/대전 로그 화면에서만.
   */
  function loadFromPartySlot(partySlot: PartySlot) {
    setSlot({
      ...EMPTY_MATCHUP_SLOT,
      pokemonId: partySlot.pokemonId,
      activeMegaForm: partySlot.activeMegaForm,
      ability: partySlot.ability,
      item: partySlot.item,
      nature: partySlot.nature,
      points: partySlot.points,
    });
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
    loadFromPartySlot,
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
