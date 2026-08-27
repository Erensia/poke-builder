import { useState } from "react";
import { Modal } from "./Modal";
import { TypeBadge } from "./TypeBadge";
import { POKEMON } from "../lib/data";
import "./PokemonPickerModal.css";

interface PokemonPickerModalProps {
  onSelect: (pokemonId: string) => void;
  onClose: () => void;
  /**
   * 이미 파티의 다른 슬롯이 쓰고 있는 포켓몬 id 목록(현재 편집 중인 슬롯 자신은 제외하고 넘겨야
   * 함) — Phase 6 중복 방지: 같은 파티에 같은 포켓몬을 2마리 이상 넣을 수 없다(본가 규칙).
   * 없으면(undefined) 아무도 막지 않는다 — 이 프로퍼티를 안 넘기는 화면(대전 로그/매치업 등)은
   * 파티 개념이 아니라 대상이 아니다.
   */
  usedPokemonIds?: string[];
}

export function PokemonPickerModal({ onSelect, onClose, usedPokemonIds }: PokemonPickerModalProps) {
  const [query, setQuery] = useState("");
  const usedSet = new Set(usedPokemonIds);

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
        {filtered.map((p) => {
          const isTaken = usedSet.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`pokemon-picker-item${isTaken ? " is-taken" : ""}`}
                disabled={isTaken}
                onClick={() => onSelect(p.id)}
              >
                <span className="pokemon-picker-name">{p.name}</span>
                <span className="pokemon-picker-types">
                  {p.types.map((t) => (
                    <TypeBadge key={t} type={t} />
                  ))}
                </span>
                {isTaken ? (
                  <span className="pokemon-picker-taken">다른 슬롯에 있음</span>
                ) : (
                  p.megaEvolutions &&
                  p.megaEvolutions.length > 0 && (
                    <span className="pokemon-picker-mega">메가×{p.megaEvolutions.length}</span>
                  )
                )}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="pokemon-picker-empty">검색 결과가 없습니다.</li>
        )}
      </ul>
    </Modal>
  );
}
