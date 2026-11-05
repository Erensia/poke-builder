import { PartyPresetsModal } from "../PartyPresetsModal";
import { SamplePartiesModal } from "../SamplePartiesModal";
import { SlotPickers } from "../SlotPickers";
import { SLOT_INDICES } from "./shared";
import type { useBattleLogSession } from "./useBattleLogSession";

/**
 * BattleLogPage의 일부 화면 — 세션(useBattleLogSession 결과)에서 필요한 값만 꺼내 쓴다.
 * 슬롯 하나를 고치는 피커 8종은 SlotPickers(파티 편성과 공용, 7.0 R-4)가 그리고, 파티 불러오기·샘플 파티는 이 화면 고유라 여기서 그린다.
 */
export function BattleLogPickers({ s }: { s: ReturnType<typeof useBattleLogSession> }) {
  const { picker, setPicker, sideCtls, slotCtl, slotPresets, partyPresets, setup, loadSample, mySamples } = s;
  const close = () => setPicker(null);
  const slotPicker = picker && "slotIndex" in picker ? picker : null;
  const ctl = slotPicker ? slotCtl(slotPicker.side, slotPicker.slotIndex) : null;
  return (
    <>
      {slotPicker && ctl && (
        <SlotPickers
          kind={slotPicker.kind}
          moveIndex={slotPicker.kind === "move" ? slotPicker.moveIndex : undefined}
          slot={ctl.slot}
          usedPokemonIds={sideCtls(slotPicker.side)
            .filter((_, i) => i !== slotPicker.slotIndex)
            .map((c) => c.slot?.pokemonId)
            .filter((id): id is string => id !== undefined)}
          slotPresets={slotPresets}
          actions={ctl}
          close={close}
        />
      )}

      {picker?.kind === "loadParty" &&
        (() => {
          const side = picker.side;
          return (
            <PartyPresetsModal
              presets={partyPresets.presets}
              loadOnly
              loadTargetLabel={`${side === "a" ? "내 파티" : "상대 파티"} 빌드`}
              onClose={close}
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
              onClose={close}
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
