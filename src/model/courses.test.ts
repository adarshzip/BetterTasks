import { describe, it, expect } from 'vitest'
import { colourForCategory, courseCodeOf, currentCourse, extractCourses } from './courses'
import type { WireEvent } from '@/api/calendar'

const event = (summary: string, extra: Partial<WireEvent> = {}): WireEvent => ({
  id: summary,
  summary,
  ...extra,
})

/** Titles taken from the shape of a real course calendar. */
const timetable = (): WireEvent[] => [
  event('MATH 458: Numerical Analysis', { colorId: '4' }),
  event('MATH 458: Numerical Analysis', { colorId: '4' }),
  event('QBIO 401: Introduction', { colorId: '10' }),
  event('QBIO 401: Introduction', { colorId: '10' }),
  event('Coffee with Sam'),
]

describe('courseCodeOf', () => {
  it('normalises spacing and case', () => {
    expect(courseCodeOf('math 458 lecture')).toBe('MATH 458')
    expect(courseCodeOf('CS101 lab')).toBe('CS 101')
  })

  it('returns null when there is no course code', () => {
    expect(courseCodeOf('Coffee with Sam')).toBeNull()
    expect(courseCodeOf(undefined)).toBeNull()
  })

  // A room number looks a lot like a course code.
  it('takes the first code when a title contains two', () => {
    expect(courseCodeOf('MATH 458 in WPH 207')).toBe('MATH 458')
  })
})

describe('extractCourses', () => {
  it('finds recurring courses and their colours', () => {
    const courses = extractCourses(timetable())
    expect(courses.map((c) => c.code)).toEqual(['MATH 458', 'QBIO 401'])
    expect(courses[0]!.colorId).toBe('4')
  })

  it('ignores titles with no course code', () => {
    expect(extractCourses(timetable()).some((c) => c.code.includes('COFFEE'))).toBe(false)
  })

  // A code seen once is more likely a one-off meeting than a class.
  it('drops single sightings when recurring courses exist', () => {
    const events = [...timetable(), event('ARCH 101 open house', { colorId: '2' })]
    expect(extractCourses(events).map((c) => c.code)).not.toContain('ARCH 101')
  })

  it('falls back to single sightings when nothing recurs', () => {
    expect(extractCourses([event('ARCH 101 open house')]).map((c) => c.code)).toEqual(['ARCH 101'])
  })

  it('tolerates an event with no colour', () => {
    const courses = extractCourses([event('WRIT 340 seminar'), event('WRIT 340 seminar')])
    expect(courses[0]!.colorId).toBeUndefined()
  })

  it('ranks by how often a course is seen', () => {
    const events = [...timetable(), event('QBIO 401: Introduction', { colorId: '10' })]
    expect(extractCourses(events)[0]!.code).toBe('QBIO 401')
  })
})

describe('colourForCategory', () => {
  const sources = {
    courses: new Map(extractCourses(timetable()).map((c) => [c.code, c])),
    palette: { '4': { background: '#e67c73' }, '10': { background: '#0b8043' } },
    overrides: {},
  }

  it('resolves a course colour from the palette', () => {
    expect(colourForCategory('MATH 458', sources)).toBe('#e67c73')
  })

  it('matches a differently cased category', () => {
    expect(colourForCategory('math 458', sources)).toBe('#e67c73')
  })

  it('returns null for a category with no matching course', () => {
    expect(colourForCategory('thesis', sources)).toBeNull()
  })

  it('lets a manual override win', () => {
    const overridden = { ...sources, overrides: { 'MATH 458': '#ffffff' } }
    expect(colourForCategory('MATH 458', overridden)).toBe('#ffffff')
  })

  it('returns null when the palette lacks the colour id', () => {
    expect(colourForCategory('MATH 458', { ...sources, palette: {} })).toBeNull()
  })
})

describe('currentCourse', () => {
  const timed = (summary: string, from: string, to: string): WireEvent => ({
    id: summary + from,
    summary,
    start: { dateTime: from },
    end: { dateTime: to },
  })

  const now = new Date(2026, 8, 2, 11, 30)

  it('finds the class running right now', () => {
    const events = [timed('MATH 458 lecture', iso(11, 0), iso(12, 20))]
    expect(currentCourse(events, now)).toBe('MATH 458')
  })

  it('finds a class starting shortly', () => {
    const events = [timed('QBIO 401 lecture', iso(11, 45), iso(13, 0))]
    expect(currentCourse(events, now)).toBe('QBIO 401')
  })

  it('ignores a class that has finished', () => {
    const events = [timed('MATH 458 lecture', iso(9, 0), iso(10, 0))]
    expect(currentCourse(events, now)).toBeNull()
  })

  it('ignores an all-day event, which carries no dateTime', () => {
    const allDay: WireEvent = { id: 'x', summary: 'MATH 458 reading week', start: { date: '2026-09-02' } }
    expect(currentCourse([allDay], now)).toBeNull()
  })

  it('returns null when nothing is running', () => {
    expect(currentCourse([], now)).toBeNull()
  })
})

function iso(hour: number, minute: number): string {
  return new Date(2026, 8, 2, hour, minute).toISOString()
}
