import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";

/** 드래그 교체용 dataTransfer 타입 — 어느 쪽 카드에서 시작했는지는 `${SWAP_MIME}-${role}` 타입으로 실어 보낸다 */
const SWAP_MIME = "application/x-matchup-slot";

/** 터치 길게 누르기 판정(ms)·그 전에 이만큼(px) 움직이면 스크롤로 보고 취소 */
const LONG_PRESS_MS = 400;
const MOVE_SLOP_PX = 10;

/**
 * 내 포켓몬 ⇄ 상대 포켓몬 드래그 교체(3.3 U1). 카드 전체가 드롭 타겟(`dropProps`), 드래그 시작은 프로필 버튼(`dragProps`)에서만 —
 * 카드 안 입력칸의 글자 선택을 막지 않으려고. onSwapDrop이 없으면 교체를 끈다.
 * 터치·펜(3.4 U1-b): HTML5 드래그앤드롭이 안 되므로 프로필 버튼을 길게 눌러(400ms) 반대쪽 카드 위에서 손가락을 떼면 교체한다.
 * 드롭 타겟은 `data-swap-role`로 찾고, 올라간 카드의 하이라이트는 클래스를 직접 붙였다 뗀다(다른 카드의 상태라 이 훅 밖).
 */
export function useSlotSwapDnd(role: "attacker" | "defender", onSwapDrop?: () => void) {
  const [dragOver, setDragOver] = useState(false);
  const [touchDragging, setTouchDragging] = useState(false);
  const lastPointer = useRef("mouse");
  const dragEndedAt = useRef(0);
  // 터치가 주 입력인 기기는 HTML5 드래그를 끈다(길게 누르기 네이티브 드래그와 겹치지 않게)
  const [coarse] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const canSwap = (e: DragEvent) =>
    !!onSwapDrop && e.dataTransfer.types.includes(SWAP_MIME) && !e.dataTransfer.types.includes(`${SWAP_MIME}-${role}`);

  function startTouchDrag(e: ReactPointerEvent) {
    lastPointer.current = e.pointerType;
    if (!onSwapDrop || e.pointerType === "mouse") return;
    const { clientX: startX, clientY: startY } = e;
    let active = false;
    let over: Element | null = null;
    const targetAt = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y)?.closest("[data-swap-role]") ?? null;
      return t && t.getAttribute("data-swap-role") !== role ? t : null;
    };
    const blockScroll = (ev: TouchEvent) => ev.preventDefault();
    const cleanup = () => {
      clearTimeout(timer);
      over?.classList.remove("is-drag-over");
      document.removeEventListener("touchmove", blockScroll);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cleanup);
      setTouchDragging(false);
    };
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_SLOP_PX) cleanup();
        return;
      }
      const t = targetAt(ev.clientX, ev.clientY);
      if (t === over) return;
      over?.classList.remove("is-drag-over");
      t?.classList.add("is-drag-over");
      over = t;
    };
    const up = (ev: PointerEvent) => {
      if (active && targetAt(ev.clientX, ev.clientY)) onSwapDrop();
      if (active) dragEndedAt.current = Date.now();
      cleanup();
    };
    const timer = setTimeout(() => {
      active = true;
      setTouchDragging(true);
      navigator.vibrate?.(30);
      // 길게 누른 뒤에는 손가락을 움직여도 화면이 스크롤되지 않게 한다(passive: false여야 막을 수 있다)
      document.addEventListener("touchmove", blockScroll, { passive: false });
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cleanup);
  }

  return {
    dragOverClass: (dragOver ? " is-drag-over" : "") + (touchDragging ? " is-touch-dragging" : ""),
    dropProps: {
      ...(onSwapDrop && { "data-swap-role": role }),
      onDragOver: (e: DragEvent) => {
        if (!canSwap(e)) return;
        e.preventDefault();
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (e: DragEvent) => {
        setDragOver(false);
        if (!canSwap(e)) return;
        e.preventDefault();
        onSwapDrop?.();
      },
    },
    dragProps: {
      draggable: !!onSwapDrop && !coarse,
      onPointerDown: startTouchDrag,
      // 터치로 시작된 네이티브 드래그·길게 누르기 메뉴는 막는다(직접 만든 길게 누르기 드래그가 대신한다)
      onDragStart: (e: DragEvent) => {
        if (lastPointer.current !== "mouse") {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(SWAP_MIME, role);
        e.dataTransfer.setData(`${SWAP_MIME}-${role}`, role);
        e.dataTransfer.effectAllowed = "move";
      },
      // 길게 눌러 끌다 뗀 직후 따라오는 click은 프로필 버튼(포켓몬 고르기)을 열지 않게 삼킨다
      onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
        if (Date.now() - dragEndedAt.current < 400) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onContextMenu: (e: { preventDefault: () => void }) => {
        if (lastPointer.current !== "mouse") e.preventDefault();
      },
      title: onSwapDrop ? "반대쪽 포켓몬 카드로 끌어다 놓으면 자리가 바뀝니다 (터치는 길게 눌러서 끌기)" : undefined,
    },
  };
}
