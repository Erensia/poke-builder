import { Modal } from "./Modal";
import { getAbility } from "../lib/data";
import type { Pokemon } from "../types/pokemon";
import "./MovePickerModal.css";

interface AbilityPickerModalProps {
  pokemon: Pokemon;
  currentAbilityId: string | null;
  onSelect: (abilityId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function AbilityPickerModal({
  pokemon,
  currentAbilityId,
  onSelect,
  onClear,
  onClose,
}: AbilityPickerModalProps) {
  const candidates = [
    ...pokemon.abilities.map((id) => ({ id, hidden: false })),
    ...(pokemon.hiddenAbility ? [{ id: pokemon.hiddenAbility, hidden: true }] : []),
  ];

  return (
    <Modal title={`${pokemon.name} · 특성 선택`} onClose={onClose}>
      <button type="button" className="move-clear-btn" onClick={onClear}>
        특성 비우기
      </button>
      <ul className="move-picker-list">
        {candidates.map(({ id, hidden }) => {
          const ability = getAbility(id);
          if (!ability) return null;
          const active = id === currentAbilityId;
          return (
            <li key={id}>
              <button
                type="button"
                className={`move-picker-item${active ? " is-used" : ""}`}
                style={{ gridTemplateColumns: "1fr auto" }}
                onClick={() => onSelect(id)}
              >
                <span className="move-picker-name">{ability.name}</span>
                {hidden && <span className="move-picker-cat">숨겨진 특성</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
