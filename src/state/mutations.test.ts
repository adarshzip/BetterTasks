import { describe, it, expect } from 'vitest'
import {
  applyMutation,
  canOutdent,
  indentTarget,
  inverseOf,
  neighbourFor,
  positionAt,
  type Mutation,
} from './mutations'
import type { WireTask } from '@/model/types'

const t = (id: string, extra: Partial<WireTask> = {}): WireTask => ({
  id,
  title: id,
  listId: 'l1',
  status: 'needsAction',
  position: positionAt(0),
  ...extra,
})

/** Three top-level tasks in a known order. */
const flat = (): WireTask[] => [
  t('a', { position: positionAt(0) }),
  t('b', { position: positionAt(1) }),
  t('c', { position: positionAt(2) }),
]

const order = (tasks: WireTask[], parent: string | null = null) =>
  tasks
    .filter((x) => (x.parent ?? null) === parent)
    .sort((x, y) => (x.position ?? '').localeCompare(y.position ?? ''))
    .map((x) => x.id)

describe('applyMutation', () => {
  it('creates a task', () => {
    const next = applyMutation(flat(), { type: 'create', task: t('d', { position: positionAt(9) }) })
    expect(order(next)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('patches only the named task', () => {
    const next = applyMutation(flat(), { type: 'patch', id: 'b', patch: { title: 'renamed' } })
    expect(next.find((x) => x.id === 'b')?.title).toBe('renamed')
    expect(next.find((x) => x.id === 'a')?.title).toBe('a')
  })

  it('deletes a task', () => {
    expect(order(applyMutation(flat(), { type: 'delete', id: 'b' }))).toEqual(['a', 'c'])
  })

  // Matches the API: deleting a parent takes its children with it.
  it('deletes children along with their parent', () => {
    const tasks = [...flat(), t('a1', { parent: 'a' })]
    const next = applyMutation(tasks, { type: 'delete', id: 'a' })
    expect(next.map((x) => x.id).sort()).toEqual(['b', 'c'])
  })

  it('ignores a delete for an unknown id', () => {
    expect(applyMutation(flat(), { type: 'delete', id: 'nope' })).toHaveLength(3)
  })
})

describe('move', () => {
  it('reorders within a sibling group', () => {
    const next = applyMutation(flat(), { type: 'move', id: 'c', parent: null, previous: 'a' })
    expect(order(next)).toEqual(['a', 'c', 'b'])
  })

  it('moves to the front when previous is null', () => {
    const next = applyMutation(flat(), { type: 'move', id: 'c', parent: null, previous: null })
    expect(order(next)).toEqual(['c', 'a', 'b'])
  })

  it('reparents a task', () => {
    const next = applyMutation(flat(), { type: 'move', id: 'b', parent: 'a', previous: null })
    expect(next.find((x) => x.id === 'b')?.parent).toBe('a')
    expect(order(next)).toEqual(['a', 'c'])
    expect(order(next, 'a')).toEqual(['b'])
  })

  it('clears the parent when outdenting', () => {
    const tasks = [t('a'), t('a1', { parent: 'a' })]
    const next = applyMutation(tasks, { type: 'move', id: 'a1', parent: null, previous: 'a' })
    expect(next.find((x) => x.id === 'a1')?.parent).toBeUndefined()
  })

  it('never loses a task', () => {
    const next = applyMutation(flat(), { type: 'move', id: 'a', parent: null, previous: 'c' })
    expect(next).toHaveLength(3)
    expect(order(next)).toEqual(['b', 'c', 'a'])
  })
})

describe('inverseOf', () => {
  it('undoes a create with a delete', () => {
    const task = t('d')
    expect(inverseOf(flat(), { type: 'create', task })).toEqual({ type: 'delete', id: 'd' })
  })

  it('undoes a delete by recreating the task', () => {
    const before = flat()
    const inverse = inverseOf(before, { type: 'delete', id: 'b' })
    expect(inverse).toEqual({ type: 'create', task: before.find((x) => x.id === 'b') })
  })

  it('restores the previous value of every patched field', () => {
    const before = [t('a', { title: 'original', notes: 'keep' })]
    const mutation: Mutation = { type: 'patch', id: 'a', patch: { title: 'changed' } }
    const after = applyMutation(before, mutation)
    const restored = applyMutation(after, inverseOf(before, mutation)!)
    expect(restored[0]!.title).toBe('original')
    expect(restored[0]!.notes).toBe('keep')
  })

  // A field that was absent must go back to absent, not linger as a value.
  it('clears a field that had no previous value', () => {
    const before = [t('a')]
    const mutation: Mutation = { type: 'patch', id: 'a', patch: { due: '2026-09-04T00:00:00.000Z' } }
    const after = applyMutation(before, mutation)
    const restored = applyMutation(after, inverseOf(before, mutation)!)
    expect(restored[0]!.due).toBeUndefined()
  })

  it('returns a task to its original position', () => {
    const before = flat()
    const mutation: Mutation = { type: 'move', id: 'a', parent: null, previous: 'c' }
    const after = applyMutation(before, mutation)
    expect(order(after)).toEqual(['b', 'c', 'a'])

    const restored = applyMutation(after, inverseOf(before, mutation)!)
    expect(order(restored)).toEqual(['a', 'b', 'c'])
  })

  it('returns an outdented task to its parent', () => {
    const before = [t('a'), t('a1', { parent: 'a' })]
    const mutation: Mutation = { type: 'move', id: 'a1', parent: null, previous: 'a' }
    const after = applyMutation(before, mutation)
    const restored = applyMutation(after, inverseOf(before, mutation)!)
    expect(restored.find((x) => x.id === 'a1')?.parent).toBe('a')
  })

  it('returns null when the task is gone', () => {
    expect(inverseOf([], { type: 'delete', id: 'ghost' })).toBeNull()
  })
})

describe('indent and outdent rules', () => {
  it('indents under the preceding sibling', () => {
    expect(indentTarget(flat(), 'b')).toBe('a')
  })

  it('refuses to indent the first task', () => {
    expect(indentTarget(flat(), 'a')).toBeNull()
  })

  // Google Tasks allows exactly one level. A grandchild is rejected by the API,
  // so the UI must not offer it.
  it('refuses to indent past one level', () => {
    const tasks = [t('a'), t('b', { parent: 'a', position: positionAt(0) }), t('c', { parent: 'a', position: positionAt(1) })]
    expect(indentTarget(tasks, 'c')).toBeNull()
  })

  it('refuses to indent a task that has children', () => {
    const tasks = [t('a', { position: positionAt(0) }), t('b', { position: positionAt(1) }), t('b1', { parent: 'b' })]
    expect(indentTarget(tasks, 'b')).toBeNull()
  })

  it('allows outdent only for a child', () => {
    const tasks = [t('a'), t('a1', { parent: 'a' })]
    expect(canOutdent(tasks, 'a1')).toBe(true)
    expect(canOutdent(tasks, 'a')).toBe(false)
  })
})

describe('neighbourFor', () => {
  it('moves down past the next sibling', () => {
    const next = applyMutation(flat(), {
      type: 'move',
      id: 'a',
      parent: null,
      ...neighbourFor(flat(), 'a', 'down')!,
    })
    expect(order(next)).toEqual(['b', 'a', 'c'])
  })

  it('moves up past the previous sibling', () => {
    const next = applyMutation(flat(), {
      type: 'move',
      id: 'c',
      parent: null,
      ...neighbourFor(flat(), 'c', 'up')!,
    })
    expect(order(next)).toEqual(['a', 'c', 'b'])
  })

  it('refuses to move beyond either end', () => {
    expect(neighbourFor(flat(), 'a', 'up')).toBeNull()
    expect(neighbourFor(flat(), 'c', 'down')).toBeNull()
  })
})
