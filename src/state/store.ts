import type { ViewMode } from '@/model/grouping'

/**
 * chrome.storage.local holds view state and a task cache only. It is never the
 * sole copy of user data: task ids are not stable across a move between lists,
 * so anything authoritative lives in Google's servers.
 */

export interface ViewState {
  mode: ViewMode
  collapsed: string[]
  /** The order classes appear in, for those the user has moved. */
  categoryOrder: string[]
}

const KEY = 'bettertasks:view'
const DEFAULT: ViewState = { mode: 'due', collapsed: [], categoryOrder: [] }

export async function loadViewState(): Promise<ViewState> {
  try {
    const stored = await chrome.storage.local.get(KEY)
    const value = stored[KEY] as Partial<ViewState> | undefined
    return {
      mode: value?.mode === 'category' || value?.mode === 'today' ? value.mode : DEFAULT.mode,
      collapsed: Array.isArray(value?.collapsed) ? value.collapsed : [],
      categoryOrder: Array.isArray(value?.categoryOrder) ? value.categoryOrder : [],
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
