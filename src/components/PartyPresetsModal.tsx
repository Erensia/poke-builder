import { useState } from "react";
import { Modal } from "./Modal";
import type { Party } from "../types/party";
import "./PresetListModal.css";

interface PartyPresetsModalProps {
  presets: Party[];
  onClose: () => void;
  onSaveCurrent: (name: string) => void;
  onLoad: (preset: Party) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function PartyPresetsModal({
  presets,
  onClose,
  onSaveCurrent,
  onLoad,
  onRename,
  onDelete,
}: PartyPresetsModalProps) {
  const [newName, setNewName] = useState("");

  function handleSaveCurrent() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onSaveCurrent(trimmed);
    setNewName("");
  }

  function handleLoad(preset: Party) {
    if (window.confirm(`"${preset.name}"을(를) 불러올까요? 현재 편성 중인 파티는 덮어써집니다.`)) {
      onLoad(preset);
      onClose();
    }
  }

  function handleRename(preset: Party) {
    const next = window.prompt("새 이름을 입력하세요.", preset.name);
    if (next === null) return;
    onRename(preset.id, next);
  }

  function handleDelete(preset: Party) {
    if (window.confirm(`"${preset.name}"을(를) 삭제할까요?`)) {
      onDelete(preset.id);
    }
  }

  const sorted = [...presets].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <Modal title="저장된 파티" onClose={onClose}>
      <div className="preset-save-row">
        <input
          type="text"
          className="preset-save-input"
          placeholder="현재 파티를 이 이름으로 저장"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveCurrent();
          }}
          autoFocus
        />
        <button
          type="button"
          className="preset-save-button"
          onClick={handleSaveCurrent}
          disabled={!newName.trim()}
        >
          저장
        </button>
      </div>

      <ul className="preset-list">
        {sorted.map((preset) => {
          const filledCount = preset.slots.filter((s) => s !== null).length;
          return (
            <li key={preset.id} className="preset-item">
              <div className="preset-item-info">
                <span className="preset-item-name">{preset.name}</span>
                <span className="preset-item-meta">
                  {filledCount} / 6마리 · {new Date(preset.savedAt).toLocaleDateString()}
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
        {sorted.length === 0 && <li className="preset-list-empty">저장된 파티가 없습니다.</li>}
      </ul>
    </Modal>
  );
}
