import type { Auth } from "firebase/auth";

/**
 * Firebase 연결(6.0 K2). 값은 `.env.local`/Vercel의 `VITE_FIREBASE_*` — 웹 설정은 비밀이 아니고 보호는 승인된 도메인과
 * Firestore 보안 규칙이 한다. 값이 하나라도 없으면(.env.local을 아직 안 만든 PC 등) 클라우드 기능을 통째로 숨긴다.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);

type AuthModule = typeof import("firebase/auth");
let authReady: Promise<{ auth: Auth; mod: AuthModule }> | null = null;

/**
 * 로그인 모듈을 처음 필요할 때 내려받는다(동적 import) — 로그인하지 않는 사용자의 번들에는 Firebase가 들어가지 않는다.
 * 내려받기에 실패하면(오프라인 등) 다음 호출에서 다시 시도하도록 비워 둔다.
 */
export function loadAuth() {
  authReady ??= Promise.all([import("firebase/app"), import("firebase/auth")])
    .then(([{ initializeApp }, mod]) => ({ auth: mod.getAuth(initializeApp(config)), mod }))
    .catch((e) => {
      authReady = null;
      throw e;
    });
  return authReady;
}
