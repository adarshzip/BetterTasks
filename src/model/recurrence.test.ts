import { describe, it, expect } from 'vitest'
import { describeEnd, nextOccurrence } from './recurrence'
import type { TaskMeta } from './types'

const DUE = new Date(2026, 8, 4) // Fri 4 Sep 2026

describe('nextOccurrence', () => {
  it('returns nothing for a task that does not repeat', () => {
    expect(nextOccurrence(DUE, {})).toBeNull()
  })

  it('advances by the interval', () => {
    const next = nextOccurrence(DUE, { rec: '1w' })
    expect(next?.due.getDate()).toBe(11)
  })

  it('carries metadata across', () => {
    const meta: TaskMeta = { rec: '1w', cat: 'MATH 458', eff: 90 }
    expect(nextOccurrence(DUE, meta)?.meta).toMatchObject({ cat: 'MATH 458', eff: 90, rec: '1w' })
  })

  it('ignores an unparseable interval', () => {
    expect(nextOccurrence(DUE, { rec: 'weekly' as string })).toBeNull()
  })
})

describe('ending after a number of occurrences', () => {
  it('decrements the remaining count', () => {
    expect(nextOccurrence(DUE, { rec: '1w', recn: 3 })?.meta.recn).toBe(2)
  })

  // A count of one means the instance just completed was the last.
  it('stops when the count runs out', () => {
    expect(nextOccurrence(DUE, { rec: '1w', recn: 1 })).toBeNull()
  })

  it('walks a finite chain to exactly the right length', () => {
    let meta: TaskMeta = { rec: '1w', recn: 3 }
    let due = DUE
    const dates: number[] = [due.getDate()]

    for (;;) {
      const next = nextOccurrence(due, meta)
      if (!next) break
      due = next.due
      meta = next.meta
      dates.push(due.getDate())
    }

    // Three occurrences total: the original plus two more.
    expect(dates).toEqual([4, 11, 18])
  })
})

describe('ending on a date', () => {
  it('allows an occurrence landing on the end date', () => {
    expect(nextOccurrence(DUE, { rec: '1w', recu: '2026-09-11' })?.due.getDate()).toBe(11)
  })

  // The chain stops rather than truncating: a task due after the cutoff should
  // not exist at all.
  it('stops when the next instance would fall past the end date', () => {
    expect(nextOccurrence(DUE, { rec: '1w', recu: '2026-09-10' })).toBeNull()
  })

  it('ignores a malformed end date rather than stopping the chain', () => {
    expect(nextOccurrence(DUE, { rec: '1w', recu: 'december' })?.due.getDate()).toBe(11)
  })

  it('stops a monthly chain at the end of term', () => {
    const meta: TaskMeta = { rec: '1m', recu: '2026-12-15' }
    // November's instance rolls to December, which is still inside the term.
    expect(nextOccurrence(new Date(2026, 10, 4), meta)?.due.getMonth()).toBe(11)
    // December's would roll into January, past the cutoff.
    expect(nextOccurrence(new Date(2026, 11, 4), meta)).toBeNull()
  })
})

describe('describeEnd', () => {
  it('describes a count', () => {
    expect(describeEnd({ rec: '1w', recn: 3 })).toBe('3 left')
  })

  it('describes an end date', () => {
    expect(describeEnd({ rec: '1w', recu: '2026-12-12' })).toContain('until')
  })

  it('says nothing for an endless or absent recurrence', () => {
    expect(describeEnd({ rec: '1w' })).toBeNull()
    expect(describeEnd({})).toBeNull()
  })
})
