import { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "../lib/cloudSync";
import "./SyncDot.css";

/**
 * 클라우드와 내용이 달라 사용자가 고를 때까지 동기화가 멈춰 있을 때(6.2 C1) 보이는 점. 앱을 열 때 생긴 충돌은 백업 모달을 열기 전까지
 * 알 수 없었다 — "백업" 버튼과, 다른 화면에서도 보이도록 사이드바·하단 탭의 "파티" 항목에 단다. 충돌이 풀리면 사라진다.
 */
const MESSAGE = "클라우드와 내용이 달라 확인이 필요해요";
const useConflict = () => useSyncExternalStore(subscribeSyncStatus, () => getSyncStatus().conflicts.length > 0);

export function SyncDot() {
  return useConflict() ? <span className="sync-dot" role="img" aria-label={MESSAGE} /> : null;
}

/**
 * 스크린리더용 안내(6.4 S1): 점은 정적이라 사용 중에 충돌이 "생기는 순간"을 알려 주지 못한다. 앱에 한 번만 두는 상태 영역 — 점은 사이드바·하단 탭·버튼에 여러 개라
 * 각각을 live 영역으로 만들면 같은 말을 여러 번 읽는다. 영역은 항상 있어야(내용만 바뀌어야) 읽어 주므로 충돌이 없을 땐 빈 채로 둔다.
 */
export function SyncAnnouncer() {
  return (
    <div className="sync-announcer" role="status">
      {useConflict() ? `${MESSAGE}. 백업 창에서 고를 수 있어요.` : ""}
    </div>
  );
}
