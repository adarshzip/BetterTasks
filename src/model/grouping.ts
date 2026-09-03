import type { GTaskList, Task, TaskNode } from './types'
import { buildTree } from './tree'

export type ViewMode = 'due' | 'category'

export interface Group {
  key: string
  label: string
  nodes: TaskNode[]
}

/**
 * A task's category is its list, since one list per class is the intended
 * setup. An explicit `cat` in metadata overrides that, which matters for
 * single-list users and for tasks that outlive a class.
 */
export function categoryOf(task: Task, listTitles: Map<string, string>): string {
  return task.meta.cat ?? listTitles.get(task.listId) ?? 'Other'
}

/**
 * Every category currently in use, for the picker.
 *
 * A category is normally the task's list, which suits one-list-per-class. But
 * a single list with a category tag per task works too, and is less setup, so
 * both sources are offered together.
 */
export function knownCategories(tasks: Task[], lists: GTaskList[]): string[] {
  const seen = new Set<string>()
  for (const list of lists) if (list.title) seen.add(list.title)
  for (const task of tasks) if (task.meta.cat) seen.add(task.meta.cat)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Resolves every node's category, with subtasks inheriting from their parent.
 *
 * A subtask of a MATH 458 project is MATH 458 work, so it should be findable
 * by class and labelled as such without tagging it by hand. Resolved at
 * display time rather than written to the task, so re-parenting a subtask or
 * changing the parent's class updates the child with no writes.
 */
export function resolveCategories(
  roots: TaskNode[],
  listTitles: Map<string, string>,
): Map<string, string> {
  const resolved = new Map<string, string>()

  const visit = (nodes: TaskNode[], inherited: string | null): void => {
    for (const node of nodes) {
      // An explicit class always wins over an inherited one.
      const category = node.meta.cat ?? inherited ?? listTitles.get(node.listId) ?? 'Other'
      resolved.set(node.raw.id, category)
      visit(node.children, category)
    }
  }

  visit(roots, null)
  return resolved
}

/** Hidden until its defer date arrives. Keeps a month-out project out of today. */
export function isDeferred(task: Task, now = new Date()): boolean {
  if (!task.meta.defer) return false
  const [y, m, d] = task.meta.defer.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d) > startOfDay(now)
}

/**
 * Overdue or due today. Completed tasks are not excluded here: a task that is
 * completed but still lingering should stay in the group it was in, crossed
 * out, rather than jumping somewhere else.
 */
export function isUrgent(task: Task, now = new Date()): boolean {
  if (!task.due) return false
  return task.due <= endOfDay(now)
}

/**
 * Whether a task has been deliberately categorised.
 *
 * Two setups both count, because both are supported: an explicit class in the
 * metadata, or living in a list other than the default one, which is what
 * one-list-per-class looks like. A task sitting untagged in the default list
 * has not been categorised.
 */
export function isCategorised(task: Task, defaultListId?: string): boolean {
  if (task.meta.cat) return true
  return !!defaultListId && task.listId !== defaultListId
}

/**
 * Whether a completed task stays in the main list rather than moving to the
 * Completed section.
 *
 * Two conditions, both required. It must have a due date that has not passed,
 * so you can confirm the thing due Friday is already done without opening a
 * history screen. And it must belong to a class, because the confirmation is
 * only worth the clutter for coursework: an uncategorised errand leaves the
 * list the moment it is ticked off.
 *
 * The caller adds a third condition: this only applies in the class view. The
 * due view answers "what is left to do", and finished work has no place in
 * that answer.
 */
export function lingers(
  task: Task,
  now = new Date(),
  options: { defaultListId?: string } = {},
): boolean {
  if (!task.completed || !task.due) return false
  if (!isCategorised(task, options.defaultListId)) return false
  return endOfDay(task.due) >= now
}

export function groupTasks(
  tasks: Task[],
  lists: GTaskList[],
  mode: ViewMode,
  now = new Date(),
): { urgent: TaskNode[]; groups: Group[]; deferred: TaskNode[] } {
  const listTitles = new Map(lists.map((l) => [l.id, l.title ?? 'Untitled']))
  // Completed tasks linger in the class view only, and only when categorised
  // and not yet past due. The due view is strictly what is still outstanding.
  const defaultListId = lists[0]?.id
  const keepCompleted = mode === 'category'
  const active = tasks.filter(
    (t) =>
      !t.completed ||
      (keepCompleted && lingers(t, now, { ...(defaultListId ? { defaultListId } : {}) })),
  )

  // Deferred tasks are returned rather than dropped. Hiding them with no way
  // to see them again is a trapdoor: you cannot clear a start date on a task
  // you cannot reach.
  const visible = active.filter((t) => !isDeferred(t, now))
  const deferred = buildTree(active.filter((t) => isDeferred(t, now)))

  // Built across everything, so a child never loses its parent to a bucket.
  // A child whose parent was filtered out becomes a root, which is correct.
  const roots = buildTree(visible)

  const urgent: TaskNode[] = []
  const buckets = new Map<string, { label: string; nodes: TaskNode[] }>()

  for (const root of roots) {
    if (containsUrgent(root, now)) {
      urgent.push(root)
      continue
    }

    const { key, label } =
      mode === 'category'
        ? categoryKey(root, listTitles)
        : dueBucket(earliestDue(root), now)

    const bucket = buckets.get(key) ?? { label, nodes: [] }
    bucket.nodes.push(root)
    buckets.set(key, bucket)
  }

  const groups = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      // Inside a bucket, order by when things are actually due. Manual order
      // is only a tiebreaker: a view organised by due date that lists Friday
      // above Monday is answering the wrong question.
      nodes: sortByDue(bucket.nodes),
    }))
    .sort((a, b) => (mode === 'due' ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label)))

  return { urgent: sortByDue(urgent), groups, deferred: sortByDue(deferred) }
}

/** Earliest due first, undated last, manual order as the tiebreaker. */
function sortByDue(nodes: TaskNode[]): TaskNode[] {
  return [...nodes].sort((a, b) => {
    const aDue = earliestDue(a)
    const bDue = earliestDue(b)
    if (aDue && bDue && aDue.getTime() !== bDue.getTime()) {
      return aDue.getTime() - bDue.getTime()
    }
    if (aDue && !bDue) return -1
    if (!aDue && bDue) return 1
    return a.position.localeCompare(b.position)
  })
}

/**
 * Matches a task against a search query, across title, notes, and class.
 * Case-insensitive, and every term must appear somewhere.
 */
export function matchesQuery(task: Task, query: string, listTitles: Map<string, string>): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const haystack = [task.title, task.notes, categoryOf(task, listTitles)]
    .join(' ')
    .toLowerCase()

  return terms.every((term) => haystack.includes(term))
}

/** A tree is urgent if anything in it is, so today's subtask surfaces the project. */
function containsUrgent(node: TaskNode, now: Date): boolean {
  return isUrgent(node, now) || node.children.some((child) => containsUrgent(child, now))
}

/** The soonest due date anywhere in the tree, or null if nothing is dated. */
function earliestDue(node: TaskNode): Date | null {
  let earliest = node.due
  for (const child of node.children) {
    const childDue = earliestDue(child)
    if (childDue && (!earliest || childDue < earliest)) earliest = childDue
  }
  return earliest
}

/** A parent's category wins for the whole tree, so a project stays in one place. */
function categoryKey(root: TaskNode, listTitles: Map<string, string>): { key: string; label: string } {
  const category = categoryOf(root, listTitles)
  return { key: category, label: category }
}

/** Keys are sortable so bucket order falls out of a plain string sort. */
function dueBucket(due: Date | null, now: Date): { key: string; label: string } {
  if (!due) return { key: '4-someday', label: 'No due date' }

  const days = Math.floor((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000)
  if (days <= 7) return { key: '1-week', label: 'This week' }
  if (days <= 14) return { key: '2-next', label: 'Next week' }
  return { key: '3-later', label: 'Later' }
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

/**
 * Stable colour per category, deterministic from the name so a class keeps its
 * colour across reloads. Phase 4 replaces this with colours read from the
 * matching calendar events.
 */
const PALETTE = ['#8ab4f8', '#81c995', '#fdd663', '#f28b82', '#c58af9', '#78d9ec', '#fcad70']

export function colorFor(category: string): string {
  let hash = 0
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]!
}
