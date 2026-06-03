import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Unit tests run in a plain Node environment against pure functions.
// Tests live in tests/ (outside src) so vue-tsc's app build never includes them.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
})
