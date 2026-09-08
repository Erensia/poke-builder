import { Modal } from "./Modal";
import type { CosmeticForm } from "../types/pokemon";
import "./MovePickerModal.css";

interface CosmeticFormPickerModalProps {
  /** 대상 포켓몬 이름 — 모달 제목에 쓴다 */
  pokemonName: string;
  forms: CosmeticForm[];
  currentFormId: string | null;
  onSelect: (formId: string) => void;
  onClose: () => void;
}

/**
 * 마휘핑 계열 겉모습(이미지만 갈림)을 고르는 리스트 모달. 옵션이 5개 이상이라 슬롯 카드에서
 * 클릭 순환하기 불편한 종(비비용 등)에서만 열린다 — 4개 이하는 슬롯 카드 pip이 그대로 순환한다.
 */
export function CosmeticFormPickerModal({
  pokemonName,
  forms,
  currentFormId,
  onSelect,
  onClose,
}: CosmeticFormPickerModalProps) {
  const effectiveId =
    forms.find((f) => f.id === currentFormId)?.id ??
    forms.find((f) => f.standard)?.id ??
    forms[0]?.id;

  return (
    <Modal title={`${pokemonName} 모습 선택`} onClose={onClose}>
      <ul className="move-picker-list">
        {forms.map((form) => {
          const active = form.id === effectiveId;
          return (
            <li key={form.id}>
              <button
                type="button"
                className={`move-picker-item${active ? " is-used" : ""}`}
                style={{ gridTemplateColumns: "1fr auto" }}
                onClick={() => onSelect(form.id)}
              >
                <span className="move-picker-name">{form.label}</span>
                {form.standard && <span className="move-picker-cat">기본</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
