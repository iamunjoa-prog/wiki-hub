import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cliBridge } from './server/cliBridge'

export default defineConfig({
  plugins: [react(), cliBridge()],
  // 배포 허브의 [로컬 허브 열기/실행]이 이 주소를 가리키므로 포트를 고정한다
  server: { port: 5173, strictPort: true },
})
