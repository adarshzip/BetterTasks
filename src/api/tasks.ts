import { apiFetch } from './http'
import type { GTask, GTaskList, WireTask } from '@/model/types'

const BASE = 'https://tasks.googleapis.com/tasks/v1'

interface Page<T> {
  items?: T[]
  nextPageToken?: string
}

/** Task lists are the category axis: one list per class. */
export async function listTaskLists(): Promise<GTaskList[]> {
  return collect<GTaskList>(`${BASE}/users/@me/lists`, { maxResults: 100 })
}

/**
 * Fetches the open tasks in a list.
 *
 * Completed tasks are deliberately excluded. A list with several hundred of
 * them costs eight or more paged round trips, and that cost was being paid on
 * every background refresh after every single task creation. They load on
 * demand instead, when the Completed section is opened.
 */
export async function listTasks(listId: string): Promise<WireTask[]> {
  const raw = await collect<GTask>(`${BASE}/lists/${encodeURIComponent(listId)}/tasks`, {
    maxResults: 100,
    showCompleted: false,
  })
  return raw.filter((t) => !t.deleted).map((t) => ({ ...t, listId }))
}

/** How far back to fetch completed tasks on a normal load. */
const RECENT_COMPLETION_DAYS = 7

/**
 * Recently completed tasks for one list.
 *
 * A completed task stays visible in the list until its due date passes, so
 * that finishing something early leaves visible evidence rather than vanishing
 * into a history screen. That needs recent completions on every load, but not
 * the whole archive: `completedMin` bounds it to a page or two.
 */
export async function listRecentlyCompleted(listId: string): Promise<WireTask[]> {
  const since = new Date()
  since.setDate(since.getDate() - RECENT_COMPLETION_DAYS)

  const raw = await collect<GTask>(`${BASE}/lists/${encodeURIComponent(listId)}/tasks`, {
    maxResults: 100,
    showCompleted: true,
    showHidden: true,
    completedMin: since.toISOString(),
  })
  return raw
    .filter((t) => !t.deleted && t.status === 'completed')
    .map((t) => ({ ...t, listId }))
}

/** Completed tasks for one list. `showHidden` is required to see them at all. */
export async function listCompletedTasks(listId: string): Promise<WireTask[]> {
  const raw = await collect<GTask>(`${BASE}/lists/${encodeURIComponent(listId)}/tasks`, {
    maxResults: 100,
    showCompleted: true,
    showHidden: true,
  })
  return raw
    .filter((t) => !t.deleted && t.status === 'completed')
    .map((t) => ({ ...t, listId }))
}

/** Completed tasks across every list, fetched only when asked for. */
export async function listAllCompleted(): Promise<WireTask[]> {
  const lists = await listTaskLists()
  const perList = await Promise.all(lists.map((list) => listCompletedTasks(list.id)))
  return perList.flat()
}

/**
 * Fetches all lists and their tasks together. Requests run concurrently: the
 * Tasks API is slow enough per call that serializing four classes is visible.
 */
export async function listEverything(): Promise<{ lists: GTaskList[]; tasks: WireTask[] }> {
  const lists = await listTaskLists()
  const perList = await Promise.all(
    lists.map(async (list) => [
      ...(await listTasks(list.id)),
      ...(await listRecentlyCompleted(list.id)),
    ]),
  )
  return { lists, tasks: perList.flat() }
}

export async function createTaskList(title: string): Promise<GTaskList> {
  return apiFetch<GTaskList>(`${BASE}/users/@me/lists`, { method: 'POST', body: { title } })
}

export async function renameTaskList(listId: string, title: string): Promise<GTaskList> {
  return apiFetch<GTaskList>(`${BASE}/users/@me/lists/${encodeURIComponent(listId)}`, {
    method: 'PATCH',
    body: { title },
  })
}

/**
 * Google's "delete all completed tasks". The API has no bulk endpoint for it,
 * so this is a clear followed by a reload: `clear` hides completed tasks from
 * the default view rather than deleting them, which matches what Google's own
 * menu item actually does.
 */
export async function clearCompleted(listId: string): Promise<void> {
  await apiFetch<void>(`${BASE}/lists/${encodeURIComponent(listId)}/clear`, { method: 'POST' })
}

export async function createTask(listId: string, task: Partial<GTask>, parent?: string): Promise<GTask> {
  return apiFetch<GTask>(`${BASE}/lists/${encodeURIComponent(listId)}/tasks`, {
    method: 'POST',
    body: task,
    query: { parent },
  })
}

export async function patchTask(listId: string, taskId: string, patch: Partial<GTask>): Promise<GTask> {
  return apiFetch<GTask>(
    `${BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body: patch },
  )
}

export async function deleteTask(listId: string, taskId: string): Promise<void> {
  await apiFetch<void>(
    `${BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
}

/**
 * Reparents or reorders. `parent` omitted moves the task to the top level;
 * `previous` omitted moves it to the front of its siblings.
 */
export async function moveTask(
  listId: string,
  taskId: string,
  target: { parent?: string | undefined; previous?: string | undefined },
): Promise<GTask> {
  return apiFetch<GTask>(
    `${BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move`,
    { method: 'POST', query: target },
  )
}

/** Walks nextPageToken to completion. */
async function collect<T>(
  url: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const out: T[] = []
  let pageToken: string | undefined

  do {
    const page = await apiFetch<Page<T>>(url, { query: { ...query, pageToken } })
    out.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)

  return out
}
