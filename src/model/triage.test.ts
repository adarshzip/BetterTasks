import { describe, it, expect } from 'vitest'
import { describeSuggestion, suggestionsFor } from './triage'
import { toTask } from './tree'
import type { GTask } from './types'

const NOW = new Date(2026, 8, 2, 9, 0)

const task = (id: string, extra: Partial<GTask> = {}): GTask => ({
  id,
  title: id,
  status: 'needsAction',
  position: '00',
  ...extra,
})

const suggest = (raws: GTask[], known: string[] = [], dismissed = new Set<string>()) =>
  suggestionsFor(raws.map((r) => toTask(r, 'l1')), known, dismissed, NOW)

describe('suggestionsFor', () => {
  it('recovers a class typed into the title on a phone', () => {
    const [suggestion] = suggest([task('a', { title: 'math 458 pset 4' })])
    expect(suggestion).toMatchObject({ title: 'pset 4', category: 'MATH 458' })
  })

  it('recovers a due date, effort, and priority', () => {
    const [suggestion] = suggest([task('a', { title: 'essay friday 90m !1' })])
    expect(suggestion?.title).toBe('essay')
    expect(suggestion?.eff).toBe(90)
    expect(suggestion?.pri).toBe(1)
    expect(suggestion?.due?.getDate()).toBe(4)
  })

  // An ordinary task has nothing to apply, and listing it would make the queue
  // noise rather than a to-do.
  it('ignores a task with no syntax in it', () => {
    expect(suggest([task('a', { title: 'buy milk' })])).toEqual([])
  })

  it('ignores completed tasks', () => {
    expect(suggest([task('a', { title: 'math 458 pset', status: 'completed' })])).toEqual([])
  })

  // Any metadata means the panel has already handled this task, so its title
  // is no longer raw capture.
  it('ignores a task that already carries metadata', () => {
    const raw = task('a', { title: 'math 458 pset', notes: '⟦bt⟧{"eff":30}' })
    expect(suggest([raw])).toEqual([])
  })

  it('respects dismissals', () => {
    const raw = task('a', { title: 'math 458 pset' })
    expect(suggest([raw], [], new Set(['a']))).toEqual([])
  })

  // Stripping the class would leave nothing behind, which would destroy the
  // task rather than tidy it.
  it('refuses a suggestion that would empty the title', () => {
    expect(suggest([task('a', { title: 'math 458' })])).toEqual([])
  })

  it('matches an existing class rather than inventing a variant', () => {
    const [suggestion] = suggest([task('a', { title: 'math 458 pset' })], ['MATH 458'])
    expect(suggestion?.category).toBe('MATH 458')
  })

  it('does not treat a bare number as a date', () => {
    expect(suggest([task('a', { title: 'read chapter 4' })])).toEqual([])
  })
})

describe('describeSuggestion', () => {
  it('summarises what would change', () => {
    const [suggestion] = suggest([task('a', { title: 'math 458 essay friday 90m !1' })])
    const parts = describeSuggestion(suggestion!)
    expect(parts).toContain('MATH 458')
    expect(parts).toContain('90m')
    expect(parts).toContain('P1')
  })
})
