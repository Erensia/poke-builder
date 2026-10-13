import { useState, type DragEvent } from "react";
import { useLongPressDrag } from "./useLongPressDrag";

/** 드래그 교체용 dataTransfer 타입 — 어느 쪽 카드에서 시작했는지는 `${SWAP_MIME}-${role}` 타입으로 실어 보낸다 */
const SWAP_MIME = "application/x-matchup-slot";

/**
 * 내 포켓몬 ⇄ 상대 포켓몬 드래그 교체(3.3 U1). 카드 전체가 드롭 타겟(`dropProps`), 드래그 시작은 프로필 버튼(`dragProps`)에서만 —
 * 카드 안 입력칸의 글자 선택을 막지 않으려고. onSwapDrop이 없으면 교체를 끈다.
 * 터치·펜(3.4 U1-b): 프로필 버튼을 길게 눌러 반대쪽 카드(`data-swap-role`) 위에서 손가락을 떼면 교체한다(useLongPressDrag).
 */
export function useSlotSwapDnd(role: "attacker" | "defender", onSwapDrop?: () => void) {
  const [dragOver, setDragOver] = useState(false);
  const canSwap = (e: DragEvent) =>
    !!onSwapDrop && e.dataTransfer.types.includes(SWAP_MIME) && !e.dataTransfer.types.includes(`${SWAP_MIME}-${role}`);
  const touch = useLongPressDrag(
    !!onSwapDrop,
    (x, y) => {
      const t = document.elementFromPoint(x, y)?.closest("[data-swap-role]") ?? null;
      return t && t.getAttribute("data-swap-role") !== role ? t : null;
    },
    () => onSwapDrop?.(),
  );

  return {
    dragOverClass: (dragOver ? " is-drag-over" : "") + (touch.dragging ? " is-touch-dragging" : ""),
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
      ...touch.touchProps,
      draggable: !!onSwapDrop && !touch.coarse,
      // 터치로 시작된 네이티브 드래그는 막는다(직접 만든 길게 누르기 드래그가 대신한다)
      onDragStart: (e: DragEvent) => {
        if (touch.isTouch()) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(SWAP_MIME, role);
        e.dataTransfer.setData(`${SWAP_MIME}-${role}`, role);
        e.dataTransfer.effectAllowed = "move";
      },
      title: onSwapDrop ? "반대쪽 포켓몬 카드로 끌어다 놓으면 자리가 바뀝니다 (터치는 길게 눌러서 끌기)" : undefined,
    },
  };
}
