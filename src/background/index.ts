import { AuthError, getToken, signOut } from '@/auth/token'
import {
  createTask,
  deleteTask,
  listEverything,
  moveTask,
  patchTask,
} from '@/api/tasks'
import type { Request, Response } from './messages'

/**
 * Service worker. Owns OAuth and every network call, because chrome.identity
 * is unavailable in content scripts and host permissions are cleaner to hold
 * in one place.
 */

// Clicking the toolbar icon opens the side panel. Registered once on install
// rather than per click, which is what the API expects.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[bettertasks] side panel setup failed', error))
})

chrome.runtime.onMessage.addListener(
  (message: Request, _sender, sendResponse: (r: Response<unknown>) => void) => {
    handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse(toErrorResponse(error)))

    // Keeps the message channel open for the async handler above.
    return true
  },
)

async function handle(message: Request): Promise<unknown> {
  switch (message.type) {
    case 'signIn':
      await getToken(true)
      return { signedIn: true }

    case 'signOut':
      await signOut()
      return undefined

    case 'loadAll':
      return listEverything()

    case 'createTask':
      return createTask(message.listId, message.task, message.parent)

    case 'patchTask':
      return patchTask(message.listId, message.taskId, message.patch)

    case 'deleteTask':
      return deleteTask(message.listId, message.taskId)

    case 'moveTask':
      return moveTask(message.listId, message.taskId, {
        parent: message.parent,
        previous: message.previous,
      })
  }
}

/**
 * Debug handle for the service worker console. Dynamic import() is banned in
 * service workers by spec, so there is no other way to reach these functions
 * interactively. Used by the Phase 0 spikes; see SPIKES.md.
 */
Object.assign(globalThis, {
  bt: { getToken, listEverything, createTask, patchTask, deleteTask, moveTask },
})

function toErrorResponse(error: unknown): Response<never> {
  if (error instanceof AuthError) {
    return { ok: false, error: error.message, needsAuth: true }
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    needsAuth: false,
  }
}
