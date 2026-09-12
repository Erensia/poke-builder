import { useState } from "react";
import { Modal } from "./Modal";
import type { SlotPreset } from "../types/party";
import { getPokemon } from "../lib/data";
import { eulReul } from "../lib/josa";
import "./PresetListModal.css";

interface SlotPresetsModalProps {
  presets: SlotPreset[];
  /** 현재 이 슬롯에 뭔가 채워져 있으면(=불러오면 덮어씀) true — 확인 문구 분기용 */
  slotIsFilled: boolean;
  /**
   * 이미 파티의 다른 슬롯이 쓰고 있는 포켓몬 id 목록(현재 편집 중인 슬롯 자신은 제외하고 넘겨야
   * 함) — PokemonPickerModal과 동일한 중복 방지(ver.1.3 §2): 저장된 빌드를 불러오는 경로로도
   * 같은 포켓몬이 다른 슬롯에 중복 배치되지 않게 막는다. 없으면(undefined) 아무도 막지 않는다.
   */
  usedPokemonIds?: string[];
  onClose: () => void;
  onLoad: (preset: SlotPreset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function SlotPresetsModal({
  presets,
  slotIsFilled,
  usedPokemonIds,
  onClose,
  onLoad,
  onRename,
  onDelete,
}: SlotPresetsModalProps) {
  const usedSet = new Set(usedPokemonIds);

  function handleLoad(preset: SlotPreset) {
    if (usedSet.has(preset.slot.pokemonId)) return;
    if (slotIsFilled && !window.confirm(`"${preset.name}"${eulReul(preset.name)} 불러올까요? 이 슬롯의 내용이 덮어써집니다.`)) {
      return;
    }
    onLoad(preset);
    onClose();
  }

  function handleRename(preset: SlotPreset) {
    const next = window.prompt("새 이름을 입력하세요.", preset.name);
    if (next === null) return;
    onRename(preset.id, next);
  }

  function handleDelete(preset: SlotPreset) {
    if (window.confirm(`"${preset.name}"${eulReul(preset.name)} 삭제할까요?`)) {
      onDelete(preset.id);
    }
  }

  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const sorted = [...presets]
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((preset) => {
      if (!q) return true;
      const pokemonName = getPokemon(preset.slot.pokemonId)?.name ?? preset.slot.pokemonId;
      return preset.name.toLowerCase().includes(q) || pokemonName.toLowerCase().includes(q);
    });

  return (
    <Modal title="저장된 샘플에서 불러오기" onClose={onClose}>
      <input
        type="text"
        className="preset-search-input"
        placeholder="이름 · 포켓몬으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="preset-list">
        {sorted.map((preset) => {
          const pokemon = getPokemon(preset.slot.pokemonId);
          const isTaken = usedSet.has(preset.slot.pokemonId);
          return (
            <li key={preset.id} className="preset-item">
              <div className="preset-item-info">
                <span className="preset-item-name">{preset.name}</span>
                <span className="preset-item-meta">
                  {pokemon?.name ?? preset.slot.pokemonId} · {new Date(preset.savedAt).toLocaleDateString()}
                  {isTaken && " · 다른 슬롯에 있음"}
                </span>
              </div>
              <div className="preset-item-actions">
                <button type="button" disabled={isTaken} onClick={() => handleLoad(preset)}>
                  불러오기
                </button>
                <button type="button" onClick={() => handleRename(preset)}>
                  이름변경
                </button>
                <button type="button" className="is-danger" onClick={() => handleDelete(preset)}>
                  삭제
                </button>
              </div>
            </li>
          );
        })}
        {sorted.length === 0 && (
          <li className="preset-list-empty">
            {q ? "검색 결과가 없습니다." : "저장된 샘플이 없습니다."}
          </li>
        )}
      </ul>
    </Modal>
  );
}
