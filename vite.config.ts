import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const appBuildSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_BUILD_SHA__: JSON.stringify(appBuildSha),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    strictPort: false,
    open: false,
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Pama Business Suite',
        short_name: 'Pama Suite',
        description: 'Billing, Box Costing & Banking — one app',
        theme_color: '#0f2444',
        background_color: '#0f2444',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        categories: ['business', 'finance', 'productivity'],
        lang: 'hi',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /\.[a-z0-9]+$/i],
        // Do not precache index.html — always fetch fresh shell from network first.
        globPatterns: ['**/*.{js,css,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-pages',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
