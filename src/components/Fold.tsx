import type { ReactNode } from "react";
import "./Fold.css";

/** 접고 펼 수 있는 구역(스피드 조정 탭에서 시작, 7.6 T1에서 공용화) — 머리글을 누르면 접히고 다시 누르면 펼쳐진다. 기본은 펼침. */
export function Fold({ title, children, defaultOpen = true }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="fold" open={defaultOpen}>
      <summary className="fold-title">{title}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
