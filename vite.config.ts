import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cliBridge } from './server/cliBridge'

export default defineConfig({
  plugins: [react(), cliBridge()],
  // 실행기·안내 화면이 5173 을 가리킨다 — 이미 켜져 있을 때 5174 로 하나 더 뜨지 않게 고정한다
  server: { port: 5173, strictPort: true },
})
