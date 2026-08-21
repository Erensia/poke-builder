import type { Pokemon, MegaEvolution } from "../types/pokemon";
import type { PokemonType } from "../types/pokemon-type";
import type { BaseStats } from "../types/stats";

/** getEffectiveForm이 실제로 필요로 하는 부분만 뽑은 형태. PartySlot이나 MatchupSlot 둘 다 만족한다 */
export interface FormSource {
  item: string | null;
  activeMegaForm?: string;
}

export interface EffectiveForm {
  /** 메가진화 상태면 해당 폼, 아니면 undefined */
  mega?: MegaEvolution;
  types: PokemonType[];
  baseStats: BaseStats;
  /** 표시용: 메가진화 중이면 "리자몽 (메가X)" 형태로 쓸 수 있는 폼 이름 */
  formLabel: string | null;
}

/** 도구로 장착한 메가스톤에 맞는 메가진화 폼을 찾는다 */
export function findMegaFormByStone(
  pokemon: Pokemon,
  itemId: string | null,
): MegaEvolution | undefined {
  if (!itemId || !pokemon.megaEvolutions) return undefined;
  return pokemon.megaEvolutions.find((m) => m.megaStone === itemId);
}

/** 슬롯의 도구/activeMegaForm을 반영한 실제 타입·종족값을 계산한다 */
export function getEffectiveForm(pokemon: Pokemon, slot: FormSource): EffectiveForm {
  const mega =
    pokemon.megaEvolutions?.find((m) => m.form === slot.activeMegaForm) ??
    findMegaFormByStone(pokemon, slot.item);

  if (mega) {
    return {
      mega,
      types: mega.types,
      baseStats: mega.baseStats,
      formLabel: mega.form,
    };
  }
  return {
    types: pokemon.types,
    baseStats: pokemon.baseStats,
    formLabel: null,
  };
}

/**
 * 실제로 판정에 써야 할 특성 id. 메가진화 중이면 유저가 고른 slot.ability와 무관하게
 * 항상 그 메가폼 고유 특성(예: 메가리자몽Y=가뭄, 메가리자몽X=단단한발톱)으로 고정된다 — 본가 규칙.
 * 메가진화가 아니면 그대로 slot.ability.
 */
export function getEffectiveAbilityId(form: EffectiveForm, slotAbility: string | null): string | null {
  return form.mega ? form.mega.ability : slotAbility;
}

/**
 * 메가 배지에 쓸 라벨. 리자몽처럼 메가진화가 2개 이상이라 폼 이름이 "리자몽-메가X"/"리자몽-메가Y"인
 * 경우 지닌 메가스톤을 봐야만 X인지 Y인지 알 수 있다는 피드백에 따라, 폼 이름 뒤쪽("메가X")을
 * 그대로 배지에 노출한다. 메가진화가 1개뿐인 포켓몬은 폼 이름이 "이상해꽃-메가"라 그냥 "메가"로 나온다.
 */
export function megaBadgeLabel(mega: MegaEvolution): string {
  return mega.form.split("-").at(-1) ?? "메가";
}
