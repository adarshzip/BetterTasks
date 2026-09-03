import { defineManifest } from '@crxjs/vite-plugin'
import { existsSync, readFileSync } from 'node:fs'

// Extension key and OAuth client id are per-installation and live outside git.
// Copy extension.local.example.json to extension.local.json and fill it in.
// See docs/SETUP.md for how to generate both.
type LocalConfig = { key?: string; oauthClientId?: string }
const local: LocalConfig = existsSync('extension.local.json')
  ? (JSON.parse(readFileSync('extension.local.json', 'utf8')) as LocalConfig)
  : {}

export const oauthClientId = local.oauthClientId ?? ''

if (!local.oauthClientId) {
  console.warn(
    '[bettertasks] extension.local.json missing or incomplete. ' +
      'The build will succeed but sign-in will fail. See docs/SETUP.md.',
  )
}

export default defineManifest({
  manifest_version: 3,
  name: 'BetterTasks',
  version: '0.1.0',
  description: 'A better Google Tasks panel for Google Calendar.',

  // Pinning the key fixes the extension id, which the OAuth client is bound to.
  ...(local.key ? { key: local.key } : {}),

  permissions: ['identity', 'storage', 'sidePanel'],
  host_permissions: [
    'https://tasks.googleapis.com/*',
    'https://www.googleapis.com/*',
  ],

  // No `oauth2` block: that key drives chrome.identity.getAuthToken, which is
  // Chrome only. Auth goes through launchWebAuthFlow instead, so the client id
  // is injected into the bundle by vite.config.ts. See src/auth/token.ts.

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  // Clicking the toolbar icon opens the side panel; see the service worker.
  action: { default_title: 'BetterTasks' },

  side_panel: { default_path: 'src/sidepanel/index.html' },
})
