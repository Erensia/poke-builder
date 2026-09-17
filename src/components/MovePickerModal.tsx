import { useState } from "react";
import { Modal } from "./Modal";
import { TypeBadge } from "./TypeBadge";
import { getMove } from "../lib/data";
import { resolveLearnset } from "../lib/pokemonForm";
import type { Pokemon } from "../types/pokemon";
import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import type { MoveCategory } from "../types/move";
import "./MovePickerModal.css";

interface MovePickerModalProps {
  pokemon: Pokemon;
  /** 슬롯이 고른 폼 변종 id. 폼마다 배우는 기술이 다른 종(에써르)에서 기술 목록을 가른다. */
  formVariant?: string;
  currentMoveIds: (string | null)[];
  onSelect: (moveId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const CATEGORY_LABEL = { physical: "물리", special: "특수", status: "변화" } as const;

export function MovePickerModal({
  pokemon,
  formVariant,
  currentMoveIds,
  onSelect,
  onClear,
  onClose,
}: MovePickerModalProps) {
  const [query, setQuery] = useState("");
  // 타입 필터·분류(물리/특수/변화) 필터(§3) — 둘 다 단일 선택이고 동시 적용된다. null = 전체.
  const [typeFilter, setTypeFilter] = useState<PokemonType | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<MoveCategory | null>(null);

  const learnedMoves = resolveLearnset(pokemon, { formVariant })
    .map((id) => getMove(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)
    .filter((m) => m.name.includes(query.trim()))
    .filter((m) => typeFilter === null || m.type === typeFilter)
    .filter((m) => categoryFilter === null || m.category === categoryFilter);

  return (
    <Modal title={`${pokemon.name} · 기술 선택`} onClose={onClose}>
      <div className="move-picker-filters">
        <div className="move-picker-type-filter">
          <button
            type="button"
            className={`move-picker-chip${typeFilter === null ? " is-active" : ""}`}
            onClick={() => setTypeFilter(null)}
          >
            전체
          </button>
          {POKEMON_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`move-picker-type-chip${typeFilter === t ? " is-active" : ""}`}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              aria-label={t}
              title={t}
            >
              <TypeBadge type={t} />
            </button>
          ))}
        </div>
        <div className="move-picker-category-filter">
          {(["physical", "special", "status"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`move-picker-chip${categoryFilter === c ? " is-active" : ""}`}
              onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
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
        {learnedMoves.length === 0 && (
          <li className="move-picker-empty">조건에 맞는 기술이 없습니다.</li>
        )}
      </ul>
      <input
        type="text"
        className="picker-search"
        placeholder="기술 이름으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}
