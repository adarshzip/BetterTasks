import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarSnapshot, WireInterval } from '@/background/messages'
import type { WireEvent } from '@/api/calendar'
import { send } from '@/lib/messaging'
import { colourForCategory, currentCourse, extractCourses, type Course } from '@/model/courses'
import { colorFor } from '@/model/grouping'
import type { Interval } from '@/model/schedule'

export interface Block {
  eventId: string
  start: Date
  end: Date
}

/**
 * Calendar context for the panel: which courses exist, what colour each one is
 * on the grid, and which class is running right now.
 *
 * Kept separate from useTasks because it fails independently. A calendar that
 * cannot be read should cost you class colours, not your task list, so every
 * failure here degrades to the deterministic palette rather than surfacing an
 * error.
 */

const OVERRIDE_KEY = 'bettertasks:colours'

export interface CalendarApi {
  events: WireEvent[]
  courses: Course[]
  /** Resolves a category to a colour, falling back to the hashed palette. */
  colourOf: (category: string) => string
  /** The class running now or starting shortly, for defaulting a new task. */
  currentClass: string | null
  ready: boolean
  /** Busy intervals for the scheduling horizon, as real Dates. */
  busy: Interval[]
  /** Work blocks by task id, read from the calendar rather than the task. */
  blocks: Map<string, Block>
  /** Surfaced for actions the user took deliberately; empty when fine. */
  error: string
  dismissError: () => void
  reload: () => Promise<void>
  /** Creates a work block and returns its event id, or null on failure. */
  schedule: (taskId: string, title: string, slot: Interval) => Promise<string | null>
  unschedule: (eventId: string) => Promise<void>
  setOverride: (category: string, colour: string | null) => void
}

export function useCalendar(): CalendarApi {
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Interval[]>([])
  const [error, setError] = useState('')
  const [blocks, setBlocks] = useState<Map<string, Block>>(new Map())

  const load = useCallback(async () => {
    try {
      const data = await send<CalendarSnapshot>({ type: 'loadCalendar' })
      // Defensive, as elsewhere: a malformed response must not break the panel.
      if (data && Array.isArray(data.events)) setSnapshot(data)
    } catch {
      // Colours are a nicety. Losing them is not worth an error banner.
    }
  }, [])

  /**
   * Busy time over the scheduling horizon. Fetched separately from the course
   * scan because it covers a different range and changes far more often.
   */
  const loadBusy = useCallback(async () => {
    const now = new Date()
    const until = new Date(now)
    until.setDate(until.getDate() + 21)

    try {
      const intervals = await send<WireInterval[]>({
        type: 'loadBusy',
        timeMin: now.toISOString(),
        timeMax: until.toISOString(),
      })
      if (!Array.isArray(intervals)) return

      // Dates are rebuilt here, on this side of the JSON boundary.
      setBusy(
        intervals
          .map((i) => ({ start: new Date(i.start), end: new Date(i.end) }))
          .filter((i) => !Number.isNaN(i.start.getTime()) && !Number.isNaN(i.end.getTime())),
      )
    } catch {
      // Without busy data the slot finder proposes the whole working day, which
      // is worse advice but not wrong enough to block scheduling entirely.
    }
  }, [])

  /**
   * Scheduling is something the user asked for, so a failure must be visible.
   * Swallowing it made a broken schedule look identical to a no-op, which is
   * the worst of both outcomes.
   */
  /**
   * Reads work blocks off the calendar and indexes them by the task id stored
   * in each event's extended properties.
   */
  const loadBlocks = useCallback(async () => {
    try {
      const events = await send<WireEvent[]>({ type: 'loadBlocks' })
      if (!Array.isArray(events)) return

      const next = new Map<string, Block>()
      for (const event of events) {
        const taskId = event.extendedProperties?.private?.btTaskId
        const start = event.start?.dateTime ? new Date(event.start.dateTime) : null
        const end = event.end?.dateTime ? new Date(event.end.dateTime) : null
        if (!taskId || !start || !end) continue
        if (Number.isNaN(start.getTime())) continue

        next.set(taskId, { eventId: event.id, start, end })
      }
      setBlocks(next)
    } catch {
      // Block display is a nicety; the task list must not depend on it.
    }
  }, [])

  const schedule = useCallback(
    async (taskId: string, title: string, slot: Interval): Promise<string | null> => {
      setError('')
      try {
        const event = await send<{ id: string }>({
          type: 'scheduleTask',
          taskId,
          title,
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
        })
        await Promise.all([loadBusy(), loadBlocks()])

        if (!event?.id) {
          setError('Calendar accepted the request but returned no event.')
          return null
        }
        return event.id
      } catch (err) {
        setError(`Could not create the work block: ${message(err)}`)
        return null
      }
    },
    [loadBusy],
  )

  const unschedule = useCallback(
    async (eventId: string) => {
      try {
        await send({ type: 'unscheduleTask', eventId })
        await Promise.all([loadBusy(), loadBlocks()])
      } catch (err) {
        // Never blocks completion, but the user should still know.
        setError(`Could not remove the work block: ${message(err)}`)
      }
    },
    [loadBusy, loadBlocks],
  )

  useEffect(() => {
    void load()
    void loadBusy()
    void loadBlocks()
    void chrome.storage.local
      .get(OVERRIDE_KEY)
      .then((stored) => {
        const value = stored[OVERRIDE_KEY] as Record<string, string> | undefined
        if (value && typeof value === 'object') setOverrides(value)
      })
      .catch(() => undefined)
  }, [load, loadBusy, loadBlocks])

  /**
   * Blocks are edited in Google Calendar, in another tab, so the panel has no
   * event to react to. Refreshing when the panel regains focus is when the
   * user is most likely to be looking for the change.
   */
  useEffect(() => {
    const refresh = (): void => {
      void loadBlocks()
      void loadBusy()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [loadBlocks, loadBusy])

  const courses = useMemo(
    () => (snapshot ? extractCourses(snapshot.events) : []),
    [snapshot],
  )

  const colourOf = useMemo(() => {
    const byCode = new Map(courses.map((c) => [c.code, c]))
    const sources = { courses: byCode, palette: snapshot?.palette ?? {}, overrides }

    return (category: string): string =>
      colourForCategory(category, sources) ?? colorFor(category)
  }, [courses, snapshot, overrides])

  const setOverride = useCallback((category: string, colour: string | null) => {
    setOverrides((prev) => {
      const next = { ...prev }
      if (colour) next[category] = colour
      else delete next[category]

      void chrome.storage.local.set({ [OVERRIDE_KEY]: next }).catch(() => undefined)
      return next
    })
  }, [])

  return {
    events: snapshot?.events ?? [],
    courses,
    colourOf,
    currentClass: snapshot ? currentCourse(snapshot.events, new Date()) : null,
    ready: snapshot !== null,
    busy,
    blocks,
    error,
    dismissError: () => setError(''),
    reload: load,
    schedule,
    unschedule,
    setOverride,
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
