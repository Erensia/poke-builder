import { useState } from "react";
import { Modal } from "./Modal";
import { TypeBadge } from "./TypeBadge";
import { POKEMON } from "../lib/data";
import "./PokemonPickerModal.css";

interface PokemonPickerModalProps {
  onSelect: (pokemonId: string) => void;
  onClose: () => void;
}

export function PokemonPickerModal({ onSelect, onClose }: PokemonPickerModalProps) {
  const [query, setQuery] = useState("");

  const filtered = POKEMON.filter((p) => p.name.includes(query.trim()));

  return (
    <Modal title="포켓몬 선택" onClose={onClose}>
      <input
        type="text"
        className="picker-search"
        placeholder="이름으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="pokemon-picker-list">
        {filtered.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="pokemon-picker-item"
              onClick={() => onSelect(p.id)}
            >
              <span className="pokemon-picker-name">{p.name}</span>
              <span className="pokemon-picker-types">
                {p.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
              </span>
              {p.megaEvolutions && p.megaEvolutions.length > 0 && (
                <span className="pokemon-picker-mega">
                  메가×{p.megaEvolutions.length}
                </span>
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="pokemon-picker-empty">검색 결과가 없습니다.</li>
        )}
      </ul>
    </Modal>
  );
}
