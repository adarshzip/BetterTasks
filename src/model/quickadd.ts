import * as chrono from 'chrono-node'
import { COURSE, courseCodeOf } from './courses'

/**
 * Parses a quick-add line into a task.
 *
 * Setting a class through the detail editor is fine once and tedious thirty
 * times, so the fast path is typing it inline:
 *
 *   math 458 pset 4 fri 5pm 90m !1
 *   → title "pset 4", class MATH 458, due Friday 17:00, 90 minutes, priority 1
 *
 * Order matters. Course codes and durations are extracted before the date
 * parser runs, because chrono will happily read "458" as a day of the month.
 */

/**
 * Splits pasted text into task titles.
 *
 * Lists get pasted from notes, syllabi, and recipes, and they arrive with
 * whatever bullet style the source used. Stripping those is the difference
 * between ten clean subtasks and ten titles beginning with a hyphen.
 */
export function splitPastedLines(text: string, max = 50): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•‣◦]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .slice(0, max)
}

export interface ParsedEntry {
  title: string
  category?: string
  due?: Date
  time?: string
  eff?: number
  pri?: number
}

/** e.g. #thesis or #senior_thesis, for categories that are not course codes */
const TAG = /(?:^|\s)#([\w-]+)/
/** e.g. 30m, 2h, 1.5h */
const EFFORT = /(?:^|\s)(\d+(?:\.\d+)?)\s?(m|min|mins|h|hr|hrs)\b/i
/** e.g. !1 !2 !3 */
const PRIORITY = /(?:^|\s)!([123])\b/

export function parseEntry(input: string, known: string[] = [], now = new Date()): ParsedEntry {
  // Strip each token as it is recognised, so later patterns never see text an
  // earlier one already claimed.
  let text = input

  const category = takeCategory(text, known)
  if (category) text = category.rest

  const effort = take(text, EFFORT)
  if (effort) text = effort.rest

  const priority = take(text, PRIORITY)
  if (priority) text = priority.rest

  const date = takeDate(text, now)
  if (date) text = date.rest

  const result: ParsedEntry = { title: clean(text) }

  if (category) result.category = category.value
  if (date) {
    result.due = date.value
    if (date.time) result.time = date.time
  }
  if (effort) result.eff = minutesOf(effort.match)
  if (priority?.match[1]) result.pri = Number(priority.match[1])

  return result
}

/**
 * Matches a known category first, so "math 458" resolves to an existing
 * "MATH 458" rather than inventing a differently-cased duplicate.
 */
function takeCategory(text: string, known: string[]): { value: string; rest: string } | null {
  for (const candidate of known) {
    const pattern = new RegExp(`(?:^|\\s)${escape(candidate).replace(/\s+/g, '\\s?')}\\b`, 'i')
    const match = text.match(pattern)
    if (match) return { value: candidate, rest: text.replace(pattern, ' ') }
  }

  const tag = text.match(TAG)
  // A hashtag can't contain a literal space without becoming ambiguous with
  // the rest of the title, so an underscore stands in for one — #senior_thesis
  // creates the category "senior thesis" rather than literally "senior_thesis".
  if (tag?.[1]) return { value: tag[1].replace(/_/g, ' '), rest: text.replace(TAG, ' ') }

  const course = courseCodeOf(text)
  if (course) return { value: course, rest: text.replace(COURSE, ' ') }

  return null
}

/** e.g. 9/16, 09/16, 9/16/26, 9/16/2026 — unambiguous enough to skip the letter check below. */
const SLASH_DATE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/

/** Shorthand chrono does not know, rewritten to text it does before parsing. */
const SHORTHAND: Array<[RegExp, string]> = [
  [/\beod\b/i, 'today 11:59pm'],
  [/\beow\b/i, 'friday'],
  [/\basap\b/i, 'today'],
  [/\btmr\b/i, 'tomorrow'],
]

/**
 * Only accepts a date whose matched text contains a letter, or is an
 * unambiguous slash date. A bare number is far more likely to be part of the
 * task ("pset 4", "chapter 12") than a day of the month, and chrono cannot
 * tell the difference — but "9/16" cannot mean anything else.
 */
function takeDate(
  text: string,
  now: Date,
): { value: Date; time?: string; rest: string } | null {
  // Shorthand is a standalone token that expands to a full phrase chrono
  // already understands, so the original token — not chrono's match, which
  // is now in the expanded text — is what has to come out of the title.
  let expanded = text
  let shorthandMatch: string | null = null
  for (const [pattern, replacement] of SHORTHAND) {
    const found = expanded.match(pattern)
    if (found) {
      shorthandMatch = found[0]
      expanded = expanded.replace(pattern, replacement)
      break
    }
  }

  const [result] = chrono.parse(expanded, now, { forwardDate: true })
  if (!result) return null
  if (!/[a-z]/i.test(result.text) && !SLASH_DATE.test(result.text.trim())) return null

  const date = result.start.date()
  const rest = shorthandMatch ? text.replace(shorthandMatch, ' ') : text.replace(result.text, ' ')

  // A time is only real if chrono actually saw one; otherwise it defaults to
  // midday and we would invent a due time the user never typed.
  return result.start.isCertain('hour')
    ? {
        value: date,
        time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        rest,
      }
    : { value: date, rest }
}

function take(text: string, pattern: RegExp): { match: RegExpMatchArray; rest: string } | null {
  const match = text.match(pattern)
  return match ? { match, rest: text.replace(pattern, ' ') } : null
}

function minutesOf(match: RegExpMatchArray): number {
  const amount = Number(match[1])
  return match[2]?.toLowerCase().startsWith('h') ? Math.round(amount * 60) : Math.round(amount)
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
