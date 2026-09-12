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
  version: '1.0.0',
  description: 'A better Google Tasks panel for Google Calendar.',

  // Pinning the key fixes the extension id, which the OAuth client is bound to.
  ...(local.key ? { key: local.key } : {}),

  permissions: ['identity', 'storage', 'sidePanel'],
  // Narrowed to the endpoints actually called. `www.googleapis.com/*` granted
  // reach over every Google API, which is more than this needs and more than a
  // store reviewer should be asked to accept.
  host_permissions: [
    'https://tasks.googleapis.com/tasks/v1/*',
    'https://www.googleapis.com/calendar/v3/*',
    'https://www.googleapis.com/oauth2/v3/userinfo',
    'https://oauth2.googleapis.com/revoke*',
  ],

  // No `oauth2` block: that key drives chrome.identity.getAuthToken, which is
  // Chrome only. Auth goes through launchWebAuthFlow instead, so the client id
  // is injected into the bundle by vite.config.ts. See src/auth/token.ts.

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },

  // Clicking the toolbar icon opens the side panel; see the service worker.
  action: {
    default_title: 'BetterTasks',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },

  side_panel: { default_path: 'src/sidepanel/index.html' },

  /**
   * A keyboard shortcut for the panel.
   *
   * `_execute_action` invokes the toolbar action, and the action is configured
   * to open the side panel (`setPanelBehavior` in the service worker), so this
   * gets the panel without any code. It also satisfies the user-gesture rule
   * that makes opening a side panel programmatically impossible otherwise.
   *
   * The binding is a suggestion. Users can change or clear it at
   * chrome://extensions/shortcuts, so the panel reads the live binding rather
   * than printing this key.
   */
  commands: {
    _execute_action: {
      suggested_key: {
        default: 'Ctrl+Shift+Z',
        mac: 'Command+Shift+Z',
      },
      description: 'Open or close the BetterTasks panel',
    },
  },
})
