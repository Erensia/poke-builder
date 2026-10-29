import { PokemonPickerModal } from "../PokemonPickerModal";
import { MovePickerModal } from "../MovePickerModal";
import { AbilityPickerModal } from "../AbilityPickerModal";
import { ItemPickerModal } from "../ItemPickerModal";
import { NaturePickerModal } from "../NaturePickerModal";
import { PointsEditorModal } from "../PointsEditorModal";
import { SlotPresetsModal } from "../SlotPresetsModal";
import { PartyPresetsModal } from "../PartyPresetsModal";
import { SamplePartiesModal } from "../SamplePartiesModal";
import { CosmeticFormPickerModal } from "../CosmeticFormPickerModal";
import { getEffectiveForm } from "../../lib/pokemonForm";
import { SLOT_INDICES } from "./shared";
import type { useBattleLogSession } from "./useBattleLogSession";

/** BattleLogPage의 일부 화면 — 세션(useBattleLogSession 결과)에서 필요한 값만 꺼내 쓴다 */
export function BattleLogPickers({ s }: { s: ReturnType<typeof useBattleLogSession> }) {
  const { picker, setPicker, sideCtls, slotCtl, pokemonAt, slotPresets, partyPresets, setup, loadSample, mySamples } = s;
  return (
    <>
      {picker?.kind === "pokemon" && (
        <PokemonPickerModal
          onClose={() => setPicker(null)}
          usedPokemonIds={sideCtls(picker.side)
            .filter((_, i) => i !== picker.slotIndex)
            .map((ctl) => ctl.slot?.pokemonId)
            .filter((id): id is string => id !== undefined)}
          onSelect={(pokemonId) => {
            slotCtl(picker.side, picker.slotIndex).setPokemon(pokemonId);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "ability" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          const slot = ctl.slot;
          if (!pokemon || !slot) return null;
          return (
            <AbilityPickerModal
              pokemon={pokemon}
              slot={slot}
              currentAbilityId={slot.ability}
              onClose={() => setPicker(null)}
              onSelect={(abilityId) => {
                ctl.setAbility(abilityId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setAbility(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "item" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon) return null;
          return (
            <ItemPickerModal
              pokemon={pokemon}
              currentItemId={ctl.slot?.item ?? null}
              onClose={() => setPicker(null)}
              onSelect={(itemId) => {
                ctl.setItem(itemId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setItem(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "nature" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          return (
            <NaturePickerModal
              currentNatureId={ctl.slot?.nature ?? null}
              onClose={() => setPicker(null)}
              onSelect={(natureId) => {
                ctl.setNature(natureId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setNature(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "points" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon || !ctl.slot) return null;
          const form = getEffectiveForm(pokemon, ctl.slot);
          return (
            <PointsEditorModal
              pokemonName={pokemon.name}
              baseStats={form.baseStats}
              points={ctl.slot.points}
              natureId={ctl.slot.nature}
              itemId={ctl.slot.item}
              moveIds={ctl.slot.moves}
              types={getEffectiveForm(pokemon, ctl.slot, { ignoreMega: true }).types}
              onClose={() => setPicker(null)}
              onChange={(stat, value) => ctl.setPoint(stat, value)}
              onStep={(stat, delta) => ctl.stepPoint(stat, delta)}
            />
          );
        })()}

      {picker?.kind === "cosmeticForm" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon?.cosmeticForms || !ctl.slot) return null;
          return (
            <CosmeticFormPickerModal
              pokemonName={pokemon.name}
              forms={pokemon.cosmeticForms}
              currentFormId={ctl.slot.cosmeticForm ?? null}
              onClose={() => setPicker(null)}
              onSelect={(formId) => {
                ctl.setCosmeticForm(formId);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "move" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon || !ctl.slot) return null;
          const moveIndex = picker.moveIndex;
          return (
            <MovePickerModal
              pokemon={pokemon}
              formVariant={ctl.slot.formVariant}
              currentMoveIds={ctl.slot.moves}
              onClose={() => setPicker(null)}
              onSelect={(moveId) => {
                ctl.setMove(moveIndex, moveId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setMove(moveIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "slotPresets" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          return (
            <SlotPresetsModal
              presets={slotPresets.presets}
              slotIsFilled={ctl.slot !== null}
              usedPokemonIds={sideCtls(picker.side)
                .filter((_, i) => i !== picker.slotIndex)
                .map((c) => c.slot?.pokemonId)
                .filter((id): id is string => id !== undefined)}
              onClose={() => setPicker(null)}
              onLoad={(preset) => ctl.loadSlot(preset.slot)}
              onRename={slotPresets.renamePreset}
              onDelete={slotPresets.deletePreset}
            />
          );
        })()}

      {picker?.kind === "loadParty" &&
        (() => {
          const side = picker.side;
          return (
            <PartyPresetsModal
              presets={partyPresets.presets}
              loadOnly
              loadTargetLabel={`${side === "a" ? "내 파티" : "상대 파티"} 빌드`}
              onClose={() => setPicker(null)}
              onLoad={(preset) => setup.loadSide(side, preset.slots)}
            />
          );
        })()}

      {picker?.kind === "sampleParty" &&
        (() => {
          const side = picker.side;
          return (
            <SamplePartiesModal
              loadTargetLabel={`${side === "a" ? "내 파티" : "상대 파티"} 빌드`}
              targetHasPokemon={SLOT_INDICES.some((i) => slotCtl(side, i).slot !== null)}
              onClose={() => setPicker(null)}
              onLoad={(sample) => loadSample(side, sample)}
              mySamples={mySamples.samples}
              currentSlots={SLOT_INDICES.map((i) => slotCtl(side, i).slot)}
              onSaveMySample={mySamples.addSample}
              onDeleteMySample={mySamples.removeSample}
              onImportMySamples={mySamples.importSamples}
            />
          );
        })()}
    </>
  );
}
