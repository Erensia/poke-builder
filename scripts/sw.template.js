/* 서비스 워커 템플릿(6.5 P1) — 빌드 때 vite.config.ts의 swPlugin이 아래 두 상수의 자리표시자를 빌드 ID·프리캐시 목록으로 바꿔 dist/sw.js로 낸다(자리표시자 문구는 이 주석에 쓰지 않는다 — 첫 번째 일치를 치환한다).
   설계: docs/00_기획문서/02_backlog/06_ver.6.0/05_ver.6.5/6.5-P1-PWA-설계.md. 이 파일은 src 밖이라 tsc·린트 대상이 아니다. */
const BUILD_ID = __BUILD_ID__;
const PRECACHE = __PRECACHE__; // ["/", "/assets/index-xxxx.js", ...] — 인코딩된 경로
const SPRITE_LIST = __SPRITE_LIST__; // /sprites/** 전체 — 설치 뒤 백그라운드로 미리 받는다(오프라인 도감·파티 이미지)
const PRE = `precache-${BUILD_ID}`;
const SPRITES = "sprites-v1";
const FONTS = "fonts-v1";
// 서버가 Vary: Origin을 붙이면(vite preview 등) 설치 때 받아 둔 응답(Origin 없음)과 crossorigin 스크립트·CSS 요청(Origin 있음)이 서로 다른 요청으로 취급돼
// 캐시를 못 찾고 오프라인에서 앱이 그려지지 않는다 — 항상 Vary를 무시하고 찾는다
const MATCH = { ignoreVary: true };

// 설치: 프리캐시를 전부 받는다. 하나라도 실패하면 설치가 실패해 기존 서비스 워커가 그대로 남는다
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(PRE)
      .then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

// 활성화: 프리캐시는 "현재 + 직전" 2세대만 남긴다(열려 있던 옛 탭이 뒤늦게 요청하는 옛 해시 청크를 직전 세대가 받아 준다)
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const gens = (await caches.keys()).filter((k) => k.startsWith("precache-")).sort().reverse();
      await Promise.all(gens.slice(2).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// 페이지가 한가할 때 보내는 요청 — 스프라이트를 12개씩 받아 쌓고, 진행을 열린 탭에 알린다(이미 받은 것은 건너뛰므로 다시 보내도 싸다)
let warming = null;
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "warm-sprites") e.waitUntil((warming ||= warmSprites().finally(() => (warming = null))));
});

async function notifyWarm(done) {
  const all = await self.clients.matchAll();
  all.forEach((c) => c.postMessage({ type: "warm-progress", done, total: SPRITE_LIST.length }));
}

async function warmSprites() {
  const cache = await caches.open(SPRITES);
  const todo = [];
  for (const p of SPRITE_LIST) if (!(await cache.match(p))) todo.push(p);
  let done = SPRITE_LIST.length - todo.length;
  await notifyWarm(done);
  for (let i = 0; i < todo.length; i += 12) {
    await Promise.all(
      todo.slice(i, i + 12).map(async (p) => {
        try {
          const res = await fetch(p);
          if (res.ok) await cache.put(p, res);
        } catch {
          /* 실패한 것은 쓸 때 다시 받는다(런타임 캐시) */
        }
      }),
    );
    done = Math.min(SPRITE_LIST.length, done + 12);
    await notifyWarm(done);
  }
  await notifyWarm(SPRITE_LIST.length);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return; // 가로채지 않는다
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/__/")) return; // Firebase 인증 헬퍼(같은 도메인으로 쓸 때)
    if (req.mode === "navigate") return e.respondWith(shell(req));
    if (url.pathname.startsWith("/sprites/")) return e.respondWith(swr(SPRITES, req, e));
    // 해시 자산은 모든 세대의 캐시에서 찾고, 없으면 네트워크 — 프리캐시 목록에 없는 옛 해시 요청도 직전 세대가 받는다
    if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) return e.respondWith(cacheFirst(req));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(swr(FONTS, req, e));
  // 그 밖의 외부 요청(Firebase·Google API 등)은 가로채지 않는다
});

// HTML: 네트워크 우선(3초 안에 못 받으면 캐시). 온라인이면 항상 최신 HTML → 최신 해시 자산
async function shell(req) {
  try {
    const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(reject, 3000))]);
    if (res.ok) caches.open(PRE).then((c) => c.put("/", res.clone()));
    return res;
  } catch {
    return (await caches.match("/", MATCH)) || fetch(req);
  }
}

async function cacheFirst(req) {
  return (await caches.match(req, MATCH)) || fetch(req);
}

// 캐시가 있으면 바로 주고, 뒤에서 새로 받아 갱신한다(스프라이트·폰트: 파일명이 고정이라 바뀌어도 갱신돼야 한다)
async function swr(name, req, e) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, MATCH);
  const net = fetch(req)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  e.waitUntil(net);
  return hit || (await net) || Response.error();
}
