import type { AbilityPoints } from "../types/party";
import { getPokemon } from "./data";
import { findMegaFormByStone } from "./pokemonForm";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL, totalAbilityPoints } from "./statCalculator";

/**
 * useParty/useMatchup/useBattleSetup 3개 훅이 각자의 슬롯 타입(PartySlot/MatchupSlot)에
 * 똑같이 구현하고 있던 "슬롯 하나를 바꾸는" 순수 로직. 훅은 이 함수들을 자신의 setSlots/setSlot
 * 업데이터 안에서 호출하고, null 슬롯 처리·배열 인덱싱 같은 훅별 배선은 그대로 각 훅에 남는다.
 */

interface ItemSlot {
  pokemonId: string | null;
  item: string | null;
  activeMegaForm?: string;
}

/** 도구를 장착하고, 메가스톤이면 해당 메가폼을 자동 활성화한다(그 외 도구/미지정이면 기본형으로) */
export function applyItemToSlot<T extends ItemSlot>(slot: T, itemId: string | null): T {
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  const matchedMega = pokemon ? findMegaFormByStone(pokemon, itemId) : undefined;
  return { ...slot, item: itemId, activeMegaForm: matchedMega?.form };
}

type FormFieldKind = "sizeForm" | "formVariant" | "cosmeticForm";

interface FormSlot {
  pokemonId: string | null;
  sizeForm?: string;
  formVariant?: string;
  cosmeticForm?: string;
  ability: string | null;
}

/**
 * sizeForm/formVariant/cosmeticForm 3계열의 순환 로직(펌킨인 크기·루가루암 폼·마휘핑 겉모습)이
 * 전부 "forms 목록에서 현재 값을 찾아 다음 값으로 순환"이라는 동일한 형태라 kind로 매개변수화했다.
 * formVariant는 폼별로 특성 목록이 달라 특성 선택을 초기화한다(다른 두 계열은 그대로 둠).
 */
export function cycleFormOnSlot<T extends FormSlot>(slot: T, kind: FormFieldKind): T {
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  const forms =
    kind === "sizeForm" ? pokemon?.sizeForms
    : kind === "formVariant" ? pokemon?.formVariants
    : pokemon?.cosmeticForms;
  if (!forms || forms.length === 0) return slot;
  const currentId = slot[kind] ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
  const idx = forms.findIndex((f) => f.id === currentId);
  const nextForm = forms[(idx + 1) % forms.length];
  return {
    ...slot,
    [kind]: nextForm.id,
    ...(kind === "formVariant" ? { ability: null } : {}),
  };
}

interface PointsSlot {
  points: AbilityPoints;
}

/** 합산 66 / 스탯당 32를 넘지 않도록 클램프해서 능력 포인트 한 스탯을 절대값으로 설정한다 (직접 입력용) */
export function setAbilityPointOnSlot<T extends PointsSlot>(
  slot: T,
  stat: keyof AbilityPoints,
  value: number,
): T {
  const clampedValue = Math.max(0, value);
  const restTotal = totalAbilityPoints(slot.points) - slot.points[stat];
  const maxForStat = Math.min(MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL - restTotal);
  return { ...slot, points: { ...slot.points, [stat]: Math.min(clampedValue, maxForStat) } };
}

/** 이전 상태를 기준으로 증감시킨다 (버튼용) — 변화가 없으면 같은 참조를 그대로 돌려준다 */
export function stepAbilityPointOnSlot<T extends PointsSlot>(
  slot: T,
  stat: keyof AbilityPoints,
  delta: number,
): T {
  const currentValue = slot.points[stat];
  const restTotal = totalAbilityPoints(slot.points) - currentValue;
  const maxForStat = Math.min(MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL - restTotal);
  const nextValue = Math.min(Math.max(0, currentValue + delta), maxForStat);
  if (nextValue === currentValue) return slot;
  return { ...slot, points: { ...slot.points, [stat]: nextValue } };
}
