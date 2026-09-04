import type { TaskMeta } from './types'
import { addInterval } from './dates'

/**
 * Recurrence, including when it stops.
 *
 * The Tasks API has no concept of recurrence, so a repeating task is really a
 * chain: completing one creates the next. Without an end condition that chain
 * runs forever, which is wrong for coursework — a weekly problem set should
 * stop at the end of term, not follow you into the summer.
 *
 * Two ways to end, matching Google Tasks: on a date, or after a number of
 * occurrences. Neither, and it repeats indefinitely.
 */

export interface NextOccurrence {
  /** The next instance's due date. */
  due: Date
  /** Metadata to carry across, with the remaining count decremented. */
  meta: TaskMeta
}

/**
 * Computes the next instance of a repeating task, or null when the recurrence
 * has run out.
 *
 * @param current the due date of the instance just completed
 */
export function nextOccurrence(current: Date, meta: TaskMeta): NextOccurrence | null {
  if (!meta.rec) return null

  // A count of 1 means the instance just completed was the last one.
  if (meta.recn !== undefined && meta.recn <= 1) return null

  const due = addInterval(current, meta.rec)
  if (due.getTime() === current.getTime()) return null

  // An end date stops the chain rather than truncating to it: a task due after
  // the cutoff should not exist at all.
  if (meta.recu) {
    const until = parseIsoDate(meta.recu)
    if (until && startOfDay(due) > until) return null
  }

  const next: TaskMeta = { ...meta }
  if (meta.recn !== undefined) next.recn = meta.recn - 1

  return { due, meta: next }
}

/** Describes an end condition for the UI, e.g. "3 left" or "until 12 Dec". */
export function describeEnd(meta: TaskMeta): string | null {
  if (!meta.rec) return null
  if (meta.recn !== undefined) return `${meta.recn} left`

  if (meta.recu) {
    const until = parseIsoDate(meta.recu)
    if (until) {
      return `until ${until.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    }
  }

  return null
}

function parseIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const [, y, m, d] = match as unknown as [string, string, string, string]
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
