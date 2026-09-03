import type { GTask, GTaskList, WireTask } from '@/model/types'

/** The content script cannot reach chrome.identity, so it asks the worker. */
export type Request =
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'loadAll' }
  | { type: 'createTask'; listId: string; task: Partial<GTask>; parent?: string }
  | { type: 'patchTask'; listId: string; taskId: string; patch: Partial<GTask> }
  | { type: 'deleteTask'; listId: string; taskId: string }
  | { type: 'moveTask'; listId: string; taskId: string; parent?: string; previous?: string }
  | { type: 'createTaskList'; title: string }
  | { type: 'renameTaskList'; listId: string; title: string }
  | { type: 'clearCompleted'; listId: string }

export interface Snapshot {
  lists: GTaskList[]
  /** Raw API shape, not `Task`: this crosses a JSON boundary. */
  tasks: WireTask[]
}

/**
 * Errors cross the message boundary as data, not exceptions. `needsAuth`
 * distinguishes "click sign in" from "something broke", which the panel
 * renders very differently.
 */
export type Response<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; needsAuth: boolean }

export type ResponseFor<R extends Request> = R extends { type: 'loadAll' }
  ? Response<Snapshot>
  : R extends { type: 'signIn' }
    ? Response<{ signedIn: true }>
    : R extends { type: 'createTask' | 'patchTask' | 'moveTask' }
      ? Response<GTask>
      : Response<void>
