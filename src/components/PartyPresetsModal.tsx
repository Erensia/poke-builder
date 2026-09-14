import { useState } from "react";
import { Modal } from "./Modal";
import { eulReul } from "../lib/josa";
import type { Party } from "../types/party";
import "./PresetListModal.css";

interface PartyPresetsModalProps {
  presets: Party[];
  onClose: () => void;
  onLoad: (preset: Party) => void;
  /** 불러오기만 노출한다(배틀타워 셋업 §3-2). 저장/이름변경/삭제 UI를 숨기고 콜백도 안 받는다. */
  loadOnly?: boolean;
  /** loadOnly면 불러오기 확인 문구에 붙일 대상 설명(예: "이 진영 빌드"). 기본 "현재 편성 중인 파티". */
  loadTargetLabel?: string;
  onSaveCurrent?: (name: string) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
}

export function PartyPresetsModal({
  presets,
  onClose,
  onLoad,
  loadOnly = false,
  loadTargetLabel = "현재 편성 중인 파티",
  onSaveCurrent,
  onRename,
  onDelete,
}: PartyPresetsModalProps) {
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");

  function handleSaveCurrent() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onSaveCurrent?.(trimmed);
    setNewName("");
  }

  function handleLoad(preset: Party) {
    // ver.1.3 §2: 파티 프리셋 저장은 항상 이 화면(중복 방지가 걸린 슬롯 편집)에서만 이뤄지지만,
    // 이 기능이 생기기 전에 저장된 낡은 프리셋에는 같은 포켓몬이 중복으로 들어 있을 수 있다 —
    // 불러오기 시점에도 한 번 더 검사해 정합성이 깨진 채로 화면에 반영되지 않게 막는다.
    const pokemonIds = preset.slots.map((s) => s?.pokemonId).filter((id): id is string => id !== undefined);
    if (new Set(pokemonIds).size !== pokemonIds.length) {
      window.alert(
        `"${preset.name}"${eulReul(preset.name)} 불러올 수 없습니다. 같은 포켓몬이 여러 슬롯에 중복 저장되어 있습니다.`,
      );
      return;
    }
    if (window.confirm(`"${preset.name}"${eulReul(preset.name)} 불러올까요? ${loadTargetLabel}는 덮어써집니다.`)) {
      onLoad(preset);
      onClose();
    }
  }

  function handleRename(preset: Party) {
    const next = window.prompt("새 이름을 입력하세요.", preset.name);
    if (next === null) return;
    onRename?.(preset.id, next);
  }

  function handleDelete(preset: Party) {
    if (window.confirm(`"${preset.name}"${eulReul(preset.name)} 삭제할까요?`)) {
      onDelete?.(preset.id);
    }
  }

  const q = query.trim().toLowerCase();
  const sorted = [...presets]
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((preset) => !q || preset.name.toLowerCase().includes(q));

  return (
    <Modal title="저장된 파티" onClose={onClose}>
      {!loadOnly && (
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
      )}

      <input
        type="text"
        className="preset-search-input"
        placeholder="파티 이름으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

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
                {!loadOnly && (
                  <>
                    <button type="button" onClick={() => handleRename(preset)}>
                      이름변경
                    </button>
                    <button type="button" className="is-danger" onClick={() => handleDelete(preset)}>
                      삭제
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
        {sorted.length === 0 && (
          <li className="preset-list-empty">
            {q ? "검색 결과가 없습니다." : "저장된 파티가 없습니다."}
          </li>
        )}
      </ul>
    </Modal>
  );
}
