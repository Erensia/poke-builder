import { useState } from "react";
import { Modal } from "./Modal";
import { TypeBadge } from "./TypeBadge";
import { getMove } from "../lib/data";
import type { Pokemon } from "../types/pokemon";
import "./MovePickerModal.css";

interface MovePickerModalProps {
  pokemon: Pokemon;
  currentMoveIds: (string | null)[];
  onSelect: (moveId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const CATEGORY_LABEL = { physical: "물리", special: "특수", status: "변화" } as const;

export function MovePickerModal({
  pokemon,
  currentMoveIds,
  onSelect,
  onClear,
  onClose,
}: MovePickerModalProps) {
  const [query, setQuery] = useState("");

  const learnedMoves = pokemon.learnset
    .map((id) => getMove(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)
    .filter((m) => m.name.includes(query.trim()));

  return (
    <Modal title={`${pokemon.name} · 기술 선택`} onClose={onClose}>
      <input
        type="text"
        className="picker-search"
        placeholder="기술 이름으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <button type="button" className="move-clear-btn" onClick={onClear}>
        슬롯 비우기
      </button>
      <ul className="move-picker-list">
        {learnedMoves.map((m) => {
          const alreadyUsed = currentMoveIds.includes(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                className={`move-picker-item${alreadyUsed ? " is-used" : ""}`}
                onClick={() => onSelect(m.id)}
              >
                <span className="move-picker-name">{m.name}</span>
                <TypeBadge type={m.type ?? "노말"} />
                <span className="move-picker-cat">{CATEGORY_LABEL[m.category ?? "status"]}</span>
                <span className="move-picker-num">{m.power ?? "—"}</span>
                <span className="move-picker-num">{m.accuracy ? `${m.accuracy}%` : "—"}</span>
                <span className="move-picker-num">PP {m.pp}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
