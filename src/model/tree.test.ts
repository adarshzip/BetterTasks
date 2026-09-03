import { describe, it, expect } from 'vitest'
import { buildTree, flattenTree, progressOf, toTask } from './tree'
import type { GTask } from './types'

const task = (id: string, extra: Partial<GTask> = {}): GTask => ({
  id,
  title: id,
  position: '00000000000000000000',
  status: 'needsAction',
  ...extra,
})

const build = (raws: GTask[]) => buildTree(raws.map((r) => toTask(r, 'list1')))
const ids = (nodes: { raw: GTask }[]) => nodes.map((n) => n.raw.id)

describe('toTask', () => {
  it('decodes metadata out of notes', () => {
    const t = toTask(task('a', { notes: 'body\n\n⟦bt⟧{"eff":45}' }), 'list1')
    expect(t.notes).toBe('body')
    expect(t.meta.eff).toBe(45)
  })

  it('survives a missing title, notes, and position', () => {
    const t = toTask({ id: 'a' }, 'list1')
    expect(t).toMatchObject({ title: '', notes: '', position: '', due: null, parent: null })
  })

  it('treats an unparseable due date as no due date', () => {
    expect(toTask(task('a', { due: 'not a date' }), 'list1').due).toBeNull()
  })

  // Google returns due dates as UTC midnight. Reading that as an instant in a
  // timezone behind UTC shifts every task a day earlier.
  it('reads a due date as a calendar date, not a UTC instant', () => {
    const due = toTask(task('a', { due: '2026-09-04T00:00:00.000Z' }), 'list1').due
    expect(due?.getFullYear()).toBe(2026)
    expect(due?.getMonth()).toBe(8)
    expect(due?.getDate()).toBe(4)
    expect(due?.getHours()).toBe(0)
  })

  it('applies a stashed time to a date-only due value', () => {
    const t = toTask(task('a', { due: '2026-09-04T00:00:00.000Z', notes: '⟦bt⟧{"time":"17:00"}' }), 'list1')
    expect(t.due?.getHours()).toBe(17)
    expect(t.due?.getDate()).toBe(4)
  })
})

describe('buildTree', () => {
  it('nests children under their parent', () => {
    const roots = build([task('parent'), task('child', { parent: 'parent' })])
    expect(ids(roots)).toEqual(['parent'])
    expect(ids(roots[0]!.children)).toEqual(['child'])
  })

  it('assigns depth', () => {
    const roots = build([task('p'), task('c', { parent: 'p' })])
    expect(roots[0]!.depth).toBe(0)
    expect(roots[0]!.children[0]!.depth).toBe(1)
  })

  // Routine in practice: completing a parent hides it, children still return.
  it('promotes an orphan to a root rather than dropping it', () => {
    const roots = build([task('orphan', { parent: 'missing' })])
    expect(ids(roots)).toEqual(['orphan'])
  })

  it('never loses a task', () => {
    const raws = [task('a'), task('b', { parent: 'a' }), task('c', { parent: 'gone' }), task('d')]
    expect(flattenTree(build(raws))).toHaveLength(raws.length)
  })

  it('orders siblings by position', () => {
    const roots = build([
      task('third', { position: '00000000000000000003' }),
      task('first', { position: '00000000000000000001' }),
      task('second', { position: '00000000000000000002' }),
    ])
    expect(ids(roots)).toEqual(['first', 'second', 'third'])
  })

  it('breaks ties on duplicate positions deterministically', () => {
    const forward = build([task('b'), task('a'), task('c')])
    const reverse = build([task('c'), task('a'), task('b')])
    expect(ids(forward)).toEqual(['a', 'b', 'c'])
    expect(ids(forward)).toEqual(ids(reverse))
  })

  it('ignores a task that claims itself as parent', () => {
    const roots = build([task('self', { parent: 'self' })])
    expect(ids(roots)).toEqual(['self'])
    expect(roots[0]!.children).toEqual([])
  })

  it('terminates on a parent cycle and keeps both tasks', () => {
    const roots = build([task('a', { parent: 'b' }), task('b', { parent: 'a' })])
    expect(flattenTree(roots)).toHaveLength(2)
  })
})

describe('flattenTree', () => {
  it('walks depth first', () => {
    const roots = build([task('a'), task('a1', { parent: 'a' }), task('b')])
    expect(ids(flattenTree(roots))).toEqual(['a', 'a1', 'b'])
  })

  it('hides descendants of a collapsed node', () => {
    const roots = build([task('a'), task('a1', { parent: 'a' }), task('b')])
    expect(ids(flattenTree(roots, new Set(['a'])))).toEqual(['a', 'b'])
  })
})

describe('progressOf', () => {
  it('counts descendants, not the node itself', () => {
    const roots = build([
      task('p', { status: 'completed' }),
      task('c1', { parent: 'p', status: 'completed' }),
      task('c2', { parent: 'p' }),
    ])
    expect(progressOf(roots[0]!)).toEqual({ done: 1, total: 2 })
  })

  it('reports zero for a leaf', () => {
    expect(progressOf(build([task('solo')])[0]!)).toEqual({ done: 0, total: 0 })
  })
})
