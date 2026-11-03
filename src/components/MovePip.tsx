import { useState } from "react";
import { useLongPressDrag } from "../hooks/useLongPressDrag";
import { getMove } from "../lib/data";
import { TYPE_COLORS } from "../lib/typeColors";
import "./PartySlotCard.css";

/** 지금 HTML5 드래그로 잡고 있는 기술 칸(3.5 M1) — dataTransfer는 dragover 중 읽을 수 없어 모듈 변수에 둔다 */
let draggedMovePip: { group: string; move: number } | null = null;

interface MovePipProps {
  /** 같은 그룹(한 포켓몬 카드) 안의 칸끼리만 자리를 맞바꾼다. 화면 안에서 카드마다 다른 문자열 */
  group: string;
  moveIndex: number;
  moveId: string | null;
  onPick: () => void;
  onSwap: (from: number, to: number) => void;
}

/**
 * 기술 칸 하나(3.5 M1) — 같은 슬롯 안의 다른 칸(빈 칸 포함)으로 끌어다 놓으면 자리가 바뀐다.
 * 마우스는 HTML5 드래그, 터치·펜은 길게 눌러 끌기(useLongPressDrag). 카드 전체의 슬롯 교체 드래그와 겹치지 않게
 * 칸에서 시작한 pointerdown·dragstart는 카드로 올리지 않는다.
 */
export function MovePip({ group, moveIndex, moveId, onPick, onSwap }: MovePipProps) {
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  // 6.5 M1 — 칸의 기술이 바뀌면(맞바꾸기·고르기·샘플 불러오기) 짧게 튕겨 자리를 잡는다. 처음 그릴 때는 없다.
  // 렌더 중에 이전 값과 비교하는 방식(effect에서 setState 하지 않는다)
  const [prevMoveId, setPrevMoveId] = useState(moveId);
  const [pop, setPop] = useState(false);
  if (prevMoveId !== moveId) {
    setPrevMoveId(moveId);
    setPop(true);
  }
  const move = moveId ? getMove(moveId) : undefined;
  const moveColor = move?.type ? TYPE_COLORS[move.type] : undefined;
  const pipKey = (m: number) => `${group}:${m}`;

  const touch = useLongPressDrag(
    !!moveId,
    (x, y) => {
      const t = document.elementFromPoint(x, y)?.closest("[data-move-pip]") ?? null;
      const key = t?.getAttribute("data-move-pip") ?? "";
      return key.startsWith(`${group}:`) && key !== pipKey(moveIndex) ? t : null;
    },
    (t) => onSwap(moveIndex, Number(t.getAttribute("data-move-pip")!.split(":")[1])),
  );
  const canDrop = () => draggedMovePip?.group === group && draggedMovePip.move !== moveIndex;

  return (
    <button
      type="button"
      data-move-pip={pipKey(moveIndex)}
      className={`party-move-pip tap-target${move ? " has-type" : " is-empty"}${dragging || touch.dragging ? " is-dragging" : ""}${over ? " is-drag-over" : ""}${pop ? " is-pop" : ""}`}
      onAnimationEnd={() => setPop(false)}
      style={moveColor ? { background: moveColor } : undefined}
      onClick={onPick}
      {...touch.touchProps}
      onPointerDown={(e) => {
        e.stopPropagation();
        touch.touchProps.onPointerDown(e);
      }}
      draggable={!!moveId && !touch.coarse}
      onDragStart={(e) => {
        e.stopPropagation();
        if (touch.isTouch()) return e.preventDefault();
        e.dataTransfer.setData("text/plain", "");
        draggedMovePip = { group, move: moveIndex };
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!canDrop()) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canDrop()) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onSwap(draggedMovePip!.move, moveIndex);
      }}
      onDragEnd={(e) => {
        e.stopPropagation();
        draggedMovePip = null;
        setDragging(false);
      }}
    >
      <span className="party-move-pip-text">{move ? move.name : "＋"}</span>
    </button>
  );
}
