import { Modal } from "./Modal";
import type { SlotPreset } from "../types/party";
import { getPokemon } from "../lib/data";
import "./PresetListModal.css";

interface SlotPresetsModalProps {
  presets: SlotPreset[];
  /** 현재 이 슬롯에 뭔가 채워져 있으면(=불러오면 덮어씀) true — 확인 문구 분기용 */
  slotIsFilled: boolean;
  onClose: () => void;
  onLoad: (preset: SlotPreset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function SlotPresetsModal({
  presets,
  slotIsFilled,
  onClose,
  onLoad,
  onRename,
  onDelete,
}: SlotPresetsModalProps) {
  function handleLoad(preset: SlotPreset) {
    if (slotIsFilled && !window.confirm(`"${preset.name}"을(를) 불러올까요? 이 슬롯의 내용이 덮어써집니다.`)) {
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
    if (window.confirm(`"${preset.name}"을(를) 삭제할까요?`)) {
      onDelete(preset.id);
    }
  }

  const sorted = [...presets].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <Modal title="저장된 샘플에서 불러오기" onClose={onClose}>
      <ul className="preset-list">
        {sorted.map((preset) => {
          const pokemon = getPokemon(preset.slot.pokemonId);
          return (
            <li key={preset.id} className="preset-item">
              <div className="preset-item-info">
                <span className="preset-item-name">{preset.name}</span>
                <span className="preset-item-meta">
                  {pokemon?.name ?? preset.slot.pokemonId} · {new Date(preset.savedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="preset-item-actions">
                <button type="button" onClick={() => handleLoad(preset)}>
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
        {sorted.length === 0 && <li className="preset-list-empty">저장된 샘플이 없습니다.</li>}
      </ul>
    </Modal>
  );
}
