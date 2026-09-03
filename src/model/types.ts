/** The subset of the Google Tasks API Task resource we rely on. */
export interface GTask {
  id: string
  title?: string
  notes?: string
  /** RFC3339. The API may truncate the time component; see SPIKES.md. */
  due?: string
  status?: 'needsAction' | 'completed'
  completed?: string
  parent?: string
  position?: string
  updated?: string
  etag?: string
  deleted?: boolean
  hidden?: boolean
}

/**
 * A task as it crosses the service worker boundary.
 *
 * chrome.runtime.sendMessage serializes with JSON, which turns Date into a
 * string. So only plain API data travels; the panel converts it into `Task`
 * (with real Dates) on arrival. Sending `Task` directly is the bug this type
 * exists to prevent.
 */
export type WireTask = GTask & { listId: string }

export interface GTaskList {
  id: string
  title?: string
  updated?: string
}

/** Metadata the Tasks API has no field for. Serialized into the end of `notes`. */
export interface TaskMeta {
  /** Category override. Normally derived from the task list instead. */
  cat?: string
  /** Estimated effort in minutes. */
  eff?: number
  /** Priority, 1 = highest. */
  pri?: number
  /** "Show from" date, YYYY-MM-DD. Hides the task until then. */
  defer?: string
  /** Recurrence interval, e.g. "1w", "2w", "1d". Regenerated on completion. */
  rec?: string
  /** Time of day the task is due, HH:MM, if the API truncated it off `due`. */
  time?: string
}

/** A task plus its decoded metadata and the list it came from. */
export interface Task {
  raw: GTask
  listId: string
  title: string
  notes: string
  meta: TaskMeta
  due: Date | null
  completed: boolean
  parent: string | null
  position: string
}

export interface TaskNode extends Task {
  children: TaskNode[]
  depth: number
}
