import { useEffect, useState } from "react";

/**
 * id로 식별되는 목록을 로컬 스토리지와 동기화하는 공용 훅(ver.1.5 §11).
 * usePartyPresets/useSlotPresets가 상태 선언 + 저장 이펙트 + id로 지우기까지 완전히
 * 동일한 구조였던 것을 통합한 것 — "새 항목을 어떤 모양으로 만드는지"(savePreset)와
 * "이름을 바꾸는지"(renamePreset) 같은, 두 훅이 여전히 갖고 있는 필드별 세부사항은 이 훅이
 * 관여하지 않고 각자 `setItems`를 직접 써서 처리한다.
 *
 * useBattleVideos는 FIFO 3개 캡이라는 실제 동작 차이가 있어 `prependItem`(무제한 추가)을
 * 쓰지 않고 `setItems`로 직접 캡을 구현한다 — 이 훅은 그 위에 얹히는 최소 공통분모(상태+저장+
 * id 삭제)만 제공한다.
 */
export function useStoredList<T extends { id: string }>(
  loadFn: () => T[],
  saveFn: (items: T[]) => void,
) {
  const [items, setItems] = useState<T[]>(() => loadFn());

  useEffect(() => {
    saveFn(items);
  }, [items, saveFn]);

  /** 새 항목을 맨 앞에 추가한다(최신순 정렬 — 기존 usePartyPresets/useSlotPresets 동작과 동일) */
  function prependItem(item: T) {
    setItems((prev) => [item, ...prev]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  return { items, setItems, prependItem, removeItem };
}
