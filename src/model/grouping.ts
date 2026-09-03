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

/** Hidden until its defer date arrives. Keeps a month-out project out of today. */
export function isDeferred(task: Task, now = new Date()): boolean {
  if (!task.meta.defer) return false
  const [y, m, d] = task.meta.defer.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d) > startOfDay(now)
}

/** Overdue or due today. */
export function isUrgent(task: Task, now = new Date()): boolean {
  if (!task.due || task.completed) return false
  return task.due <= endOfDay(now)
}

/**
 * Groups tasks for display.
 *
 * The ordering constraint that matters: the tree is built ONCE across every
 * task, and only whole trees are assigned to groups. Bucketing individual
 * tasks and building a tree per bucket looks equivalent and is not. A parent
 * due in a month and its subtask due this week land in different buckets, and
 * the subtask then has no parent inside its own bucket, so it renders as a
 * flat root. That is exactly the native sidebar's bug.
 *
 * A tree's bucket therefore comes from the earliest due date anywhere in it,
 * so a project inherits the urgency of its soonest piece and the hierarchy
 * stays intact.
 */
export function groupTasks(
  tasks: Task[],
  lists: GTaskList[],
  mode: ViewMode,
  now = new Date(),
): { urgent: TaskNode[]; groups: Group[] } {
  const listTitles = new Map(lists.map((l) => [l.id, l.title ?? 'Untitled']))
  const visible = tasks.filter((t) => !t.completed && !isDeferred(t, now))

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
    .map(([key, bucket]) => ({ key, label: bucket.label, nodes: bucket.nodes }))
    .sort((a, b) => (mode === 'due' ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label)))

  return { urgent, groups }
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
