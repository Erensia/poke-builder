import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** 터치 길게 누르기 판정(ms)·그 전에 이만큼(px) 움직이면 스크롤로 보고 취소 */
const LONG_PRESS_MS = 300;
const MOVE_SLOP_PX = 10;

/**
 * 터치·펜 "길게 눌러 끌기"(3.4 U1-b) — HTML5 드래그앤드롭이 안 되는 터치 기기용. 300ms 누르면 끌기 모드(진동),
 * 손가락 아래에서 `findTarget`이 돌려주는 요소에 `is-drag-over` 클래스를 붙였다 떼고, 거기서 손가락을 떼면 `onDrop(target)`.
 * 끌기 모드 중엔 스크롤을 막고, 끌고 난 직후 click은 삼킨다. 드롭 타겟의 하이라이트는 다른 컴포넌트의 상태라 클래스를 직접 조작한다.
 * 반환한 `touchProps`를 끄는 요소에 펼쳐 쓴다. `isTouch()`는 마지막 입력이 터치·펜인지(네이티브 드래그 취소용).
 */
export function useLongPressDrag(enabled: boolean, findTarget: (x: number, y: number) => Element | null, onDrop: (target: Element) => void) {
  const [dragging, setDragging] = useState(false);
  const lastPointer = useRef("mouse");
  const dragEndedAt = useRef(0);
  // 터치가 주 입력인 기기는 HTML5 드래그를 꺼야 네이티브 길게 누르기 드래그와 겹치지 않는다
  const [coarse] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

  function onPointerDown(e: ReactPointerEvent) {
    lastPointer.current = e.pointerType;
    if (!enabled || e.pointerType === "mouse") return;
    const { clientX: startX, clientY: startY } = e;
    let active = false;
    let over: Element | null = null;
    const blockScroll = (ev: TouchEvent) => ev.preventDefault();
    const cleanup = () => {
      clearTimeout(timer);
      over?.classList.remove("is-drag-over");
      document.removeEventListener("touchmove", blockScroll);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cleanup);
      setDragging(false);
    };
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_SLOP_PX) cleanup();
        return;
      }
      const t = findTarget(ev.clientX, ev.clientY);
      if (t === over) return;
      over?.classList.remove("is-drag-over");
      t?.classList.add("is-drag-over");
      over = t;
    };
    const up = (ev: PointerEvent) => {
      const t = active ? findTarget(ev.clientX, ev.clientY) : null;
      if (active) dragEndedAt.current = Date.now();
      cleanup();
      if (t) onDrop(t);
    };
    const timer = setTimeout(() => {
      active = true;
      setDragging(true);
      navigator.vibrate?.(30);
      // 길게 누른 뒤에는 손가락을 움직여도 화면이 스크롤되지 않게 한다(passive: false여야 막을 수 있다)
      document.addEventListener("touchmove", blockScroll, { passive: false });
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cleanup);
  }

  return {
    dragging,
    coarse,
    isTouch: () => lastPointer.current !== "mouse",
    touchProps: {
      onPointerDown,
      // 길게 눌러 끌다 뗀 직후 따라오는 click은 안의 버튼(포켓몬 고르기 등)을 열지 않게 삼킨다
      onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
        if (Date.now() - dragEndedAt.current < 400) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      // 터치로 길게 누를 때 뜨는 메뉴 방지
      onContextMenu: (e: { preventDefault: () => void }) => {
        if (lastPointer.current !== "mouse") e.preventDefault();
      },
    },
  };
}
