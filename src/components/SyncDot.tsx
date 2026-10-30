import { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "../lib/cloudSync";
import "./SyncDot.css";

/**
 * 클라우드와 내용이 달라 사용자가 고를 때까지 동기화가 멈춰 있을 때(6.2 C1) 보이는 점. 앱을 열 때 생긴 충돌은 백업 모달을 열기 전까지
 * 알 수 없었다 — "백업" 버튼과, 다른 화면에서도 보이도록 사이드바·하단 탭의 "파티" 항목에 단다. 충돌이 풀리면 사라진다.
 */
export function SyncDot() {
  const conflict = useSyncExternalStore(subscribeSyncStatus, () => getSyncStatus().conflicts.length > 0);
  return conflict ? <span className="sync-dot" role="img" aria-label="클라우드와 내용이 달라 확인이 필요해요" /> : null;
}
