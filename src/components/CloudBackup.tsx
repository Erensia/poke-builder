import { firebaseConfigured } from "../lib/firebase";
import { useAuthUser } from "../hooks/useAuthUser";

/**
 * 클라우드 백업의 로그인 구역(6.0 K2) — "백업" 모달 안. 로그인은 선택이라 안 해도 저장한 파티·포켓몬은 지금처럼
 * 이 브라우저에 저장된다. Firebase 설정이 없으면 구역 자체를 그리지 않는다.
 */
export function CloudBackup() {
  const { user, error, signIn, signOut } = useAuthUser();
  if (!firebaseConfigured) return null;

  return (
    <section className="backup-cloud" aria-label="클라우드 백업">
      <h3 className="backup-cloud-title">클라우드 백업</h3>
      {user ? (
        <>
          <p className="backup-hint">{user.email ?? "Google 계정"}으로 로그인했어요.</p>
          <div className="backup-actions tap-targets">
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
