import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 使用相对路径，保证部署到 GitHub Pages 的项目子路径下也能正确加载资源
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
})
