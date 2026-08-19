import { useState } from "react";
import { Modal } from "./Modal";
import { ITEMS } from "../lib/data";
import type { Pokemon } from "../types/pokemon";
import "./MovePickerModal.css";

interface ItemPickerModalProps {
  pokemon: Pokemon;
  currentItemId: string | null;
  onSelect: (itemId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function ItemPickerModal({
  pokemon,
  currentItemId,
  onSelect,
  onClear,
  onClose,
}: ItemPickerModalProps) {
  const [query, setQuery] = useState("");

  const ownStoneIds = new Set((pokemon.megaEvolutions ?? []).map((m) => m.megaStone));

  const filtered = ITEMS.filter((i) => i.name.includes(query.trim())).sort((a, b) => {
    const aOwn = ownStoneIds.has(a.id) ? 0 : 1;
    const bOwn = ownStoneIds.has(b.id) ? 0 : 1;
    return aOwn - bOwn;
  });

  return (
    <Modal title={`${pokemon.name} · 도구 선택`} onClose={onClose}>
      <input
        type="text"
        className="picker-search"
        placeholder="도구 이름으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <button type="button" className="move-clear-btn" onClick={onClear}>
        도구 비우기
      </button>
      <ul className="move-picker-list">
        {filtered.map((item) => {
          const active = item.id === currentItemId;
          const isOwn = ownStoneIds.has(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`move-picker-item${active ? " is-used" : ""}`}
                style={{ gridTemplateColumns: "1fr auto" }}
                onClick={() => onSelect(item.id)}
              >
                <span className="move-picker-name">{item.name}</span>
                {isOwn && <span className="move-picker-cat">전용 메가스톤</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
