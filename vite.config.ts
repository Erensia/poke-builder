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
  server: {
    // 5173은 가계부 앱이 쓰고 있어서 이 프로젝트는 5174로 고정한다.
    port: 5174,
    strictPort: true,
  },
})
