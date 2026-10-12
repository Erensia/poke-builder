import { useState, type DragEvent } from "react";

/** 드래그 교체용 dataTransfer 타입 — 어느 쪽 카드에서 시작했는지는 `${SWAP_MIME}-${role}` 타입으로 실어 보낸다 */
const SWAP_MIME = "application/x-matchup-slot";

/**
 * 내 포켓몬 ⇄ 상대 포켓몬 드래그 교체(3.3 U1). 카드 전체가 드롭 타겟(`dropProps`), 드래그 시작은 프로필 버튼(`dragProps`)에서만 —
 * 카드 안 입력칸의 글자 선택을 막지 않으려고. onSwapDrop이 없으면 교체를 끈다.
 */
export function useSlotSwapDnd(role: "attacker" | "defender", onSwapDrop?: () => void) {
  const [dragOver, setDragOver] = useState(false);
  const canSwap = (e: DragEvent) =>
    !!onSwapDrop && e.dataTransfer.types.includes(SWAP_MIME) && !e.dataTransfer.types.includes(`${SWAP_MIME}-${role}`);
  return {
    dragOverClass: dragOver ? " is-drag-over" : "",
    dropProps: {
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
      draggable: !!onSwapDrop,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.setData(SWAP_MIME, role);
        e.dataTransfer.setData(`${SWAP_MIME}-${role}`, role);
        e.dataTransfer.effectAllowed = "move";
      },
      title: onSwapDrop ? "반대쪽 포켓몬 카드로 끌어다 놓으면 자리가 바뀝니다" : undefined,
    },
  };
}
