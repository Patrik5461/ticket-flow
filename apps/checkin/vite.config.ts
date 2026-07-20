import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plain SPA build → dist/, which Capacitor packages into the native app.
// Target older mobile WebViews (iOS 14+ / modern Android WebView) so syntax is
// down-levelled the same way the main web app does it.
export default defineConfig({
  plugins: [react()],
  build: {
    target: ['safari14', 'chrome87'],
    outDir: 'dist',
  },
  server: {
    port: 5183,
  },
})
