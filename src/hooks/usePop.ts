import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent } from "react";

/**
 * 값이 바뀌면(처음 그릴 때는 제외) pop이 true가 됐다가 그 요소의 애니메이션이 끝나면 false로 돌아온다 — 6.5 M1.
 * 쓰는 쪽은 pop일 때 팝 클래스(CSS 애니메이션)를 붙이고 onAnimationEnd를 요소에 단다.
 * 렌더 중에 이전 값과 비교한다(effect에서 setState 하지 않는다). 자식의 애니메이션 끝이 올라와도 무시한다.
 * whenEmpty가 false면 값이 비게(null) 바뀔 때는 팝하지 않는다(카드를 비울 때).
 */
export function usePop(value: unknown, whenEmpty = true) {
  const [prev, setPrev] = useState(value);
  const [pop, setPop] = useState(false);
  if (prev !== value) {
    setPrev(value);
    if (whenEmpty || value != null) setPop(true);
  }
  return {
    pop,
    onAnimationEnd: (e: AnimationEvent) => {
      if (e.target === e.currentTarget) setPop(false);
    },
  };
}

/**
 * 요소의 높이가 key가 바뀐 렌더에서 달라졌으면 이전 높이에서 새 높이로 이어서 변하게 한다(6.5 M1) — 카드(빈 슬롯 ↔ 채워진 카드),
 * 환경 선택기(알약 줄 열림·요약 줄 등장)가 쓴다. 돌려준 값을 맨 바깥 요소의 ref에 단다. 동작 줄이기에서는 생략한다.
 * 콜백 ref(state)로 받는다 — ref 객체를 돌려주면 린트가 렌더 중 접근으로 본다.
 */
export function useHeightTween(key: string) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const lastHeight = useRef(0);
  const lastKey = useRef(key);
  // 매 렌더 끝에 높이를 기억해 두고, key가 바뀐 렌더에서만 이어서 변하게 한다
  useLayoutEffect(() => {
    if (!node) return;
    const height = node.offsetHeight;
    const before = lastHeight.current;
    const changed = lastKey.current !== key;
    lastKey.current = key;
    lastHeight.current = height;
    // 동작 줄이기에서는 생략(웹 애니메이션 API는 CSS 미디어 쿼리의 영향을 받지 않는다)
    if (!changed || !before || Math.abs(before - height) < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 커지는 쪽은 새 내용이 애니메이션 높이보다 길어 넘치므로 애니메이션 동안만 overflow를 가린다(키프레임에 같이 넣으면 끝나고 저절로 원래대로)
    // 빈 슬롯처럼 min-height가 있는 요소는 height만 키우면 min-height가 즉시 받쳐서 점프하므로 minHeight도 같이 옮긴다(6.6 M3b)
    node.animate(
      [
        { height: `${before}px`, minHeight: `${before}px`, overflow: "hidden" },
        { height: `${height}px`, minHeight: `${height}px`, overflow: "hidden" },
      ],
      { duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
    );
  });
  return setNode;
}

/**
 * 포켓몬 카드의 등장·퇴장 모션(6.5 M1 D) — 포켓몬이 바뀌어 채워지면 card-pop, ✕로 비우면 card-leave로 줄어들며 사라진 뒤
 * onClear를 부른다(카드는 같은 자리에서 빈 슬롯 모양으로 바뀌는 것이라, 퇴장을 보이려면 비우는 동작을 잠깐 미룬다).
 * 반환은 [카드 맨 바깥 요소의 ref, 모션 값]. ref는 카드 요소에, motionClass는 카드 클래스에, onAnimationEnd는 카드에 달고, ✕에는 clear를 쓴다.
 * (ref를 객체의 한 속성으로 돌려주면 린트가 그 객체 전체를 ref로 보고 나머지 접근을 렌더 중 ref 접근이라고 오탐한다)
 * 카드 높이가 달라지면(빈 슬롯 ↔ 채워진 카드) 이전 높이에서 새 높이로 이어서 변한다(ref를 카드 맨 바깥 요소에 단다).
 * 애니메이션 종료가 오지 않는 경우(탭이 숨겨짐 등)를 대비해 안전 타이머(400ms)로 반드시 비운다.
 * reloadKey가 바뀌면(파티 프리셋 불러오기, 8.1 U7) 같은 포켓몬이 같은 칸에 들어와도 채워진 카드는 다시 튕긴다.
 */
export function useCardMotion(pokemonId: string | null, onClear: () => void, variant = "", reloadKey = 0) {
  const { pop, onAnimationEnd: popEnd } = usePop(pokemonId === null ? null : `${pokemonId}|${reloadKey}`, false);
  const [leaving, setLeaving] = useState(false);
  // variant(압축 ↔ 펼침 같은 모양 구분)가 바뀌어도 높이가 이어서 변한다(6.6 M3b)
  const attach = useHeightTween(`${pokemonId ?? ""}|${variant}`);
  const finish = () => {
    setLeaving(false);
    onClear();
  };
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(finish, 400);
    return () => clearTimeout(id);
    // finish는 매 렌더 새로 만들어지지만 하는 일(leaving 해제 + onClear)은 같아서 leaving 변화에만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  return [
    attach,
    {
      motionClass: leaving ? " card-leave" : pop ? " card-pop" : "",
      clear: () => setLeaving(true),
      onAnimationEnd: (e: AnimationEvent) => {
        if (e.target !== e.currentTarget) return;
        if (leaving) finish();
        else popEnd(e);
      },
    },
  ] as const;
}
