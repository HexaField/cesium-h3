import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Use root base during development so the dev server serves normally,
  // and use the GitHub Pages subpath for production builds.
  base: mode === 'development' ? '/' : '/cesium-h3/',
  plugins: [react(), cesium()]
}))
