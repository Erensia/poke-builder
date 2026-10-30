import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { startCloudSync } from "../lib/cloudSync";
import { firebaseConfigured, loadAuth } from "../lib/firebase";

const IGNORED = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];

function messageOf(code: string | undefined) {
  if (code === "auth/popup-blocked") return "팝업이 막혔어요. 허용한 뒤 다시 눌러 주세요.";
  if (code === "auth/unauthorized-domain") return "이 주소에서는 로그인할 수 없어요. 배포된 주소나 localhost에서 해 주세요.";
  return "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

/**
 * 로그인 상태(6.0 K2). user: undefined = 확인 중, null = 로그아웃. 로그인은 `localStorage`가 아니라 Firebase가 자체 저장소에
 * 유지해 다음에 열어도 이어진다. 로그인하지 않아도 앱의 다른 기능은 영향이 없다.
 */
export function useAuthUser() {
  const [user, setUser] = useState<User | null | undefined>(firebaseConfigured ? undefined : null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured) return;
    startCloudSync(); // 이 창에서 로그인하면 바로 동기화가 시작되게(이미 시작됐으면 아무 일도 안 한다)
    let alive = true;
    let off = () => {};
    loadAuth()
      .then(({ auth, mod }) => {
        if (alive) off = mod.onAuthStateChanged(auth, setUser);
      })
      .catch(() => {
        if (!alive) return;
        setUser(null);
        setError("로그인 기능을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.");
      });
    return () => {
      alive = false;
      off();
    };
  }, []);

  async function signIn() {
    setError("");
    try {
      const { auth, mod } = await loadAuth();
      // select_account: 구글 계정이 하나만 로그인돼 있어도 계정 선택 화면을 띄운다(여러 계정으로 두 기기 테스트·계정 전환)
      const provider = new mod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await mod.signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!code || !IGNORED.includes(code)) setError(messageOf(code));
    }
  }

  async function signOut() {
    setError("");
    try {
      const { auth, mod } = await loadAuth();
      await mod.signOut(auth);
    } catch {
      setError("로그아웃하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  return { user, error, signIn, signOut };
}
