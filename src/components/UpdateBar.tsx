import { useState, useSyncExternalStore } from "react";
import { getSwUpdated, subscribeSwUpdate } from "../lib/registerSw";
import { loadBattleRank } from "../lib/storage";
import "./UpdateBar.css";

/**
 * 열어 둔 탭에 새 버전이 적용됐을 때 하단에 띄우는 안내(6.6 P2). 자동으로 새로고침하지 않는다 — 작업 중일 수 있어서.
 * 랭크 대전 중에는 새로고침이 이탈(패배)로 정산되므로 막고 이유를 알린다.
 */
export function UpdateBar() {
  const updated = useSyncExternalStore(subscribeSwUpdate, getSwUpdated);
  const [closed, setClosed] = useState(false);
  const [rankBusy, setRankBusy] = useState(false);
  if (!updated || closed) return null;
  const reload = () => (loadBattleRank().pendingId === null ? location.reload() : setRankBusy(true));
  return (
    <div className="update-bar" role="status">
      <span>{rankBusy ? "랭크 대전이 끝난 뒤에 새로고침해 주세요. 지금 하면 패배로 기록돼요." : "새 버전이 나왔어요."}</span>
      <button type="button" className="battle-setup-load-party tap-target" onClick={reload}>
        새로고침
      </button>
      <button type="button" className="battle-setup-load-party tap-target" onClick={() => setClosed(true)}>
        닫기
      </button>
    </div>
  );
}
