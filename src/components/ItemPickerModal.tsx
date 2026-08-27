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
  /**
   * 이미 파티의 다른 슬롯이 지니고 있는 도구 id 목록(현재 편집 중인 슬롯 자신은 제외하고 넘겨야
   * 함) — Phase 6 중복 방지: 같은 도구를 파티 내 1마리만 지닐 수 있다(본가 규칙). 없으면
   * (undefined) 아무도 막지 않는다.
   */
  usedItemIds?: string[];
}

export function ItemPickerModal({
  pokemon,
  currentItemId,
  onSelect,
  onClear,
  onClose,
  usedItemIds,
}: ItemPickerModalProps) {
  const [query, setQuery] = useState("");
  const usedSet = new Set(usedItemIds);

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
          const isTaken = usedSet.has(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`move-picker-item${active ? " is-used" : ""}${isTaken ? " is-taken" : ""}`}
                style={{ gridTemplateColumns: "1fr auto" }}
                disabled={isTaken}
                onClick={() => onSelect(item.id)}
              >
                <span className="move-picker-name">{item.name}</span>
                {isTaken ? (
                  <span className="move-picker-cat">다른 슬롯에 있음</span>
                ) : (
                  isOwn && <span className="move-picker-cat">전용 메가스톤</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
