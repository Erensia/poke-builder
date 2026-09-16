import type { ReactNode } from "react";
import "./Modal.css";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** modal-panel에 덧붙일 클래스(ver.1.6 §2-2) — 내용이 짧은 모달이 모바일 하단 시트에서
   *  화면 아래쪽에 작게 눌러앉아 보이는 걸 그 모달만 골라서 고칠 때 씀. */
  panelClassName?: string;
}

export function Modal({ title, onClose, children, panelClassName }: ModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-panel${panelClassName ? ` ${panelClassName}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
