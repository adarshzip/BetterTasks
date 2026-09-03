import type { WireEvent } from '@/api/calendar'

/**
 * Course extraction and colour mapping.
 *
 * A student's calendar already contains the answer to "what classes am I
 * taking": MATH 458, QBIO 401, TAC 458 recur every week with distinct colours.
 * Reading that removes nearly all manual class tagging, and makes the panel's
 * pills match the grid.
 */

/** e.g. MATH 458, CS101, WRIT 340. Shared with the quick-add parser. */
export const COURSE = /\b([a-z]{2,4})\s?(\d{3}[a-z]?)\b/i

export interface Course {
  /** Normalised, e.g. "MATH 458". */
  code: string
  /** Calendar's colorId, if the event carried one. */
  colorId?: string
  /** How many events this code was seen on, used to rank ambiguity. */
  count: number
}

/** Pulls the first course code out of a title, normalised. */
export function courseCodeOf(title: string | undefined): string | null {
  const match = title?.match(COURSE)
  if (!match?.[1] || !match[2]) return null
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`
}

/**
 * Collects the courses on a set of events.
 *
 * A code seen once is far more likely to be noise (a one-off meeting, a room
 * number that looks like a course) than a class, so single sightings are
 * dropped unless nothing else qualifies.
 */
export function extractCourses(events: WireEvent[], minSightings = 2): Course[] {
  const found = new Map<string, Course>()

  for (const event of events) {
    const code = courseCodeOf(event.summary)
    if (!code) continue

    const existing = found.get(code)
    if (existing) {
      existing.count += 1
      // Keep the first colour seen; later instances of a recurring event carry
      // the same one, and a one-off override should not win.
      if (!existing.colorId && event.colorId) existing.colorId = event.colorId
    } else {
      found.set(code, {
        code,
        count: 1,
        ...(event.colorId ? { colorId: event.colorId } : {}),
      })
    }
  }

  const courses = [...found.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  const recurring = courses.filter((c) => c.count >= minSightings)
  return recurring.length > 0 ? recurring : courses
}

export interface ColourSources {
  /** Courses found on the calendar, keyed by code. */
  courses: Map<string, Course>
  /** colorId to hex, from the Calendar colours endpoint. */
  palette: Record<string, { background: string }>
  /** Manual overrides, which always win. */
  overrides: Record<string, string>
}

/**
 * Resolves a category's colour: manual override first, then the matching
 * course's calendar colour, then null so the caller can fall back to its own
 * deterministic palette.
 */
export function colourForCategory(category: string, sources: ColourSources): string | null {
  const override = sources.overrides[category]
  if (override) return override

  const course = sources.courses.get(category) ?? sources.courses.get(normalise(category))
  if (!course?.colorId) return null

  return sources.palette[course.colorId]?.background ?? null
}

/** Lets "math 458" match a course recorded as "MATH 458". */
function normalise(category: string): string {
  return courseCodeOf(category) ?? category
}

/**
 * The course whose event is running now, or starting soon. Used to default a
 * new task's class, which is right far more often than not when you are adding
 * homework during or just after a lecture.
 */
export function currentCourse(events: WireEvent[], now: Date, withinMinutes = 30): string | null {
  const soon = new Date(now.getTime() + withinMinutes * 60_000)

  for (const event of events) {
    const start = event.start?.dateTime ? new Date(event.start.dateTime) : null
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null
    if (!start || !end) continue

    const running = start <= now && end > now
    const imminent = start > now && start <= soon
    if (!running && !imminent) continue

    const code = courseCodeOf(event.summary)
    if (code) return code
  }

  return null
}
