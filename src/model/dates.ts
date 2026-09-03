import type { TaskMeta } from './types'

/**
 * Due date encoding.
 *
 * The Tasks API stores `due` as a calendar date at UTC midnight and discards
 * any time component (docs/SPIKES.md). So a due date is really two values: the date
 * goes to Google, and the time of day, if any, goes in our metadata block.
 *
 * These must always be written together. Setting one without the other loses
 * the time silently, which is why they share a module and a single entry
 * point rather than being open-coded at each call site.
 */

export interface DueUpdate {
  /** RFC3339 for the API, or null to clear the due date. */
  due: string | null
  /** HH:MM for the metadata block, or undefined to clear it. */
  time: string | undefined
}

/** Builds both halves of a due date from a local calendar date and optional time. */
export function encodeDue(date: Date | null, time?: string | null): DueUpdate {
  if (!date) return { due: null, time: undefined }

  // Read the local calendar date and pin it to UTC midnight, which is the
  // format Google returns and the only part it preserves.
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return {
    due: new Date(utc).toISOString(),
    time: isClockTime(time) ? time : undefined,
  }
}

/** Parses the value of an <input type="date">, which is always local YYYY-MM-DD. */
export function parseDateInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const [, y, m, d] = match as unknown as [string, string, string, string]
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Formats a date for an <input type="date">, in local time. */
export function toDateInput(date: Date | null): string {
  if (!date) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/** Formats a time for an <input type="time">. */
export function toTimeInput(meta: TaskMeta): string {
  return meta.time ?? ''
}

/** Shifts a date forward by a recurrence interval like "1w" or "3d". */
export function addInterval(date: Date, interval: string): Date {
  const match = interval.match(/^(\d+)([dwm])$/)
  if (!match) return date

  const amount = Number(match[1])
  const next = new Date(date)

  switch (match[2]) {
    case 'd':
      next.setDate(next.getDate() + amount)
      break
    case 'w':
      next.setDate(next.getDate() + amount * 7)
      break
    case 'm':
      next.setMonth(next.getMonth() + amount)
      break
  }

  return next
}

function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}
