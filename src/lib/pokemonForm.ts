import type { Pokemon, MegaEvolution, PokemonGender, FormVariant, CosmeticForm } from "../types/pokemon";
import type { PokemonType } from "../types/pokemon-type";
import type { BaseStats } from "../types/stats";

/** getEffectiveForm이 실제로 필요로 하는 부분만 뽑은 형태. PartySlot이나 MatchupSlot 둘 다 만족한다 */
export interface FormSource {
  item: string | null;
  activeMegaForm?: string;
  /** 펌킨인 계열 크기 변종 선택값(Pokemon.sizeForms[].id). 없으면 종의 기준 크기 */
  sizeForm?: string;
  /** 루가루암 계열 폼 변종 선택값(Pokemon.formVariants[].id). 없으면 종의 기준 폼 */
  formVariant?: string;
  /** 마휘핑 계열 겉모습 선택값(Pokemon.cosmeticForms[].id). 이미지에만 영향 — getEffectiveForm은 이 값을 보지 않는다 */
  cosmeticForm?: string;
}

/**
 * 겉모습 옵션이 이 수 이하면 슬롯 카드에서 클릭으로 순환(펌킨인·루가루암과 동일 UX), 이보다 많으면
 * 리스트 모달로 고른다. 비비용(20종)처럼 옵션이 너무 많은 종의 순환 UX가 나빠서 둔 경계
 * (사용자 확정 2026-09-08).
 */
export const COSMETIC_FORM_CYCLE_MAX = 4;

/**
 * pokemon.cosmeticForms에서 slot이 실제로 가리키는 겉모습을 돌려준다. 슬롯 값이 없거나 목록에
 * 없는 id면 `standard: true`인 기준 모습으로, 그것도 없으면 배열 첫 원소로 폴백한다. 겉모습
 * 목록 자체가 없으면 undefined. 슬롯 카드의 클릭 순환·리스트 모달·이미지 해석이 공통으로 쓴다.
 */
export function resolveCosmeticForm(
  pokemon: Pokemon,
  slot: { cosmeticForm?: string },
): CosmeticForm | undefined {
  const forms = pokemon.cosmeticForms;
  if (!forms || forms.length === 0) return undefined;
  return (
    forms.find((f) => f.id === slot.cosmeticForm) ??
    forms.find((f) => f.standard) ??
    forms[0]
  );
}

/** pokemon.formVariants에서 slot이 고른 폼(기준 폼이면 undefined) */
export function resolveFormVariant(pokemon: Pokemon, slot: { formVariant?: string }): FormVariant | undefined {
  if (!pokemon.formVariants || !slot.formVariant) return undefined;
  const fv = pokemon.formVariants.find((f) => f.id === slot.formVariant);
  return fv && !fv.standard ? fv : undefined;
}

/**
 * 슬롯이 고른 폼의 습득 기술 목록. 폼 전용 learnset(FormVariant.learnset)이 있으면 그것을,
 * 없으면 종 공통 learnset을 쓴다. 에써르처럼 성별(폼)마다 배우는 기술이 다른 종에 필요하다.
 */
export function resolveLearnset(pokemon: Pokemon, slot: { formVariant?: string }): string[] {
  return resolveFormVariant(pokemon, slot)?.learnset ?? pokemon.learnset;
}

export interface EffectiveForm {
  /** 메가진화 상태면 해당 폼, 아니면 undefined */
  mega?: MegaEvolution;
  types: PokemonType[];
  baseStats: BaseStats;
  /**
   * 이 폼의 몸무게(kg). 메가폼이면 mega.weightKg(없으면 기본 폼 값으로 폴백), 아니면 기본 폼 값.
   * 헤비봄버·히트스탬프·풀묶기·안다리걸기 위력 계산(§3-6)에 쓴다. 데이터가 없으면 undefined.
   */
  weightKg?: number;
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

/**
 * 슬롯의 도구/activeMegaForm을 반영한 실제 타입·종족값을 계산한다.
 * opts.ignoreMega=true면 메가진화 분기를 통째로 건너뛴다(배틀 시뮬 — 메가는 배틀 시작 시
 * 굳히지 않고 턴에 선언될 때 적용하므로, createFighterState는 기본 폼을 원한다, §4).
 */
export function getEffectiveForm(
  pokemon: Pokemon,
  slot: FormSource,
  opts?: { ignoreMega?: boolean },
): EffectiveForm {
  const mega = opts?.ignoreMega
    ? undefined
    : (pokemon.megaEvolutions?.find((m) => m.form === slot.activeMegaForm) ??
      findMegaFormByStone(pokemon, slot.item));

  if (mega) {
    return {
      mega,
      types: mega.types,
      baseStats: mega.baseStats,
      weightKg: mega.weightKg ?? pokemon.weightKg,
      formLabel: mega.form,
    };
  }
  // 폼 변종(루가루암 계열): 기준 폼이 아니면 타입·종족값·몸무게를 그 폼 값으로 통째로 덮어쓴다.
  const fv = resolveFormVariant(pokemon, slot);
  if (fv) {
    return {
      types: fv.types,
      baseStats: fv.baseStats,
      weightKg: fv.weightKg ?? pokemon.weightKg,
      formLabel: fv.label,
    };
  }

  // 크기 변종(펌킨인 계열): 기준 크기가 아닌 변종을 골랐으면 spe·weightKg만 그 값으로 덮어쓴다.
  if (pokemon.sizeForms && slot.sizeForm) {
    const size = pokemon.sizeForms.find((s) => s.id === slot.sizeForm);
    if (size && !size.standard) {
      return {
        types: pokemon.types,
        baseStats: { ...pokemon.baseStats, spe: size.spe },
        weightKg: size.weightKg,
        formLabel: size.label,
      };
    }
  }

  return {
    types: pokemon.types,
    baseStats: pokemon.baseStats,
    weightKg: pokemon.weightKg,
    formLabel: null,
  };
}

/**
 * 특성 선택 UI가 후보로 보여줄 abilities/hiddenAbility. 폼 변종(루가루암)을 골랐으면 그 폼의
 * 목록을, 아니면 종의 기본값을 돌려준다. 냐오닉스 성별 분기는 getEffectiveHiddenAbilityId가 별도 처리.
 */
export function getEffectiveAbilityList(
  pokemon: Pokemon,
  slot: { formVariant?: string },
): { abilities: string[]; hiddenAbility?: string } {
  const fv = resolveFormVariant(pokemon, slot);
  if (fv) return { abilities: fv.abilities, hiddenAbility: fv.hiddenAbility };
  return { abilities: pokemon.abilities, hiddenAbility: pokemon.hiddenAbility };
}

/**
 * 특성 선택 UI에 보여줄 "숨겨진 특성" id. 냐오닉스처럼 genderedHiddenAbility가 있는 종은
 * 슬롯 성별(getEffectiveGender)에 맞는 쪽을, 그 외에는 pokemon.hiddenAbility를 그대로 돌려준다.
 * 숨겨진 특성이 없으면 undefined.
 */
export function getEffectiveHiddenAbilityId(
  pokemon: Pokemon,
  slot: GenderSource & { formVariant?: string },
): string | undefined {
  if (pokemon.genderedHiddenAbility) {
    const g = getEffectiveGender(pokemon, slot);
    return g === "female"
      ? pokemon.genderedHiddenAbility.female
      : pokemon.genderedHiddenAbility.male;
  }
  return getEffectiveAbilityList(pokemon, slot).hiddenAbility;
}

/**
 * 실제로 판정에 써야 할 특성 id. 메가진화 중이면 유저가 고른 slot.ability와 무관하게
 * 항상 그 메가폼 고유 특성(예: 메가리자몽Y=가뭄, 메가리자몽X=단단한발톱)으로 고정된다 — 본가 규칙.
 * 메가진화가 아니면 그대로 slot.ability.
 */
export function getEffectiveAbilityId(form: EffectiveForm, slotAbility: string | null): string | null {
  return form.mega ? form.mega.ability : slotAbility;
}

/** getEffectiveGender가 실제로 필요로 하는 부분만 뽑은 형태. PartySlot이나 MatchupSlot 둘 다 만족한다 */
export interface GenderSource {
  gender?: PokemonGender;
}

/**
 * 실제로 판정에 써야 할 성별. 종족 성별 카테고리가 단일성별/무성별이면 슬롯의 gender와 무관하게
 * 항상 그 값으로 고정되고("both"가 아니면 유저가 고를 수 없음 — UI에서도 그 종은 성별 픽 자체를
 * 숨긴다), "both"일 때만 슬롯이 고른 값을 쓰며 미지정이면 수컷을 기본값으로 취급한다(Phase 6
 * §1-1 — 사용자 확정 2026-08-26). 무성별은 null로 표현 — 헤롱헤롱류는 이 값이 null이면 아예
 * 성립하지 않는다.
 */
export function getEffectiveGender(pokemon: Pokemon, slot: GenderSource): PokemonGender | null {
  switch (pokemon.genderCategory) {
    case "male-only":
      return "male";
    case "female-only":
      return "female";
    case "genderless":
      return null;
    case "both":
      return slot.gender ?? "male";
  }
}

/** 성별 값의 표시 라벨("수컷"/"암컷") — 파티 편성 UI와 대전 로그 문구에서 함께 쓴다 */
export function genderLabel(gender: PokemonGender): "수컷" | "암컷" {
  return gender === "female" ? "암컷" : "수컷";
}

/**
 * 메가 배지에 쓸 라벨. 리자몽처럼 메가진화가 2개 이상이라 폼 이름이 "리자몽-메가X"/"리자몽-메가Y"인
 * 경우 지닌 메가스톤을 봐야만 X인지 Y인지 알 수 있다는 피드백에 따라, 폼 이름 뒤쪽("메가X")을
 * 그대로 배지에 노출한다. 메가진화가 1개뿐인 포켓몬은 폼 이름이 "이상해꽃-메가"라 그냥 "메가"로 나온다.
 */
export function megaBadgeLabel(mega: MegaEvolution): string {
  return mega.form.split("-").at(-1) ?? "메가";
}

/**
 * 메가폼의 정식(사람이 읽는) 명칭. 폼 이름은 데이터상 "이어롭-메가" / "리자몽-메가X" 형태지만
 * 실제 한국어 정식 명칭은 "메가이어롭" / "메가리자몽X"다 — 배틀 로그 문구처럼 그대로 노출되는
 * 자리엔 이 형태를 쓴다. 예상 밖 형식이면 폼 이름을 그대로 돌려준다.
 */
export function megaFormFullName(mega: MegaEvolution): string {
  const m = mega.form.match(/^(.+)-메가([XYZ]?)$/);
  return m ? `메가${m[1]}${m[2]}` : mega.form;
}
