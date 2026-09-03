import type { ViewMode } from '@/model/grouping'

/**
 * chrome.storage.local holds view state and a task cache only. It is never the
 * sole copy of user data: task ids are not stable across a move between lists,
 * so anything authoritative lives in Google's servers.
 */

export interface ViewState {
  mode: ViewMode
  collapsed: string[]
}

const KEY = 'bettertasks:view'
const DEFAULT: ViewState = { mode: 'due', collapsed: [] }

export async function loadViewState(): Promise<ViewState> {
  try {
    const stored = await chrome.storage.local.get(KEY)
    const value = stored[KEY] as Partial<ViewState> | undefined
    return {
      mode: value?.mode === 'category' ? 'category' : DEFAULT.mode,
      collapsed: Array.isArray(value?.collapsed) ? value.collapsed : [],
    }
  } catch {
    return DEFAULT
  }
}

export async function saveViewState(state: ViewState): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: state })
  } catch {
    // View state is a convenience; losing it is not worth surfacing.
  }
}
