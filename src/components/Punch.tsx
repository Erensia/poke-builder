import type { ReactNode } from "react";
import { usePop } from "../hooks/usePop";

/**
 * 값이 바뀔 때마다 한 번 튀는 문구(6.5 M1 E) — k가 바뀐 렌더에서 짧게 커졌다 돌아온다(처음 그릴 때는 없음).
 * 결과 카드의 난수 범위·선공 문구처럼 계산 결과가 바뀌는 곳에 쓴다.
 */
export function Punch({ k, className, children }: { k: string | number | null; className?: string; children: ReactNode }) {
  const { pop, onAnimationEnd } = usePop(k, false);
  return (
    <span className={`${className ?? ""}${pop ? " punch" : ""}`} onAnimationEnd={onAnimationEnd}>
      {children}
    </span>
  );
}
