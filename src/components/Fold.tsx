import { useState, type ReactNode } from "react";
import "./Fold.css";

interface FoldProps {
  title: ReactNode;
  children: ReactNode;
  /** 저장된 상태가 없을 때의 첫 상태. 기본은 펼침 */
  defaultOpen?: boolean;
  /** 주면 펼침/접힘을 `localStorage`에 기억해 다음에 열 때 그대로 시작한다(7.7). 안 주면 기억하지 않는다 */
  storageKey?: string;
}

function readOpen(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;
  try {
    const v = localStorage.getItem(storageKey);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback; // localStorage가 막힌 환경(프라이빗 모드 등)
  }
}

/** 접고 펼 수 있는 구역(스피드 조정 탭에서 시작, 7.6 T1에서 공용화) — 머리글을 누르면 접히고 다시 누르면 펼쳐진다. */
export function Fold({ title, children, defaultOpen = true, storageKey }: FoldProps) {
  const [open] = useState(() => readOpen(storageKey, defaultOpen));
  return (
    <details
      className="fold"
      open={open}
      onToggle={(e) => {
        if (!storageKey) return;
        try {
          localStorage.setItem(storageKey, e.currentTarget.open ? "1" : "0");
        } catch {
          // 저장 못 해도 이번 화면의 접기/펴기에는 지장 없다
        }
      }}
    >
      <summary className="fold-title">{title}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
