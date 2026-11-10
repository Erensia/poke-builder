import { useLayoutEffect, useRef, useState } from "react";
import type { Side, SlotIndex } from "./shared";

/**
 * BattleSetupScreen에서 뺀 UI 상태 훅 3개(7.0 R-4) — 서로 독립이라 화면 컴포넌트가 한 함수 안에 다 들고 있던 것을 나눴다.
 * 동작은 그대로다(BattleSetupScreen이 같은 순서로 호출한다).
 */

/** 드래그앤드롭으로 슬롯 순서 변경(ver.1.6 §4-2) — PartyBoard와 동일한 패턴. 편(side)이 다르면 맞바꾸지 않는다(내 파티 ↔ 상대 파티 사이 드래그는 의미가 없다). */
export function useSlotDnd(reorderSlots: (side: Side, from: number, to: number) => void) {
  const [dragged, setDragged] = useState<{ side: Side; index: SlotIndex } | null>(null);
  const [dragOver, setDragOver] = useState<{ side: Side; index: SlotIndex } | null>(null);
  return {
    isDragging: (side: Side, i: SlotIndex) => dragged?.side === side && dragged.index === i,
    isDragOver: (side: Side, i: SlotIndex) => dragOver?.side === side && dragOver.index === i,
    onDragStart: (side: Side, index: SlotIndex) => setDragged({ side, index }),
    onDragOver: (side: Side, index: SlotIndex) => {
      if (!dragged || dragged.side !== side || dragged.index === index) return;
      setDragOver({ side, index });
    },
    onDrop: (side: Side, index: SlotIndex) => {
      if (dragged && dragged.side === side) reorderSlots(side, dragged.index, index);
      setDragged(null);
      setDragOver(null);
    },
    onDragEnd: () => {
      setDragged(null);
      setDragOver(null);
    },
  };
}

/** 압축 뷰(ver.1.6 §4-3) — 기본은 압축(프로필 사진+이름만), 펼친 슬롯만 이 집합에 담는다. */
export function useExpandedSlots() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const keyOf = (side: Side, i: SlotIndex) => `${side}-${i}`;
  return {
    isExpanded: (side: Side, i: SlotIndex) => expanded.has(keyOf(side, i)),
    toggle: (side: Side, i: SlotIndex) => {
      const key = keyOf(side, i);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
  };
}

/**
 * 랭크 "배틀 시작" 연출(6.4 U2) — 1초 버전(0.8초 버전의 앞부분 + 충돌 뒤 잦아드는 꼬리): 시작 안내가 떠 있다가 VS가 가능해지는 순간, 양쪽 파티가 바깥으로 빠르게 당겨졌다가 → 점점 빨라져 제자리로 돌진 → 쾅(찌그러짐 + VS 펀치) → 튕겨 나와 안착한다.
 * 레이아웃은 그대로 두고 transform만 쓴다(열 폭이 변하면 제목 줄의 AI 알약이 다시 줄바꿈된다). 처음부터 가능한 채로 열 때·자유 대전의 파티 완성 때는 재생하지 않는다. 세로 배치(모바일)는 가로 이동이 보이지 않아 건너뛴다.
 * 돌려주는 값은 [왼쪽(0)·오른쪽(1) 열에 달 콜백 ref 만들기, VS 버튼 ref] — ref를 객체 속성이 아니라 배열로 돌려준다(린트 오탐 방지).
 */
export function useClashMotion(canProceed: boolean, proceedBlockedReason: string | undefined) {
  const colEls = useRef<(HTMLDivElement | null)[]>([]);
  const vsEl = useRef<HTMLButtonElement>(null);
  const wasReady = useRef(canProceed);
  const waitedForRank = useRef(false); // 직전에 랭크 시작 안내가 떠 있었는지
  useLayoutEffect(() => {
    if (proceedBlockedReason) waitedForRank.current = true;
    if (canProceed === wasReady.current) return;
    wasReady.current = canProceed;
    if (!canProceed) return;
    const played = waitedForRank.current;
    waitedForRank.current = false;
    if (!played || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 8.1 U3: 두 열이 위아래로 쌓이는 폭(920px 이하, battleControls.css의 셋업 전환점과 같다)에서는 위아래로 부딪힌다.
    // 좌우로 당기면 360px 폰에서 열(340px) + 26px이 화면 밖으로 나가 잘리고, 쌓인 배치에서는 방향도 어색했다
    const stacked = window.matchMedia("(max-width: 920px)").matches;
    const ax = stacked ? "Y" : "X"; // 움직이는 축
    colEls.current.forEach((el, i) => {
      if (!el) return;
      const out = i === 0 ? -1 : 1; // 바깥쪽 방향(가로: 왼쪽 열은 왼쪽·오른쪽 열은 오른쪽, 세로: 위 열은 위·아래 열은 아래)
      // 서로 맞닿는 쪽 모서리 기준으로 찌그러진다
      el.style.transformOrigin = stacked ? (i === 0 ? "center bottom" : "center top") : i === 0 ? "right center" : "left center";
      el.animate(
        [
          { transform: "none", easing: "ease-out" }, // 0~0.17s: 바깥으로 빠르게 당겨진다
          { offset: 0.17, transform: `translate${ax}(${out * 26}px)`, easing: "cubic-bezier(0.6, 0, 1, 0.4)" }, // 0.17~0.58s: 점점 빨라져 돌진
          { offset: 0.58, transform: `translate${ax}(0) scale${ax}(0.94)`, easing: "ease-out" }, // 0.58s: 쾅 — 맞닿는 쪽으로 찌그러진다
          { offset: 0.69, transform: `translate${ax}(${out * 9}px) scale${ax}(1.025)`, easing: "ease-in-out" }, // 튕겨 나온다
          { offset: 0.8, transform: `translate${ax}(${-out * 2}px) scale${ax}(0.98)`, easing: "ease-in-out" }, // 한 번 더 눌렸다가
          { offset: 0.9, transform: `translate${ax}(${out * 3}px) scale${ax}(1.008)`, easing: "ease-in-out" }, // 살짝 반동하며
          { transform: "none" }, // 잦아든다
        ],
        { duration: 1000, easing: "linear" },
      );
    });
    const vs = vsEl.current;
    if (!vs) return;
    vs.classList.remove("is-hit");
    void vs.offsetWidth; // 클래스를 뗐다 붙여 애니메이션을 처음부터 다시 재생
    vs.classList.add("is-hit");
    const t = setTimeout(() => vs.classList.remove("is-hit"), 1300);
    return () => clearTimeout(t);
  }, [canProceed, proceedBlockedReason]);
  const columnRef = (index: 0 | 1) => (el: HTMLDivElement | null) => {
    colEls.current[index] = el;
  };
  return [columnRef, vsEl] as const;
}
