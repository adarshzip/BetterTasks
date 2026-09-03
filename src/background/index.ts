import { AuthError, getToken, signOut } from '@/auth/token'
import {
  clearCompleted,
  createTask,
  createTaskList,
  deleteTask,
  listAllCompleted,
  listEverything,
  moveTask,
  patchTask,
  renameTaskList,
} from '@/api/tasks'
import * as calendar from '@/api/calendar'
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

/**
 * The panel is available on every tab, and stays open until dismissed.
 *
 * Scoping it to calendar.google.com with per-tab `sidePanel.setOptions` was
 * tried and reverted. Disabling a tab does close the panel, but Edge does not
 * restore it when the tab is enabled again, so leaving Calendar closed the
 * panel for good and reopening meant a trip to the toolbar. Since
 * `sidePanel.open` requires a user gesture, nothing can reopen it
 * automatically, which made auto-close a worse trade than always-available.
 */

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

    case 'loadCompleted':
      return listAllCompleted()

    case 'loadCalendar':
      return loadCalendar(message.days ?? COURSE_SCAN_DAYS)

    case 'loadBusy':
      return loadBusy(message.timeMin, message.timeMax)

    case 'scheduleTask':
      return scheduleTask(message)

    case 'unscheduleTask':
      return unscheduleTask(message.eventId)

    case 'loadBlocks':
      return loadBlocks()

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

    case 'createTaskList':
      return createTaskList(message.title)

    case 'renameTaskList':
      return renameTaskList(message.listId, message.title)

    case 'clearCompleted':
      return clearCompleted(message.listId)
  }
}

/**
 * Debug handle for the service worker console. Dynamic import() is banned in
 * service workers by spec, so there is no other way to reach these functions
 * interactively. Used by the Phase 0 spikes; see docs/SPIKES.md.
 */
Object.assign(globalThis, {
  bt: {
    getToken,
    listEverything,
    listAllCompleted,
    createTask,
    patchTask,
    deleteTask,
    moveTask,
    createTaskList,
    renameTaskList,
    clearCompleted,
    // Exposed for Spike 3, which has to run before any calendar feature is
    // built. See docs/SPIKES.md.
    calendar,
  },
})

/**
 * Four weeks, not one.
 *
 * A class that meets once a week appears exactly once in a seven-day window,
 * and would then be indistinguishable from a one-off meeting. TAC 458 was
 * dropped for precisely this reason during Spike 3.
 */
const COURSE_SCAN_DAYS = 28

async function loadCalendar(days: number) {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 7)
  const to = new Date(now)
  to.setDate(to.getDate() + days)

  const range = { timeMin: from.toISOString(), timeMax: to.toISOString() }

  // Colours and the calendar list are small and rarely change, but they are
  // fetched together so the panel gets one consistent snapshot.
  const [events, colors, calendars] = await Promise.all([
    calendar.listEvents('primary', range),
    calendar.getColors(),
    calendar.listCalendars(),
  ])

  return { events, palette: colors.event, calendars }
}

/** Work blocks live on their own calendar so they never look like commitments. */
const WORK_CALENDAR_NAME = 'BetterTasks'
const WORK_CALENDAR_KEY = 'bettertasks:workCalendarId'

/**
 * Finds or creates the BetterTasks calendar, remembering its id.
 *
 * The cached id is verified against the calendar list rather than trusted: if
 * the user deletes the calendar in Google Calendar, a stale id would make
 * every schedule attempt fail with a 404 that reads like a bug.
 */
async function ensureWorkCalendar(): Promise<string> {
  const calendars = await calendar.listCalendars()

  const stored = await chrome.storage.local.get(WORK_CALENDAR_KEY)
  const cached = stored[WORK_CALENDAR_KEY] as string | undefined
  if (cached && calendars.some((c) => c.id === cached)) return cached

  const existing = calendars.find((c) => c.summary === WORK_CALENDAR_NAME)
  if (existing) {
    await chrome.storage.local.set({ [WORK_CALENDAR_KEY]: existing.id })
    return existing.id
  }

  const created = await calendar.createCalendar(WORK_CALENDAR_NAME)
  console.info('[bettertasks] created work calendar', created)
  if (!created?.id) throw new Error('Calendar creation returned no id')

  // calendars.insert creates the calendar but does not always surface it in the
  // sidebar, so subscribe explicitly and make it selected.
  await calendar.subscribeCalendar(created.id)

  await chrome.storage.local.set({ [WORK_CALENDAR_KEY]: created.id })
  return created.id
}

/**
 * Busy intervals across every calendar the user actually looks at.
 *
 * Work blocks we created are deliberately included: two tasks should not be
 * scheduled on top of each other.
 */
async function loadBusy(timeMin: string, timeMax: string) {
  const calendars = await calendar.listCalendars()
  const ids = calendars.map((c) => c.id)
  const result = await calendar.freeBusy(ids.length ? ids : ['primary'], { timeMin, timeMax })

  return Object.values(result).flatMap((entry) => entry.busy ?? [])
}

async function scheduleTask(message: {
  taskId: string
  title: string
  start: string
  end: string
}) {
  const calendarId = await ensureWorkCalendar()
  console.info('[bettertasks] scheduling on calendar', calendarId, message)

  const event = await calendar.insertEvent(calendarId, {
    summary: message.title,
    start: { dateTime: message.start },
    end: { dateTime: message.end },
    // Lets a block be traced back to its task after the user edits it in
    // Google Calendar, where our metadata block is not visible.
    extendedProperties: { private: { btTaskId: message.taskId } },
  })

  console.info('[bettertasks] calendar returned', event)
  return event
}

/**
 * Every work block, so the panel can read block timing from the calendar
 * rather than from a copy stored on the task.
 *
 * This is what makes editing a block in Google Calendar work: move it and the
 * panel shows the new time, delete it and the task shows as unscheduled. A
 * cached time on the task would go stale the moment the user touched it.
 */
async function loadBlocks() {
  const calendarId = await ensureWorkCalendar()

  const from = new Date()
  from.setDate(from.getDate() - 7)
  const to = new Date()
  to.setDate(to.getDate() + 60)

  return calendar.listEvents(calendarId, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
  })
}

async function unscheduleTask(eventId: string) {
  const calendarId = await ensureWorkCalendar()
  // deleteEvent already treats a missing event as success.
  await calendar.deleteEvent(calendarId, eventId)
}

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
