import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

const root = path.dirname(fileURLToPath(import.meta.url))

// 6.5 P1 — 서비스 워커(dist/sw.js)를 빌드 때 만든다. 설계: docs/00_기획문서/02_backlog/06_ver.6.0/6.5-P1-PWA-설계.md
// 프리캐시 목록 = 번들 파일(해시 포함, index.html은 '/') + public의 아이콘·매니페스트·랭크 이미지. 스프라이트(public/sprites)는 설치를 지연시키지 않도록 프리캐시에서 빼고,
// 목록만 서비스 워커에 넘겨 설치 뒤 백그라운드로 미리 받는다(페이지가 idle일 때 메시지로 시작).
// off이면(VITE_PWA=off) 목록 대신 "캐시를 지우고 스스로 해제하는" 자기 파괴 서비스 워커를 내서, 재배포 한 번으로 모든 사용자에게서 제거한다.
function swPlugin(off: boolean): Plugin {
  const publicFiles = (dir = '', skipSprites = true): string[] =>
    fs.readdirSync(path.join(root, 'public', dir), { withFileTypes: true }).flatMap((d) => {
      const rel = path.posix.join(dir, d.name)
      if (d.isDirectory()) return skipSprites && rel === 'sprites' ? [] : publicFiles(rel, skipSprites)
      return [rel]
    })
  return {
    name: 'poke-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map')), ...publicFiles()]
      const precache = ['/', ...files.map((f) => encodeURI('/' + f))]
      const sprites = publicFiles('sprites', false).map((f) => encodeURI('/' + f))
      const hash = createHash('sha1').update(files.sort().join('|')).digest('hex').slice(0, 8)
      const buildId = `${Date.now().toString(36)}-${hash}`
      // off: 캐시를 지우고 스스로 해제한 뒤 열린 탭을 새로고침하는 자기 파괴 서비스 워커
      const kill = [
        "self.addEventListener('install', () => self.skipWaiting());",
        "self.addEventListener('activate', (e) => e.waitUntil((async () => {",
        "  await Promise.all((await caches.keys()).map((k) => caches.delete(k)));",
        "  await self.registration.unregister();",
        "  (await self.clients.matchAll({ type: 'window' })).forEach((c) => c.navigate(c.url));",
        "})()));",
      ].join('\n')
      const source = off
        ? kill
        : fs.readFileSync(path.join(root, 'scripts/sw.template.js'), 'utf8')
            .replace('__BUILD_ID__', JSON.stringify(buildId))
            .replace('__PRECACHE__', JSON.stringify(precache))
            .replace('__SPRITE_LIST__', JSON.stringify(sprites))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), swPlugin(loadEnv(mode, root, 'VITE_').VITE_PWA === 'off')],
  resolve: {
    // ver.1.5 §8: src/lib/battle/ 등 하위 폴더가 생기면서 "../../" 체인을 막기 위해 도입.
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src'),
    },
  },
  // ver.2.0 2-B: 배틀 AI(탐색 오라클)를 Web Worker에서 돌린다 — 앱과 같은 별칭(@/)·코드 분할을 쓰도록 ES 모듈 워커로
  worker: {
    format: 'es',
  },
  server: {
    // 5173은 가계부 앱이 쓰고 있어서 이 프로젝트는 5174로 고정한다.
    port: 5174,
    strictPort: true,
  },
}))
