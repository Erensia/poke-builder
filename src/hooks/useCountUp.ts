import { useEffect, useState } from "react";

/** 시스템 "동작 줄이기"가 켜져 있는지 — 웹 애니메이션·타이머 기반 모션은 CSS 전역 규칙이 처리하지 못해 직접 확인한다 */
export const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * from에서 to까지 delay 뒤에 duration 동안 올라가는(내려가는) 숫자 — 승패 직후 레이팅이 바뀌는 모습(6.5 M1 H).
 * 동작 줄이기에서는 처음부터 to를 돌려준다. 값이 바뀌지 않으면(from === to) 그대로 to.
 */
export function useCountUp(from: number, to: number, delay = 0, duration = 700) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : from));
  useEffect(() => {
    if (from === to || prefersReducedMotion()) return;
    let raf = 0;
    const id = setTimeout(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        setValue(from + (to - from) * (1 - (1 - p) ** 3));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [from, to, delay, duration]);
  return from === to ? to : value;
}
