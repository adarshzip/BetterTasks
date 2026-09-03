import type { GTask, GTaskList, WireTask } from '@/model/types'
import type { WireCalendar, WireEvent } from '@/api/calendar'

/** The content script cannot reach chrome.identity, so it asks the worker. */
export type Request =
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'loadAll' }
  | { type: 'loadCompleted' }
  | { type: 'loadCalendar'; days?: number }
  | { type: 'loadBusy'; timeMin: string; timeMax: string }
  | {
      type: 'scheduleTask'
      taskId: string
      title: string
      start: string
      end: string
    }
  | { type: 'unscheduleTask'; eventId: string }
  | { type: 'loadBlocks' }
  | { type: 'createTask'; listId: string; task: Partial<GTask>; parent?: string }
  | { type: 'patchTask'; listId: string; taskId: string; patch: Partial<GTask> }
  | { type: 'deleteTask'; listId: string; taskId: string }
  | { type: 'moveTask'; listId: string; taskId: string; parent?: string; previous?: string }
  | { type: 'createTaskList'; title: string }
  | { type: 'renameTaskList'; listId: string; title: string }
  | { type: 'clearCompleted'; listId: string }

/**
 * Calendar context: the events used to derive courses and colours, the colour
 * palette, and the calendar list. All raw API JSON, because this crosses the
 * worker's JSON boundary.
 */
export interface CalendarSnapshot {
  events: WireEvent[]
  palette: Record<string, { background: string }>
  calendars: WireCalendar[]
}

/** A busy interval as raw ISO strings, because this crosses the JSON boundary. */
export interface WireInterval {
  start: string
  end: string
}

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
