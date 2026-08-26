import { useState } from "react";
import { PartySlotCard } from "./PartySlotCard";
import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { TypeCoverageSummary } from "./TypeCoverageSummary";
import { useParty } from "../hooks/useParty";
import { getPokemon } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import "./PartyBoard.css";

type PickerState =
  | { kind: "pokemon"; slotIndex: number }
  | { kind: "move"; slotIndex: number; moveIndex: 0 | 1 | 2 | 3 }
  | { kind: "ability"; slotIndex: number }
  | { kind: "item"; slotIndex: number }
  | { kind: "nature"; slotIndex: number }
  | { kind: "points"; slotIndex: number }
  | null;

export function PartyBoard() {
  const {
    slots,
    setPokemon,
    clearSlot,
    setMove,
    setAbility,
    setItem,
    setNature,
    toggleGender,
    setPoint,
    stepPoint,
    resetParty,
  } = useParty();
  const [picker, setPicker] = useState<PickerState>(null);

  const filledCount = slots.filter((s) => s !== null).length;

  function handleReset() {
    if (filledCount === 0) return;
    if (window.confirm("파티를 초기화할까요? 저장된 편성이 모두 사라집니다.")) {
      resetParty();
    }
  }

  return (
    <section className="party-board">
      <header className="party-board-header">
        <div>
          <h2>파티 편성</h2>
          <p>슬롯을 눌러 포켓몬을 배치하고, 기술 칸을 눌러 4개까지 기술을 채워보세요.</p>
        </div>
        <div className="party-board-header-right">
          <span className="party-board-count">{filledCount} / 6</span>
          <span className="party-board-autosave">브라우저에 자동 저장됨</span>
          <button
            type="button"
            className="party-board-reset"
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
            onPickAbility={() => setPicker({ kind: "ability", slotIndex: i })}
            onPickItem={() => setPicker({ kind: "item", slotIndex: i })}
            onPickNature={() => setPicker({ kind: "nature", slotIndex: i })}
            onPickPoints={() => setPicker({ kind: "points", slotIndex: i })}
            onToggleGender={() => toggleGender(i)}
          />
        ))}
      </div>

      <TypeCoverageSummary slots={slots} />

      {picker?.kind === "pokemon" && (
        <PokemonPickerModal
          onClose={() => setPicker(null)}
          onSelect={(pokemonId) => {
            setPokemon(picker.slotIndex, pokemonId);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "move" &&
        (() => {
          const slot = slots[picker.slotIndex];
          const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
          if (!slot || !pokemon) return null;
          return (
            <MovePickerModal
              pokemon={pokemon}
              currentMoveIds={slot.moves}
              onClose={() => setPicker(null)}
              onSelect={(moveId) => {
                setMove(picker.slotIndex, picker.moveIndex, moveId);
                setPicker(null);
              }}
              onClear={() => {
                setMove(picker.slotIndex, picker.moveIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "ability" &&
        (() => {
          const slot = slots[picker.slotIndex];
          const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
          if (!slot || !pokemon) return null;
          return (
            <AbilityPickerModal
              pokemon={pokemon}
              slot={slot}
              currentAbilityId={slot.ability}
              onClose={() => setPicker(null)}
              onSelect={(abilityId) => {
                setAbility(picker.slotIndex, abilityId);
                setPicker(null);
              }}
              onClear={() => {
                setAbility(picker.slotIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "item" &&
        (() => {
          const slot = slots[picker.slotIndex];
          const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
          if (!slot || !pokemon) return null;
          return (
            <ItemPickerModal
              pokemon={pokemon}
              currentItemId={slot.item}
              onClose={() => setPicker(null)}
              onSelect={(itemId) => {
                setItem(picker.slotIndex, itemId);
                setPicker(null);
              }}
              onClear={() => {
                setItem(picker.slotIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "nature" &&
        (() => {
          const slot = slots[picker.slotIndex];
          if (!slot) return null;
          return (
            <NaturePickerModal
              currentNatureId={slot.nature}
              onClose={() => setPicker(null)}
              onSelect={(natureId) => {
                setNature(picker.slotIndex, natureId);
                setPicker(null);
              }}
              onClear={() => {
                setNature(picker.slotIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "points" &&
        (() => {
          const slot = slots[picker.slotIndex];
          const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
          if (!slot || !pokemon) return null;
          const form = getEffectiveForm(pokemon, slot);
          return (
            <PointsEditorModal
              pokemonName={pokemon.name}
              baseStats={form.baseStats}
              points={slot.points}
              natureId={slot.nature}
              onClose={() => setPicker(null)}
              onChange={(stat, value) => setPoint(picker.slotIndex, stat, value)}
              onStep={(stat, delta) => stepPoint(picker.slotIndex, stat, delta)}
            />
          );
        })()}
    </section>
  );
}
