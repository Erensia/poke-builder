import { useState } from "react";
import { PartySlotCard } from "./PartySlotCard";
import { BackupModal } from "./BackupModal";
import { PartyPresetsModal } from "./PartyPresetsModal";
import { SlotPickers } from "./SlotPickers";
import { SyncDot } from "./SyncDot";
import { TypeCoverageSummary } from "./TypeCoverageSummary";
import { useParty } from "../hooks/useParty";
import { usePartyPresets } from "../hooks/usePartyPresets";
import { useSlotPresets } from "../hooks/useSlotPresets";
import { getPokemon } from "../lib/data";
import "./PartyBoard.css";

type PickerState =
  | { kind: "pokemon"; slotIndex: number }
  | { kind: "move"; slotIndex: number; moveIndex: 0 | 1 | 2 | 3 }
  | { kind: "ability"; slotIndex: number }
  | { kind: "item"; slotIndex: number }
  | { kind: "nature"; slotIndex: number }
  | { kind: "points"; slotIndex: number }
  | { kind: "cosmeticForm"; slotIndex: number }
  | { kind: "slotPresets"; slotIndex: number }
  | null;

/** PartyBoard의 상태·핸들러 — 화면(JSX)이 쓰는 값만 돌려준다 */
function usePartyBoardState() {
  const {
    slots,
    setPokemon,
    clearSlot,
    setMove,
    swapMoves,
    setAbility,
    setItem,
    setNature,
    toggleGender,
    cycleSizeForm,
    cycleFormVariant,
    cycleCosmeticForm,
    setCosmeticForm,
    setPoint,
    stepPoint,
    resetParty,
    loadSlots,
    loadSlot,
    reorderSlots,
  } = useParty();
  const partyPresets = usePartyPresets();
  const slotPresets = useSlotPresets();
  const [picker, setPicker] = useState<PickerState>(null);
  const [showPartyPresets, setShowPartyPresets] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  // 드래그앤드랍으로 슬롯 순서 변경(§3) — 잡고 있는 슬롯과 지금 위에 올라와 있는 슬롯을 각각 추적.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function handleSlotDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleSlotDragOver(index: number) {
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  }

  function handleSlotDrop(index: number) {
    if (draggedIndex !== null) reorderSlots(draggedIndex, index);
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleSlotDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleSaveSlotAsSample(index: number) {
    const slot = slots[index];
    if (!slot) return;
    const pokemon = getPokemon(slot.pokemonId);
    const name = window.prompt("이 빌드를 저장할 이름을 입력하세요.", pokemon?.name ?? "");
    if (name === null) return;
    slotPresets.savePreset(name, slot);
  }

  const filledCount = slots.filter((s) => s !== null).length;

  function handleReset() {
    if (filledCount === 0) return;
    if (window.confirm("파티를 초기화할까요? 저장된 편성이 모두 사라집니다.")) {
      resetParty();
    }
  }

  return { filledCount, setShowPartyPresets, setShowBackup, showBackup, handleReset, slots, setPicker, clearSlot, swapMoves, slotPresets, handleSaveSlotAsSample, toggleGender, cycleSizeForm, cycleFormVariant, cycleCosmeticForm, draggedIndex, dragOverIndex, handleSlotDragStart, handleSlotDragOver, handleSlotDrop, handleSlotDragEnd, reorderSlots, picker, setPokemon, setMove, setAbility, setItem, setNature, setPoint, stepPoint, setCosmeticForm, loadSlot, showPartyPresets, partyPresets, loadSlots };
}

export function PartyBoard() {
  const session = usePartyBoardState();
  const { filledCount, setShowPartyPresets, setShowBackup, handleReset, slots, setPicker, clearSlot, swapMoves, slotPresets, handleSaveSlotAsSample, toggleGender, cycleSizeForm, cycleFormVariant, cycleCosmeticForm, draggedIndex, dragOverIndex, handleSlotDragStart, handleSlotDragOver, handleSlotDrop, handleSlotDragEnd, reorderSlots } = session;


  return (
    <section className="party-board">
      <header className="party-board-header">
        <div>
          <h2>파티 샘플 작성</h2>
          <p>
            Pokémon Cham<span className="party-board-title-accent">p</span>ions 파티를 편성해보세요!
          </p>
        </div>
        <div className="party-board-header-right">
          <span className="party-board-count">{filledCount} / 6</span>
          <span className="party-board-autosave">브라우저에 자동 저장됨</span>
          <button
            type="button"
            className="party-board-reset tap-target"
            onClick={() => setShowPartyPresets(true)}
          >
            저장된 파티
          </button>
          <button type="button" className="party-board-reset tap-target" onClick={() => setShowBackup(true)}>
            백업
            <SyncDot />
          </button>
          <button
            type="button"
            className="party-board-reset tap-target"
            onClick={handleReset}
            disabled={filledCount === 0}
          >
            초기화
          </button>
        </div>
      </header>

      <div className="party-grid">
        {slots.map((slot, i) => (
          <PartySlotCard
            key={i}
            index={i}
            slot={slot}
            onPickPokemon={() => setPicker({ kind: "pokemon", slotIndex: i })}
            onClearPokemon={() => clearSlot(i)}
            onPickMove={(moveIndex) => setPicker({ kind: "move", slotIndex: i, moveIndex })}
            onSwapMoves={(from, to) => swapMoves(i, from, to)}
            onPickAbility={() => setPicker({ kind: "ability", slotIndex: i })}
            onPickItem={() => setPicker({ kind: "item", slotIndex: i })}
            onPickNature={() => setPicker({ kind: "nature", slotIndex: i })}
            onPickPoints={() => setPicker({ kind: "points", slotIndex: i })}
            hasSamples={slotPresets.presets.length > 0}
            onSaveAsSample={() => handleSaveSlotAsSample(i)}
            onOpenSamplePicker={() => setPicker({ kind: "slotPresets", slotIndex: i })}
            onToggleGender={() => toggleGender(i)}
            onCycleSizeForm={() => cycleSizeForm(i)}
            onCycleFormVariant={() => cycleFormVariant(i)}
            onCycleCosmeticForm={() => cycleCosmeticForm(i)}
            onPickCosmeticForm={() => setPicker({ kind: "cosmeticForm", slotIndex: i })}
            isDragging={draggedIndex === i}
            isDragOver={dragOverIndex === i}
            onDragStart={() => handleSlotDragStart(i)}
            onDragOverSlot={() => handleSlotDragOver(i)}
            onDrop={() => handleSlotDrop(i)}
            onDragEnd={handleSlotDragEnd}
            onTouchReorder={(to) => reorderSlots(i, to)}
          />
        ))}
      </div>

      <TypeCoverageSummary slots={slots} />

      <PartyBoardPickers s={session} />
    </section>
  );
}
/** PartyBoard의 일부 화면 — 세션(usePartyBoardState 결과)에서 필요한 값만 꺼내 쓴다 */
function PartyBoardPickers({ s }: { s: ReturnType<typeof usePartyBoardState> }) {
  const { picker, setPicker, slots, setPokemon, setMove, setAbility, setItem, setNature, setPoint, stepPoint, setCosmeticForm, slotPresets, loadSlot, showPartyPresets, partyPresets, setShowPartyPresets, showBackup, setShowBackup, loadSlots } = s;
  return (
    <>
      {/* 슬롯 하나를 고치는 피커 8종은 SlotPickers(대전 셋업과 공용, 7.0 R-4)가 그린다 */}
      {picker && (
        <SlotPickers
          kind={picker.kind}
          moveIndex={picker.kind === "move" ? picker.moveIndex : undefined}
          slot={slots[picker.slotIndex]}
          usedPokemonIds={slots
            .filter((_, i) => i !== picker.slotIndex)
            .map((s) => s?.pokemonId)
            .filter((id): id is string => id !== undefined)}
          usedItemIds={slots
            .filter((_, i) => i !== picker.slotIndex)
            .map((s) => s?.item)
            .filter((id): id is string => !!id)}
          slotPresets={slotPresets}
          actions={{
            setPokemon: (pokemonId) => setPokemon(picker.slotIndex, pokemonId),
            setMove: (moveIndex, moveId) => setMove(picker.slotIndex, moveIndex, moveId),
            setAbility: (abilityId) => setAbility(picker.slotIndex, abilityId),
            setItem: (itemId) => setItem(picker.slotIndex, itemId),
            setNature: (natureId) => setNature(picker.slotIndex, natureId),
            setPoint: (stat, value) => setPoint(picker.slotIndex, stat, value),
            stepPoint: (stat, delta) => stepPoint(picker.slotIndex, stat, delta),
            setCosmeticForm: (formId) => setCosmeticForm(picker.slotIndex, formId),
            loadSlot: (slot) => loadSlot(picker.slotIndex, slot),
          }}
          close={() => setPicker(null)}
        />
      )}

      {showPartyPresets && (
        <PartyPresetsModal
          presets={partyPresets.presets}
          onClose={() => setShowPartyPresets(false)}
          onSaveCurrent={(name) => partyPresets.savePreset(name, slots)}
          onLoad={(preset) => loadSlots(preset.slots)}
          onRename={partyPresets.renamePreset}
          onDelete={partyPresets.deletePreset}
        />
      )}

      {showBackup && (
        <BackupModal
          partyPresets={partyPresets.presets}
          slotPresets={slotPresets.presets}
          onClose={() => setShowBackup(false)}
          onImport={(parties, slotsList) => {
            partyPresets.replaceAll(parties);
            slotPresets.replaceAll(slotsList);
          }}
        />
      )}
    </>
  );
}


