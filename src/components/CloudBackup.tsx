import { useSyncExternalStore } from "react";
import { getSyncStatus, resolveConflicts, subscribeSyncStatus, syncNow } from "../lib/cloudSync";
import { firebaseConfigured } from "../lib/firebase";
import { useAuthUser } from "../hooks/useAuthUser";

const formatTime = (t: number) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * 클라우드 백업(6.0 K2·K3) — "백업" 모달 안. 로그인은 선택이라 안 해도 저장한 파티·포켓몬은 지금처럼 이 브라우저에 저장된다.
 * 로그인하면 두 목록이 자동으로 클라우드에 올라가고 다른 기기의 변경을 받아 온다. 양쪽이 다 바뀐 경우에만 여기서 고르게 한다.
 * Firebase 설정이 없으면 구역 자체를 그리지 않는다.
 */
export function CloudBackup() {
  const { user, error: authError, signIn, signOut } = useAuthUser();
  const sync = useSyncExternalStore(subscribeSyncStatus, getSyncStatus); // 동기화는 앱 전체에서 돌고, 이 구역은 상태를 보여 주기만 한다
  if (!firebaseConfigured) return null;
  const error = authError || sync.error;

  return (
    <section className="backup-cloud" aria-label="클라우드 백업">
      <h3 className="backup-cloud-title">클라우드 백업</h3>
      {user ? (
        <>
          <p className="backup-hint">
            {user.email ?? "Google 계정"}으로 로그인했어요. 저장한 파티와 포켓몬이 자동으로 클라우드에 백업되고, 같은 계정으로 로그인한 다른 기기와 맞춰져요.
          </p>
          {sync.conflicts.length > 0 ? (
            <div className="backup-confirm" role="group" aria-label="클라우드와 내용이 달라요">
              <p>
                이 기기와 클라우드의 내용이 서로 달라요.
                {sync.conflicts.map((c) => (
                  <span key={c.name} className="backup-conflict-line">
                    {c.label}: 이 기기 {c.local}개 · 클라우드 {c.remote}개 (클라우드 저장 {formatTime(c.remoteUpdatedAt)})
                  </span>
                ))}
                고르지 않은 쪽의 내용은 사라져요.
              </p>
              <div className="backup-actions tap-targets">
                <button type="button" className="is-danger" disabled={sync.syncing} onClick={() => resolveConflicts("cloud")}>
                  클라우드 내용으로 바꾸기
                </button>
                <button type="button" className="is-danger" disabled={sync.syncing} onClick={() => resolveConflicts("local")}>
                  이 기기 내용으로 올리기
                </button>
                <button type="button" autoFocus onClick={() => resolveConflicts("later")}>
                  나중에
                </button>
              </div>
            </div>
          ) : (
            <p className="backup-notice" role="status">
              {sync.syncing
                ? "동기화하는 중…"
                : sync.notice || (sync.lastSyncedAt ? `마지막 동기화 ${formatTime(sync.lastSyncedAt)}` : "아직 동기화하지 않았어요.")}
            </p>
          )}
          <div className="backup-actions tap-targets">
            <button type="button" onClick={syncNow} disabled={sync.syncing}>
              지금 동기화
            </button>
            <button type="button" onClick={signOut}>
              로그아웃
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="backup-hint">Google 계정으로 로그인할 수 있어요. 로그인하지 않아도 지금처럼 이 브라우저에 저장돼요.</p>
          <div className="backup-actions tap-targets">
            <button type="button" onClick={signIn} disabled={user === undefined}>
              Google로 로그인
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="backup-notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
