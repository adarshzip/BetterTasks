import { describe, it, expect } from 'vitest'
import { groupTasks } from './grouping'
import { toTask } from './tree'
import type { GTask, GTaskList } from './types'

const NOW = new Date(2026, 8, 2) // 2 Sep 2026
const LISTS: GTaskList[] = [{ id: 'l1', title: 'MATH 458' }]

const at = (days: number) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

const task = (id: string, extra: Partial<GTask> = {}): GTask => ({
  id,
  title: id,
  position: '00000000000000000000',
  status: 'needsAction',
  ...extra,
})

const group = (raws: GTask[], mode: 'due' | 'category' = 'due') =>
  groupTasks(raws.map((r) => toTask(r, 'l1')), LISTS, mode, NOW)

describe('groupTasks keeps trees intact', () => {
  // The bug this whole project exists to fix: a subtask rendering flat because
  // it landed in a different bucket from its parent.
  it('does not split a parent and child across due buckets', () => {
    const { urgent, groups } = group([
      task('project', { due: at(30) }),
      task('step', { parent: 'project', due: at(3) }),
    ])

    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.nodes[0]!.raw.id).toBe('project')
    expect(groups[0]!.nodes[0]!.children[0]!.raw.id).toBe('step')
    expect(groups[0]!.nodes[0]!.children[0]!.depth).toBe(1)
  })

  it('buckets a tree by its soonest due date, not the parent’s', () => {
    const { groups } = group([
      task('project', { due: at(30) }),
      task('step', { parent: 'project', due: at(3) }),
    ])
    expect(groups[0]!.label).toBe('This week')
  })

  it('lifts a whole tree into urgent when any node is due today', () => {
    const { urgent, groups } = group([
      task('project', { due: at(30) }),
      task('step', { parent: 'project', due: at(0) }),
    ])

    expect(groups).toHaveLength(0)
    expect(urgent).toHaveLength(1)
    expect(urgent[0]!.children[0]!.raw.id).toBe('step')
  })

  it('keeps a tree together in category view', () => {
    const { groups } = group(
      [task('project', { due: at(30) }), task('step', { parent: 'project', due: at(20) })],
      'category',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('MATH 458')
    expect(groups[0]!.nodes[0]!.children).toHaveLength(1)
  })

  it('keeps an undated subtask attached to its dated parent', () => {
    const { groups } = group([task('project', { due: at(3) }), task('step', { parent: 'project' })])
    expect(groups[0]!.label).toBe('This week')
    expect(groups[0]!.nodes[0]!.children).toHaveLength(1)
  })

  it('promotes a subtask whose parent is completed', () => {
    const { groups } = group([
      task('project', { status: 'completed', due: at(3) }),
      task('step', { parent: 'project', due: at(3) }),
    ])
    expect(groups[0]!.nodes.map((n) => n.raw.id)).toEqual(['step'])
    expect(groups[0]!.nodes[0]!.depth).toBe(0)
  })

  it('hides a deferred task', () => {
    const { urgent, groups } = group([task('later', { due: at(3), notes: '⟦bt⟧{"defer":"2026-09-20"}' })])
    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(0)
  })
})
