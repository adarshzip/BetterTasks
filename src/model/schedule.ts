/**
 * Slot finding.
 *
 * Given what is already on the calendar, how long a task needs, and when it is
 * due, propose times to work on it. Pure and interval-based, so every rule here
 * is testable without touching an API.
 *
 * The point is that the panel holds both the task's effort estimate and the
 * calendar's busy time, so it can answer "when will I actually do this?"
 * rather than making the user find a gap by eye.
 */

export interface Interval {
  start: Date
  end: Date
}

export interface WorkingHours {
  /** Local hour work can start, e.g. 9. */
  startHour: number
  /** Local hour work must end, e.g. 22. */
  endHour: number
}

export const DEFAULT_HOURS: WorkingHours = { startHour: 9, endHour: 22 }

/** Used when a task carries no effort estimate. */
export const DEFAULT_MINUTES = 60

export interface SlotRequest {
  minutes?: number
  /** Calendar date the work must be finished by, or null for no deadline. */
  due: Date | null
  now: Date
  busy: Interval[]
  hours?: WorkingHours
  /** How far ahead to look when there is no due date. */
  horizonDays?: number
  max?: number
}

/**
 * Proposes openings, earliest first.
 *
 * Only whole blocks are offered. Splitting a three-hour task across four days
 * is a scheduling decision the user should make deliberately, not something
 * that should happen because an algorithm preferred a tidy fit.
 */
export function findSlots(request: SlotRequest): Interval[] {
  const {
    minutes = DEFAULT_MINUTES,
    due,
    now,
    busy,
    hours = DEFAULT_HOURS,
    horizonDays = 14,
    max = 3,
  } = request

  if (minutes <= 0) return []

  const deadline = due ? endOfDay(due) : addDays(startOfDay(now), horizonDays)
  if (deadline <= now) return []

  const free = freeWindows({ now, deadline, busy, hours })
  const slots: Interval[] = []

  for (const window of free) {
    const available = minutesBetween(window.start, window.end)
    if (available < minutes) continue

    slots.push({ start: window.start, end: addMinutes(window.start, minutes) })
    if (slots.length >= max) break
  }

  return slots
}

/**
 * Total free minutes between now and a deadline, inside working hours.
 *
 * Used for the deadline warning: a task needing more time than remains is the
 * single most useful thing the panel can tell a student, and no task app
 * without calendar access can compute it.
 */
export function freeMinutesBefore(
  deadline: Date,
  options: { now: Date; busy: Interval[]; hours?: WorkingHours },
): number {
  const { now, busy, hours = DEFAULT_HOURS } = options
  if (deadline <= now) return 0

  return freeWindows({ now, deadline, busy, hours }).reduce(
    (total, window) => total + minutesBetween(window.start, window.end),
    0,
  )
}

/** True when a task cannot fit in the time left before its deadline. */
export function isAtRisk(
  task: { due: Date | null; minutes?: number },
  options: { now: Date; busy: Interval[]; hours?: WorkingHours },
): boolean {
  if (!task.due) return false
  const needed = task.minutes ?? DEFAULT_MINUTES
  return freeMinutesBefore(endOfDay(task.due), options) < needed
}

/**
 * Working-hours windows with busy time removed, day by day.
 *
 * Walking one day at a time is what makes an event spanning midnight harmless:
 * it is clipped into each day's window separately rather than swallowing the
 * boundary.
 */
export function freeWindows(options: {
  now: Date
  deadline: Date
  busy: Interval[]
  hours: WorkingHours
}): Interval[] {
  const { now, deadline, busy, hours } = options
  const merged = mergeIntervals(busy)
  const windows: Interval[] = []

  let day = startOfDay(now)
  while (day < deadline) {
    const dayStart = atHour(day, hours.startHour)
    const dayEnd = atHour(day, hours.endHour)

    // Never propose a time in the past, or beyond the deadline.
    const from = maxDate(dayStart, now)
    const to = minDate(dayEnd, deadline)

    if (from < to) windows.push(...subtractBusy({ start: from, end: to }, merged))
    day = addDays(day, 1)
  }

  return windows
}

/** Splits a window around any busy intervals overlapping it. */
function subtractBusy(window: Interval, busy: Interval[]): Interval[] {
  const gaps: Interval[] = []
  let cursor = window.start

  for (const block of busy) {
    if (block.end <= cursor) continue
    if (block.start >= window.end) break

    if (block.start > cursor) gaps.push({ start: cursor, end: minDate(block.start, window.end) })
    cursor = maxDate(cursor, block.end)
    if (cursor >= window.end) return gaps
  }

  if (cursor < window.end) gaps.push({ start: cursor, end: window.end })
  return gaps
}

/** Sorts and coalesces overlapping or touching intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    // `>=` rather than `>`: back-to-back events leave no usable gap between them.
    if (last && interval.start <= last.end) {
      last.end = maxDate(last.end, interval.end)
    } else {
      merged.push({ start: interval.start, end: interval.end })
    }
  }
  return merged
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const endOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
const atHour = (d: Date, hour: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour)
const addDays = (d: Date, days: number) => {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}
const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000)
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000
const minDate = (a: Date, b: Date) => (a < b ? a : b)
const maxDate = (a: Date, b: Date) => (a > b ? a : b)
