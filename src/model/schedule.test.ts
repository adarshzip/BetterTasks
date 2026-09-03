import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MINUTES,
  findSlots,
  freeMinutesBefore,
  isAtRisk,
  mergeIntervals,
  type Interval,
} from './schedule'

// Wed 2 Sep 2026, 09:00 local. Working hours default to 09:00-22:00.
const NOW = new Date(2026, 8, 2, 9, 0)

const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute)
const busy = (day: number, from: number, to: number): Interval => ({
  start: at(day, from),
  end: at(day, to),
})
const hhmm = (d: Date) =>
  `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

describe('mergeIntervals', () => {
  it('coalesces overlapping intervals', () => {
    const merged = mergeIntervals([busy(2, 10, 12), busy(2, 11, 13)])
    expect(merged).toHaveLength(1)
    expect(hhmm(merged[0]!.end)).toBe('2 13:00')
  })

  // Back-to-back events leave no usable gap, so they must merge.
  it('coalesces touching intervals', () => {
    expect(mergeIntervals([busy(2, 10, 11), busy(2, 11, 12)])).toHaveLength(1)
  })

  it('keeps a real gap between intervals', () => {
    expect(mergeIntervals([busy(2, 10, 11), busy(2, 12, 13)])).toHaveLength(2)
  })

  it('discards zero-length intervals', () => {
    expect(mergeIntervals([busy(2, 10, 10)])).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = [busy(2, 11, 13), busy(2, 10, 12)]
    mergeIntervals(input)
    expect(hhmm(input[0]!.start)).toBe('2 11:00')
  })
})

describe('findSlots', () => {
  it('offers the first opening of the day', () => {
    const [slot] = findSlots({ minutes: 60, due: at(4, 0), now: NOW, busy: [] })
    expect(hhmm(slot!.start)).toBe('2 09:00')
    expect(hhmm(slot!.end)).toBe('2 10:00')
  })

  it('skips over a busy block', () => {
    const [slot] = findSlots({ minutes: 90, due: at(4, 0), now: NOW, busy: [busy(2, 9, 11)] })
    expect(hhmm(slot!.start)).toBe('2 11:00')
  })

  it('never proposes a time in the past', () => {
    const afternoon = new Date(2026, 8, 2, 15, 30)
    const [slot] = findSlots({ minutes: 60, due: at(4, 0), now: afternoon, busy: [] })
    expect(slot!.start.getTime()).toBeGreaterThanOrEqual(afternoon.getTime())
  })

  it('respects working hours', () => {
    const late = new Date(2026, 8, 2, 21, 30)
    const [slot] = findSlots({ minutes: 60, due: at(4, 0), now: late, busy: [] })
    // 21:30 leaves only 30 minutes today, so it rolls to tomorrow morning.
    expect(hhmm(slot!.start)).toBe('3 09:00')
  })

  it('takes a slot that fits exactly', () => {
    const slots = findSlots({ minutes: 120, due: at(2, 0), now: NOW, busy: [busy(2, 11, 22)] })
    expect(hhmm(slots[0]!.start)).toBe('2 09:00')
    expect(hhmm(slots[0]!.end)).toBe('2 11:00')
  })

  it('rejects a gap one minute too short', () => {
    const slots = findSlots({
      minutes: 121,
      due: at(2, 0),
      now: NOW,
      busy: [busy(2, 11, 22)],
    })
    expect(slots).toEqual([])
  })

  it('returns nothing when the day is full', () => {
    expect(findSlots({ minutes: 30, due: at(2, 0), now: NOW, busy: [busy(2, 0, 23)] })).toEqual([])
  })

  it('returns nothing when the deadline has already passed', () => {
    expect(findSlots({ minutes: 30, due: at(1, 0), now: NOW, busy: [] })).toEqual([])
  })

  it('never proposes a slot after the due date', () => {
    const slots = findSlots({ minutes: 60, due: at(3, 0), now: NOW, busy: [] })
    for (const slot of slots) expect(slot.end.getTime()).toBeLessThanOrEqual(at(4, 0).getTime())
  })

  it('spreads suggestions across days when a day is full', () => {
    const slots = findSlots({
      minutes: 60,
      due: at(5, 0),
      now: NOW,
      busy: [busy(2, 0, 23), busy(3, 0, 23)],
    })
    expect(slots.map((s) => s.start.getDate())).toEqual([4, 5])
  })

  it('defaults to an hour when no estimate is given', () => {
    const [slot] = findSlots({ due: at(4, 0), now: NOW, busy: [] })
    expect(slot!.end.getTime() - slot!.start.getTime()).toBe(DEFAULT_MINUTES * 60_000)
  })

  it('looks ahead a fixed horizon when there is no due date', () => {
    const slots = findSlots({ minutes: 60, due: null, now: NOW, busy: [] })
    expect(slots.length).toBeGreaterThan(0)
  })

  it('returns at most the requested number of suggestions', () => {
    expect(findSlots({ minutes: 30, due: at(9, 0), now: NOW, busy: [], max: 2 })).toHaveLength(2)
  })

  it('ignores a zero-length request', () => {
    expect(findSlots({ minutes: 0, due: at(4, 0), now: NOW, busy: [] })).toEqual([])
  })

  // An event crossing midnight must block both days, not swallow the boundary.
  it('handles a busy interval spanning midnight', () => {
    const overnight: Interval = { start: at(2, 20), end: at(3, 11) }
    const slots = findSlots({ minutes: 60, due: at(4, 0), now: NOW, busy: [overnight], max: 5 })

    expect(hhmm(slots[0]!.start)).toBe('2 09:00')
    const day3 = slots.find((s) => s.start.getDate() === 3)
    expect(hhmm(day3!.start)).toBe('3 11:00')
  })

  // All-day events arrive as a busy interval covering the whole day.
  it('treats an all-day event as blocking the day', () => {
    const allDay: Interval = { start: at(2, 0), end: at(3, 0) }
    const [slot] = findSlots({ minutes: 60, due: at(4, 0), now: NOW, busy: [allDay] })
    expect(slot!.start.getDate()).toBe(3)
  })
})

describe('freeMinutesBefore and isAtRisk', () => {
  it('counts only working hours', () => {
    // 09:00 to 22:00 on the 2nd is 13 hours.
    expect(freeMinutesBefore(at(2, 23, 59), { now: NOW, busy: [] })).toBe(13 * 60)
  })

  it('subtracts busy time', () => {
    expect(freeMinutesBefore(at(2, 23, 59), { now: NOW, busy: [busy(2, 12, 14)] })).toBe(11 * 60)
  })

  it('returns zero for a deadline in the past', () => {
    expect(freeMinutesBefore(at(1, 12), { now: NOW, busy: [] })).toBe(0)
  })

  it('flags a task that cannot fit before its deadline', () => {
    const options = { now: NOW, busy: [busy(2, 9, 22)] }
    expect(isAtRisk({ due: at(2, 0), minutes: 60 }, options)).toBe(true)
    expect(isAtRisk({ due: at(3, 0), minutes: 60 }, options)).toBe(false)
  })

  it('never flags a task with no due date', () => {
    expect(isAtRisk({ due: null, minutes: 6000 }, { now: NOW, busy: [] })).toBe(false)
  })
})
