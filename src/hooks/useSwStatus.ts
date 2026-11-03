import { useEffect, useState } from "react";
import { swDisabledReason } from "../lib/registerSw";

/** 오프라인 캐시(서비스 워커) 상태 — 푸터에 보여 준다(6.5 P1). hidden은 개발 서버·미지원 브라우저라 표시하지 않는다 */
export type SwStatus = "hidden" | "off-flag" | "off-build" | "installing" | "ready" | "failed";

/** 스프라이트 미리 받기 진행(서비스 워커가 알려 준다). 아직 소식이 없으면 null */
export type SwWarm = { done: number; total: number } | null;

export function useSwStatus(): { status: SwStatus; warm: SwWarm } {
  const reason = swDisabledReason();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [warm, setWarm] = useState<SwWarm>(null);
  useEffect(() => {
    if (reason) return;
    let alive = true;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "warm-progress") setWarm({ done: e.data.done, total: e.data.total });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    void navigator.serviceWorker.ready.then(() => alive && setReady(true));
    // 등록이 없거나 설치가 계속 실패하면 ready가 영영 오지 않는다 — 15초 뒤 실패로 알린다
    const id = setTimeout(() => alive && setFailed(true), 15000);
    return () => {
      alive = false;
      clearTimeout(id);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [reason]);
  const status: SwStatus = reason === "unsupported" || reason === "dev" ? "hidden" : reason === "flag" ? "off-flag" : reason === "build" ? "off-build" : ready ? "ready" : failed ? "failed" : "installing";
  return { status, warm };
}
