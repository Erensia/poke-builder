import { Modal } from "./Modal";
import { NATURES } from "../lib/data";
import { STAT_LABELS } from "../lib/statLabels";
import "./MovePickerModal.css";

interface NaturePickerModalProps {
  currentNatureId: string | null;
  onSelect: (natureId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function NaturePickerModal({
  currentNatureId,
  onSelect,
  onClear,
  onClose,
}: NaturePickerModalProps) {
  return (
    <Modal title="성격 선택" onClose={onClose}>
      <button type="button" className="move-clear-btn" onClick={onClear}>
        성격 비우기 (무보정)
      </button>
      <ul className="move-picker-list">
        {NATURES.map((nature) => {
          const active = nature.id === currentNatureId;
          return (
            <li key={nature.id}>
              <button
                type="button"
                className={`move-picker-item${active ? " is-used" : ""}`}
                style={{ gridTemplateColumns: "1fr auto" }}
                onClick={() => onSelect(nature.id)}
              >
                <span className="move-picker-name">{nature.name}</span>
                <span className="move-picker-cat">
                  {nature.increased && nature.decreased
                    ? `${STAT_LABELS[nature.increased]}↑ / ${STAT_LABELS[nature.decreased]}↓`
                    : "무보정"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
