import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 5173은 가계부 앱이 쓰고 있어서 이 프로젝트는 5174로 고정한다.
    port: 5174,
    strictPort: true,
  },
})
