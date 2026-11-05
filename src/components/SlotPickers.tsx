import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { CosmeticFormPickerModal } from "./CosmeticFormPickerModal";
import { SlotPresetsModal } from "./SlotPresetsModal";
import { getPokemon } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import type { useSlotPresets } from "../hooks/useSlotPresets";
import type { AbilityPoints, PartySlot } from "../types/party";

/**
 * 슬롯 하나를 고치는 피커 모달 8종(포켓몬·기술·특성·도구·성격·포인트·외형 폼·슬롯 프리셋) — 파티 편성(PartyBoard)과
 * 대전 셋업(BattleLogPickers)이 각자 똑같이 렌더하던 것을 하나로 합쳤다(7.0 R-4). 두 화면은 슬롯을 얻는 방식(slots[i] 대
 * slotCtl(side, i))과 setter 모양만 달라서, 그 차이는 호출하는 쪽이 slot·actions로 메운다. 파티 불러오기·백업 같은
 * 화면 고유 모달은 합치지 않고 각 화면에 남겼다.
 */
export interface SlotPickerActions {
  setPokemon: (pokemonId: string) => void;
  setMove: (moveIndex: 0 | 1 | 2 | 3, moveId: string | null) => void;
  setAbility: (abilityId: string | null) => void;
  setItem: (itemId: string | null) => void;
  setNature: (natureId: string | null) => void;
  setPoint: (stat: keyof AbilityPoints, value: number) => void;
  stepPoint: (stat: keyof AbilityPoints, delta: number) => void;
  setCosmeticForm: (formId: string) => void;
  loadSlot: (slot: PartySlot) => void;
}

export function SlotPickers({
  kind,
  moveIndex,
  slot,
  usedPokemonIds,
  usedItemIds,
  slotPresets,
  actions,
  close,
}: {
  /** 열린 피커 종류 — 여기서 다루지 않는 종류(loadParty 등)나 undefined면 아무것도 그리지 않는다 */
  kind: string | undefined;
  /** kind가 "move"일 때만 의미 있다 */
  moveIndex?: 0 | 1 | 2 | 3;
  slot: PartySlot | null;
  /** 같은 파티의 다른 슬롯이 쓰는 포켓몬(중복 선택 방지) */
  usedPokemonIds: string[];
  /** 같은 파티의 다른 슬롯이 쓰는 도구(없으면 도구 중복을 막지 않는다) */
  usedItemIds?: string[];
  slotPresets: ReturnType<typeof useSlotPresets>;
  actions: SlotPickerActions;
  close: () => void;
}) {
  const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
  switch (kind) {
    case "pokemon":
      return (
        <PokemonPickerModal
          onClose={close}
          usedPokemonIds={usedPokemonIds}
          onSelect={(pokemonId) => {
            actions.setPokemon(pokemonId);
            close();
          }}
        />
      );
    case "move":
      if (!slot || !pokemon || moveIndex === undefined) return null;
      return (
        <MovePickerModal
          pokemon={pokemon}
          formVariant={slot.formVariant}
          currentMoveIds={slot.moves}
          onClose={close}
          onSelect={(moveId) => {
            actions.setMove(moveIndex, moveId);
            close();
          }}
          onClear={() => {
            actions.setMove(moveIndex, null);
            close();
          }}
        />
      );
    case "ability":
      if (!slot || !pokemon) return null;
      return (
        <AbilityPickerModal
          pokemon={pokemon}
          slot={slot}
          currentAbilityId={slot.ability}
          onClose={close}
          onSelect={(abilityId) => {
            actions.setAbility(abilityId);
            close();
          }}
          onClear={() => {
            actions.setAbility(null);
            close();
          }}
        />
      );
    case "item":
      if (!slot || !pokemon) return null;
      return (
        <ItemPickerModal
          pokemon={pokemon}
          currentItemId={slot.item}
          usedItemIds={usedItemIds}
          onClose={close}
          onSelect={(itemId) => {
            actions.setItem(itemId);
            close();
          }}
          onClear={() => {
            actions.setItem(null);
            close();
          }}
        />
      );
    case "nature":
      if (!slot) return null;
      return (
        <NaturePickerModal
          currentNatureId={slot.nature}
          onClose={close}
          onSelect={(natureId) => {
            actions.setNature(natureId);
            close();
          }}
          onClear={() => {
            actions.setNature(null);
            close();
          }}
        />
      );
    case "points": {
      if (!slot || !pokemon) return null;
      const form = getEffectiveForm(pokemon, slot);
      return (
        <PointsEditorModal
          pokemonName={pokemon.name}
          baseStats={form.baseStats}
          points={slot.points}
          natureId={slot.nature}
          itemId={slot.item}
          moveIds={slot.moves}
          types={getEffectiveForm(pokemon, slot, { ignoreMega: true }).types}
          onClose={close}
          onChange={actions.setPoint}
          onStep={actions.stepPoint}
        />
      );
    }
    case "cosmeticForm":
      if (!slot || !pokemon?.cosmeticForms) return null;
      return (
        <CosmeticFormPickerModal
          pokemonName={pokemon.name}
          forms={pokemon.cosmeticForms}
          currentFormId={slot.cosmeticForm ?? null}
          onClose={close}
          onSelect={(formId) => {
            actions.setCosmeticForm(formId);
            close();
          }}
        />
      );
    case "slotPresets":
      return (
        <SlotPresetsModal
          presets={slotPresets.presets}
          slotIsFilled={slot !== null}
          usedPokemonIds={usedPokemonIds}
          onClose={close}
          onLoad={(preset) => actions.loadSlot(preset.slot)}
          onRename={slotPresets.renamePreset}
          onDelete={slotPresets.deletePreset}
        />
      );
    default:
      return null;
  }
}
