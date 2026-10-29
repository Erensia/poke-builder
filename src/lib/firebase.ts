/**
 * Firebase 연결(6.0 K2·K3). 값은 `.env.local`/Vercel의 `VITE_FIREBASE_*` — 웹 설정은 비밀이 아니고 보호는 승인된 도메인과
 * Firestore 보안 규칙이 한다. 값이 하나라도 없으면(.env.local을 아직 안 만든 PC 등) 클라우드 기능을 통째로 숨긴다.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);

/** 처음 필요할 때 한 번만 만들고, 실패하면(오프라인 등) 다음 호출에서 다시 시도하도록 비운다 */
function lazy<T>(make: () => Promise<T>) {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= make().catch((e) => {
      p = null;
      throw e;
    }));
}

// 동적 import — 로그인하지 않는 사용자의 번들에는 Firebase가 들어가지 않는다. getApps는 개발 중 HMR로 이 파일이 다시 실행돼도 앱을 두 번 만들지 않게 한다.
const loadApp = lazy(async () => {
  const { getApp, getApps, initializeApp } = await import("firebase/app");
  return getApps().length ? getApp() : initializeApp(config);
});

export const loadAuth = lazy(async () => {
  const [app, mod] = await Promise.all([loadApp(), import("firebase/auth")]);
  return { auth: mod.getAuth(app), mod };
});

export const loadFirestore = lazy(async () => {
  const [app, mod] = await Promise.all([loadApp(), import("firebase/firestore")]);
  return { db: mod.getFirestore(app), mod };
});
