import { describe, it, expect } from 'vitest'
import { groupTasks, matchesQuery, type ViewMode } from './grouping'
import { toTask } from './tree'
import { positionAt } from '@/state/mutations'
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

const group = (raws: GTask[], mode: ViewMode = 'due') =>
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

  it('promotes a subtask whose parent has dropped out of the list', () => {
    const { groups } = group([
      // Completed, so it is gone from the due view entirely.
      task('project', { status: 'completed', due: at(-2) }),
      task('step', { parent: 'project', due: at(3) }),
    ])
    expect(groups[0]!.nodes.map((n) => n.raw.id)).toEqual(['step'])
    expect(groups[0]!.nodes[0]!.depth).toBe(0)
  })

  // Deferring used to hide a task with no way to reach it again, so its start
  // date could never be cleared.
  it('moves a deferred task aside rather than hiding it', () => {
    const { urgent, groups, deferred } = group([
      task('later', { due: at(3), notes: '⟦bt⟧{"defer":"2026-09-20"}' }),
    ])
    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(0)
    expect(deferred.map((n) => n.raw.id)).toEqual(['later'])
  })
})

describe('ordering within a bucket', () => {
  // A view organised by due date that lists Friday above Monday is answering
  // the wrong question, however the tasks were ordered by hand.
  it('sorts by due date, not manual position', () => {
    const { groups } = group([
      task('friday', { due: at(4), position: positionAt(0) }),
      task('monday', { due: at(2), position: positionAt(1) }),
    ])
    expect(groups[0]!.nodes.map((n) => n.raw.id)).toEqual(['monday', 'friday'])
  })

  // The due view gives undated tasks their own bucket, so they only sit
  // alongside dated ones in the class view.
  it('puts undated tasks last within a class', () => {
    const { groups } = group([task('someday'), task('dated', { due: at(20) })], 'category')
    expect(groups[0]!.nodes.map((n) => n.raw.id)).toEqual(['dated', 'someday'])
  })

  it('falls back to manual order for equal due dates', () => {
    const { groups } = group([
      task('second', { due: at(3), position: positionAt(1) }),
      task('first', { due: at(3), position: positionAt(0) }),
    ])
    expect(groups[0]!.nodes.map((n) => n.raw.id)).toEqual(['first', 'second'])
  })

  // A project inherits the urgency of its soonest piece, so it must sort by
  // that too, not by its own distant due date.
  it('sorts a parent by its soonest subtask', () => {
    const { groups } = group([
      task('soon', { due: at(3) }),
      task('project', { due: at(6) }),
      task('step', { parent: 'project', due: at(2) }),
    ])
    expect(groups[0]!.nodes.map((n) => n.raw.id)).toEqual(['project', 'soon'])
  })
})

describe('the today view', () => {
  it('shows only what is already due', () => {
    const { urgent, groups } = group(
      [task('now', { due: at(0) }), task('later', { due: at(5) })],
      'today',
    )
    expect(urgent.map((n) => n.raw.id)).toEqual(['now'])
    // Nothing is bucketed: today is a single answer, not an organisation.
    expect(groups).toHaveLength(0)
  })

  it('includes overdue work', () => {
    const { urgent } = group([task('late', { due: at(-3) })], 'today')
    expect(urgent.map((n) => n.raw.id)).toEqual(['late'])
  })
})

describe('remainingEffort', () => {
  it('sums estimates across a group', () => {
    const { groups } = group([
      task('a', { due: at(3), notes: '⟦bt⟧{"eff":30}' }),
      task('b', { due: at(3), notes: '⟦bt⟧{"eff":90}' }),
    ])
    expect(groups[0]!.effort).toBe(120)
  })

  it('counts subtasks', () => {
    const { groups } = group([
      task('parent', { due: at(3), notes: '⟦bt⟧{"eff":30}' }),
      task('child', { parent: 'parent', due: at(3), notes: '⟦bt⟧{"eff":15}' }),
    ])
    expect(groups[0]!.effort).toBe(45)
  })

  // The number answers "how much is left", so finished work must not inflate it.
  it('ignores completed tasks', () => {
    const { groups } = group(
      [
        task('done', {
          status: 'completed',
          due: at(3),
          notes: '⟦bt⟧{"cat":"MATH 458","eff":60}',
        }),
        task('todo', { due: at(3), notes: '⟦bt⟧{"cat":"MATH 458","eff":30}' }),
      ],
      'category',
    )
    expect(groups[0]!.effort).toBe(30)
  })

  it('is zero when nothing is estimated', () => {
    const { groups } = group([task('a', { due: at(3) })])
    expect(groups[0]!.effort).toBe(0)
  })
})

describe('matchesQuery', () => {
  const titles = new Map([['l1', 'MATH 458']])
  const of = (raw: GTask) => toTask(raw, 'l1')

  it('matches an empty query', () => {
    expect(matchesQuery(of(task('a')), '', titles)).toBe(true)
  })

  it('matches on title, case-insensitively', () => {
    expect(matchesQuery(of(task('Problem Set')), 'problem', titles)).toBe(true)
  })

  it('matches on notes and class', () => {
    expect(matchesQuery(of(task('a', { notes: 'read chapter 4' })), 'chapter', titles)).toBe(true)
    expect(matchesQuery(of(task('a')), 'math', titles)).toBe(true)
  })

  it('requires every term to match', () => {
    const t = of(task('Problem Set 4'))
    expect(matchesQuery(t, 'problem 4', titles)).toBe(true)
    expect(matchesQuery(t, 'problem essay', titles)).toBe(false)
  })

  it('does not match the metadata block itself', () => {
    const t = of(task('a', { notes: 'body\n\n⟦bt⟧{"eff":90}' }))
    expect(matchesQuery(t, 'eff', titles)).toBe(false)
  })
})

describe('completed tasks linger in the class view', () => {
  // Lingering requires a category. These tasks carry one explicitly.
  const done = (id: string, extra: Partial<GTask> = {}) =>
    task(id, { status: 'completed', notes: '⟦bt⟧{"cat":"MATH 458"}', ...extra })

  const inClassView = (raws: GTask[]) => group(raws, 'category')

  it('keeps a completed task due in the future', () => {
    const { groups } = inClassView([done('early', { due: at(3) })])
    expect(groups[0]?.nodes.map((n) => n.raw.id)).toEqual(['early'])
    expect(groups[0]?.nodes[0]?.completed).toBe(true)
  })

  it('keeps a task due today for the rest of the day', () => {
    const { urgent } = inClassView([done('todayish', { due: at(0) })])
    expect(urgent.map((n) => n.raw.id)).toEqual(['todayish'])
  })

  it('drops a completed task once its due date has passed', () => {
    const { urgent, groups } = inClassView([done('stale', { due: at(-2) })])
    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(0)
  })

  // The due view answers "what is left to do", so finished work never appears.
  it('never shows a completed task in the due view', () => {
    const { urgent, groups } = group([done('early', { due: at(3) })], 'due')
    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(0)
  })

  // With no deadline there is nothing to reassure yourself about.
  it('hides an undated task as soon as it is completed', () => {
    const { urgent, groups } = inClassView([done('undated')])
    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(0)
  })

  // An untagged task in the default list was never categorised, so the
  // confirmation is not worth the clutter.
  it('hides a completed task that has no class', () => {
    const { urgent, groups } = inClassView([
      task('errand', { status: 'completed', due: at(3) }),
    ])
    expect(urgent).toHaveLength(0)
    expect(groups).toHaveLength(0)
  })

  // One list per class is the other supported setup, and counts as categorised.
  it('treats a non-default list as a category', () => {
    const lists: GTaskList[] = [
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'TAC 458' },
    ]
    const raw = task('lab', { status: 'completed', due: at(3) })
    const { groups } = groupTasks([toTask(raw, 'l2')], lists, 'category', NOW)
    expect(groups[0]?.nodes.map((n) => n.raw.id)).toEqual(['lab'])
  })

  it('keeps a lingering subtask under its parent', () => {
    const { groups } = inClassView([
      task('project', { due: at(5), notes: '⟦bt⟧{"cat":"MATH 458"}' }),
      done('step', { parent: 'project', due: at(3) }),
    ])
    expect(groups[0]?.nodes[0]?.children.map((n) => n.raw.id)).toEqual(['step'])
  })
})
