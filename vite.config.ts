import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest, { oauthClientId } from './manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  define: {
    __OAUTH_CLIENT_ID__: JSON.stringify(oauthClientId),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
