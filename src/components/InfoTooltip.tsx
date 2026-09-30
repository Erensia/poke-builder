import { useEffect, useRef, useState, type ReactNode } from "react";
import "./InfoTooltip.css";

/**
 * 설명 말풍선(ver.2.0 1-C — 사용자 요청): PC는 감싼 요소에 마우스를 올리면, 모바일은 옆 ⓘ를 탭하면 같은 설명이 뜬다. 바깥을 탭하면 닫힌다.
 */
export function InfoTooltip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <span className="info-tooltip" ref={ref}>
      {children}
      <button type="button" className="info-tooltip-icon" aria-label="설명 보기" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ⓘ
      </button>
      <span className={`info-tooltip-bubble${open ? " is-open" : ""}`} role="tooltip">
        {text}
      </span>
    </span>
  );
}
