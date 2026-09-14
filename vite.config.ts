import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cliBridge } from './server/cliBridge'

export default defineConfig({
  plugins: [react(), cliBridge()],
})
