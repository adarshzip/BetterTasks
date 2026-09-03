import { describe, it, expect } from 'vitest'
import { parseEntry, splitPastedLines } from './quickadd'

const NOW = new Date(2026, 8, 2, 9, 0) // Wed 2 Sep 2026, 09:00

describe('parseEntry', () => {
  it('returns a plain title unchanged', () => {
    expect(parseEntry('read chapter 4', [], NOW)).toEqual({ title: 'read chapter 4' })
  })

  it('extracts a course code and normalises its case', () => {
    const parsed = parseEntry('math 458 pset 4', [], NOW)
    expect(parsed.category).toBe('MATH 458')
    expect(parsed.title).toBe('pset 4')
  })

  it('handles a course code with no space', () => {
    expect(parseEntry('cs101 lab', [], NOW).category).toBe('CS 101')
  })

  it('prefers an existing category over inventing a duplicate', () => {
    const parsed = parseEntry('math 458 pset 4', ['MATH 458'], NOW)
    expect(parsed.category).toBe('MATH 458')
    expect(parsed.title).toBe('pset 4')
  })

  it('accepts a hash tag for non-course categories', () => {
    const parsed = parseEntry('draft intro #thesis', [], NOW)
    expect(parsed.category).toBe('thesis')
    expect(parsed.title).toBe('draft intro')
  })

  // The trap: chrono reads bare numbers as days of the month, so "pset 4"
  // would become "due the 4th" and lose the 4 from the title.
  it('does not treat a bare number as a date', () => {
    const parsed = parseEntry('pset 4', [], NOW)
    expect(parsed.due).toBeUndefined()
    expect(parsed.title).toBe('pset 4')
  })

  it('does not read a course number as a date', () => {
    expect(parseEntry('math 458 homework', [], NOW).due).toBeUndefined()
  })

  it('parses a weekday', () => {
    const parsed = parseEntry('essay draft friday', [], NOW)
    expect(parsed.due?.getDate()).toBe(4)
    expect(parsed.title).toBe('essay draft')
  })

  it('parses a date with a time', () => {
    const parsed = parseEntry('submit fri 5pm', [], NOW)
    expect(parsed.due?.getDate()).toBe(4)
    expect(parsed.time).toBe('17:00')
    expect(parsed.title).toBe('submit')
  })

  it('leaves the time unset when none was typed', () => {
    expect(parseEntry('submit friday', [], NOW).time).toBeUndefined()
  })

  it('parses effort in minutes and hours', () => {
    expect(parseEntry('review 45m', [], NOW).eff).toBe(45)
    expect(parseEntry('review 2h', [], NOW).eff).toBe(120)
    expect(parseEntry('review 1.5h', [], NOW).eff).toBe(90)
  })

  it('parses priority', () => {
    const parsed = parseEntry('finals prep !1', [], NOW)
    expect(parsed.pri).toBe(1)
    expect(parsed.title).toBe('finals prep')
  })

  it('parses everything at once', () => {
    const parsed = parseEntry('math 458 pset 4 fri 5pm 90m !1', ['MATH 458'], NOW)
    expect(parsed).toMatchObject({
      title: 'pset 4',
      category: 'MATH 458',
      time: '17:00',
      eff: 90,
      pri: 1,
    })
    expect(parsed.due?.getDate()).toBe(4)
  })

  it('never produces an empty title from a line that had one', () => {
    expect(parseEntry('math 458 friday', [], NOW).title).toBe('')
    expect(parseEntry('  spaced   out  ', [], NOW).title).toBe('spaced out')
  })
})

describe('splitPastedLines', () => {
  it('splits on newlines and drops blank lines', () => {
    expect(splitPastedLines('one\n\ntwo\n')).toEqual(['one', 'two'])
  })

  it('strips bullet characters', () => {
    expect(splitPastedLines('- one\n* two\n• three')).toEqual(['one', 'two', 'three'])
  })

  it('strips numbered list prefixes', () => {
    expect(splitPastedLines('1. one\n2) two')).toEqual(['one', 'two'])
  })

  // A quantity is part of the item, not a list marker.
  it('keeps numbers that are part of the text', () => {
    expect(splitPastedLines('2 cups flour')).toEqual(['2 cups flour'])
    expect(splitPastedLines('read chapter 4')).toEqual(['read chapter 4'])
  })

  it('handles CRLF from Windows sources', () => {
    expect(splitPastedLines('one\r\ntwo')).toEqual(['one', 'two'])
  })

  // A stray paste of a whole document should not create hundreds of tasks.
  it('caps how many lines it will accept', () => {
    const many = Array.from({ length: 200 }, (_, i) => `item ${i}`).join('\n')
    expect(splitPastedLines(many)).toHaveLength(50)
  })

  it('returns nothing for empty input', () => {
    expect(splitPastedLines('   \n  ')).toEqual([])
  })
})
