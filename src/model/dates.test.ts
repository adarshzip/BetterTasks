import { describe, it, expect } from 'vitest'
import { addInterval, encodeDue, parseDateInput, toDateInput } from './dates'
import { toTask } from './tree'

describe('encodeDue', () => {
  it('pins a local date to UTC midnight', () => {
    expect(encodeDue(new Date(2026, 8, 4)).due).toBe('2026-09-04T00:00:00.000Z')
  })

  it('clears both halves when the date is removed', () => {
    expect(encodeDue(null)).toEqual({ due: null, time: undefined })
  })

  it('keeps a valid time and drops an invalid one', () => {
    expect(encodeDue(new Date(2026, 8, 4), '17:30').time).toBe('17:30')
    expect(encodeDue(new Date(2026, 8, 4), '25:00').time).toBeUndefined()
    expect(encodeDue(new Date(2026, 8, 4), null).time).toBeUndefined()
  })

  // The round trip that matters: a date written here must read back as the
  // same calendar day, in a timezone behind UTC as well as ahead of it.
  it('survives a round trip through the API shape', () => {
    const encoded = encodeDue(new Date(2026, 8, 4), '17:30')
    const task = toTask(
      { id: 'a', due: encoded.due!, notes: `⟦bt⟧{"time":"${encoded.time}"}` },
      'l1',
    )
    expect(task.due?.getDate()).toBe(4)
    expect(task.due?.getMonth()).toBe(8)
    expect(task.due?.getHours()).toBe(17)
  })
})

describe('date inputs', () => {
  it('round trips through the input format', () => {
    expect(toDateInput(parseDateInput('2026-09-04'))).toBe('2026-09-04')
  })

  it('rejects malformed input', () => {
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('tomorrow')).toBeNull()
  })

  it('formats an empty date as an empty string', () => {
    expect(toDateInput(null)).toBe('')
  })
})

describe('addInterval', () => {
  it('adds days, weeks, and months', () => {
    const base = new Date(2026, 8, 4)
    expect(addInterval(base, '3d').getDate()).toBe(7)
    expect(addInterval(base, '1w').getDate()).toBe(11)
    expect(addInterval(base, '1m').getMonth()).toBe(9)
  })

  it('ignores an unparseable interval', () => {
    const base = new Date(2026, 8, 4)
    expect(addInterval(base, 'weekly').getTime()).toBe(base.getTime())
  })
})
