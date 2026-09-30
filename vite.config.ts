import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
})
