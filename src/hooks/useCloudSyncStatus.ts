import { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "../lib/cloudSync";

/** 클라우드 동기화 상태(6.0 K3) — 동기화는 화면 밖(앱 전체)에서 돌고, 백업 모달은 그 상태를 보여 주기만 한다 */
export function useCloudSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}
