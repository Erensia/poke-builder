import { useState } from "react";
import type { AbilityPoints, PartySlot } from "../types/party";
import { EMPTY_ABILITY_POINTS } from "../types/party";
import type { WeatherKind } from "../types/weather";
import { getPokemon } from "../lib/data";
import { findMegaFormByStone } from "../lib/pokemonForm";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL, totalAbilityPoints } from "../lib/statCalculator";

/**
 * 대전 로그(다중 턴 시뮬레이션) 화면의 셋업 상태. PartySlot을 그대로 쓴다 — 포켓몬/기술 4개/
 * 특성/도구/성격/능력포인트까지 필요한 필드가 정확히 같고, EvaluatorSlot도 만족해서
 * createBattleState에 바로 넘길 수 있다. 랭크·상태이상 등 배틀 중 바뀌는 값은 BattleFighterState
 * 쪽 책임이라 여기엔 없다.
 */
function emptySlot(pokemonId: string): PartySlot {
  return {
    pokemonId,
    moves: [null, null, null, null],
    ability: null,
    item: null,
    nature: null,
    points: { ...EMPTY_ABILITY_POINTS },
  };
}

function useBattleSetupSlot() {
  const [slot, setSlot] = useState<PartySlot | null>(null);

  function setPokemon(pokemonId: string) {
    setSlot(emptySlot(pokemonId));
  }

  function clearPokemon() {
    setSlot(null);
  }

  /** 샘플(빌드) 프리셋 불러오기(Phase 6 §1-3) — 이 슬롯을 통째로 덮어쓴다 */
  function loadSlot(nextSlot: PartySlot) {
    setSlot(nextSlot);
  }

  function setMove(moveIndex: 0 | 1 | 2 | 3, moveId: string | null) {
    setSlot((prev) => {
      if (!prev) return prev;
      const moves = [...prev.moves] as PartySlot["moves"];
      moves[moveIndex] = moveId;
      return { ...prev, moves };
    });
  }

  function setAbility(abilityId: string | null) {
    setSlot((prev) => (prev ? { ...prev, ability: abilityId } : prev));
  }

  function setItem(itemId: string | null) {
    setSlot((prev) => {
      if (!prev) return prev;
      const pokemon = getPokemon(prev.pokemonId);
      const matchedMega = pokemon ? findMegaFormByStone(pokemon, itemId) : undefined;
      return { ...prev, item: itemId, activeMegaForm: matchedMega?.form };
    });
  }

  function setNature(natureId: string | null) {
    setSlot((prev) => (prev ? { ...prev, nature: natureId } : prev));
  }

  /** 수컷/암컷을 바로 뒤집는다(미지정이면 수컷을 기본값으로 취급해서 그 반대인 암컷으로) */
  function toggleGender() {
    setSlot((prev) => (prev ? { ...prev, gender: (prev.gender ?? "male") === "male" ? "female" : "male" } : prev));
  }

  /** 펌킨인 계열 크기 변종을 다음 크기로 돌린다(sizeForms 순서 순환) */
  function cycleSizeForm() {
    setSlot((prev) => {
      if (!prev) return prev;
      const forms = getPokemon(prev.pokemonId)?.sizeForms;
      if (!forms || forms.length === 0) return prev;
      const currentId = prev.sizeForm ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
      const idx = forms.findIndex((f) => f.id === currentId);
      return { ...prev, sizeForm: forms[(idx + 1) % forms.length].id };
    });
  }

  /** 루가루암 계열 폼 변종을 다음 폼으로 돌린다(폼별 특성이 달라 특성 선택은 초기화) */
  function cycleFormVariant() {
    setSlot((prev) => {
      if (!prev) return prev;
      const forms = getPokemon(prev.pokemonId)?.formVariants;
      if (!forms || forms.length === 0) return prev;
      const currentId = prev.formVariant ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
      const idx = forms.findIndex((f) => f.id === currentId);
      return { ...prev, formVariant: forms[(idx + 1) % forms.length].id, ability: null };
    });
  }

  function setPoint(stat: keyof AbilityPoints, value: number) {
    setSlot((prev) => {
      if (!prev) return prev;
      const clampedValue = Math.max(0, value);
      const restTotal = totalAbilityPoints(prev.points) - prev.points[stat];
      const maxForStat = Math.min(MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL - restTotal);
      return { ...prev, points: { ...prev.points, [stat]: Math.min(clampedValue, maxForStat) } };
    });
  }

  function stepPoint(stat: keyof AbilityPoints, delta: number) {
    setSlot((prev) => {
      if (!prev) return prev;
      const currentValue = prev.points[stat];
      const restTotal = totalAbilityPoints(prev.points) - currentValue;
      const maxForStat = Math.min(MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL - restTotal);
      const nextValue = Math.min(Math.max(0, currentValue + delta), maxForStat);
      if (nextValue === currentValue) return prev;
      return { ...prev, points: { ...prev.points, [stat]: nextValue } };
    });
  }

  return {
    slot,
    setPokemon,
    clearPokemon,
    loadSlot,
    setMove,
    setAbility,
    setItem,
    setNature,
    toggleGender,
    cycleSizeForm,
    cycleFormVariant,
    setPoint,
    stepPoint,
  };
}

/** 편측 슬롯 개수(배틀타워 = 3마리). Phase 8 §2 — "3슬롯만 빌드" 결재. 슬롯 0이 리드. */
export const BATTLE_PARTY_SIZE = 3;

export type BattleSetupSlot = ReturnType<typeof useBattleSetupSlot>;

/**
 * 한 진영의 슬롯 3개. 훅 규칙상 반복문으로 못 만들지만 개수가 고정(3)이라 나란히 호출한다.
 * BATTLE_PARTY_SIZE를 바꾸려면 이 호출 목록도 같이 늘려야 한다.
 */
function useBattleSetupSide(): BattleSetupSlot[] {
  const s0 = useBattleSetupSlot();
  const s1 = useBattleSetupSlot();
  const s2 = useBattleSetupSlot();
  return [s0, s1, s2];
}

export function useBattleSetup() {
  const a = useBattleSetupSide();
  const b = useBattleSetupSide();
  const [weather, setWeather] = useState<WeatherKind | null>(null);

  return { a, b, weather, setWeather };
}
