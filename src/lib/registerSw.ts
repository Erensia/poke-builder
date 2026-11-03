/**
 * 서비스 워커 등록(6.5 P1) — 설계: docs/00_기획문서/02_backlog/06_ver.6.0/6.5-P1-PWA-설계.md
 * - 빌드 결과(PROD)에서만 등록한다. 개발 서버(HMR)에서는 등록하지 않고, 남아 있는 등록이 있으면 해제한다.
 * - 끄는 방법: ① 빌드 환경변수 VITE_PWA=off(재배포하면 자기 파괴 서비스 워커가 나간다) ② 주소에 ?sw=off(이 기기에서 끄고 해제, ?sw=on으로 다시 켠다)
 */
const FLAG = "sw-off";

const flag = {
  get: () => {
    try {
      return localStorage.getItem(FLAG) === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(FLAG, "1");
      else localStorage.removeItem(FLAG);
    } catch {
      /* 저장소를 못 쓰면 이번 방문에만 적용된다 */
    }
  },
};

/** 서비스 워커를 쓰지 않는 이유(쓰는 중이면 null). 푸터가 이 값으로 상태를 보여 준다 — flag는 ?sw=off로 이 기기에서 꺼 둔 경우 */
export function swDisabledReason(): "unsupported" | "dev" | "build" | "flag" | null {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!import.meta.env.PROD) return "dev";
  if (import.meta.env.VITE_PWA === "off") return "build";
  return flag.get() ? "flag" : null;
}

/** 등록을 모두 해제하고 캐시를 비운다(등록이 이미 없어도 남은 캐시는 지운다). 이 페이지를 서비스 워커가 맡고 있었으면 한 번 새로고침해 서비스 워커 없는 상태로 다시 연다 */
async function unregisterAll() {
  const regs = await navigator.serviceWorker.getRegistrations();
  const controlled = !!navigator.serviceWorker.controller;
  await Promise.all(regs.map((r) => r.unregister()));
  // 우리가 만든 캐시만 지운다(precache-*·sprites-v1·fonts-v1)
  await Promise.all((await caches.keys()).filter((k) => /^(precache-|sprites-v1$|fonts-v1$)/.test(k)).map((k) => caches.delete(k)));
  if (controlled) location.reload();
}

export function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  const params = new URLSearchParams(location.search);
  const sw = params.get("sw");
  if (sw === "off" || sw === "on") {
    flag.set(sw === "off");
    params.delete("sw");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  if (swDisabledReason()) {
    void unregisterAll();
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // 오프라인에서도 이미지가 보이도록 스프라이트를 백그라운드로 미리 받게 한다(온라인이고 한가할 때)
        if (!navigator.onLine) return;
        const ask = () => reg.active?.postMessage({ type: "warm-sprites" });
        if ("requestIdleCallback" in window) requestIdleCallback(ask);
        else setTimeout(ask, 2000);
      })
      .catch(() => {
        /* 등록에 실패해도 앱은 서비스 워커 없이 그대로 동작한다 */
      });
  });
}
