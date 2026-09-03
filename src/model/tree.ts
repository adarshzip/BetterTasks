import type { GTask, Task, TaskNode } from './types'
import { decodeNotes } from './metadata'

/**
 * Tree builder.
 *
 * Google Tasks stores hierarchy as a flat list where each task carries a
 * `parent` id and a lexicographically sortable `position` string. The native
 * Calendar sidebar renders this flat, which is the whole reason this project
 * exists. This module turns it back into a tree.
 *
 * Like the metadata codec, every function here is total. Bad server data
 * degrades the display; it never drops a task on the floor.
 */

/** Normalizes one API task into our internal shape. */
export function toTask(raw: GTask, listId: string): Task {
  const { body, meta } = decodeNotes(raw.notes)
  return {
    raw,
    listId,
    title: raw.title?.trim() ?? '',
    notes: body,
    meta,
    due: parseDue(raw.due, meta.time),
    completed: raw.status === 'completed',
    parent: raw.parent ?? null,
    position: raw.position ?? '',
  }
}

/**
 * Due values are calendar dates, not instants. The API returns them as UTC
 * midnight and discards any time component (confirmed in docs/SPIKES.md), so
 * reading one directly in a timezone behind UTC lands on the previous
 * evening: a task due Sep 4 displays as Sep 3.
 *
 * We therefore read the UTC year, month, and day and rebuild the date in local
 * time, applying the time we stashed in metadata if there is one.
 */
function parseDue(due: string | undefined, time: string | undefined): Date | null {
  if (!due) return null
  const parsed = new Date(due)
  if (Number.isNaN(parsed.getTime())) return null

  const [hours, minutes] = time ? time.split(':').map(Number) : []

  return new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    hours ?? 0,
    minutes ?? 0,
  )
}

/**
 * Builds a forest from a flat task array.
 *
 * A task whose `parent` is not present in the input is treated as a root. That
 * happens routinely: completing a parent hides it, and Google returns the
 * children anyway. Silently dropping them would lose real work.
 */
export function buildTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>()
  for (const task of tasks) {
    nodes.set(task.raw.id, { ...task, children: [], depth: 0 })
  }

  const roots: TaskNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parent ? nodes.get(node.parent) : undefined
    // A task cannot parent itself, and an absent parent means orphan -> root.
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  breakCycles(roots, nodes)
  sortRecursive(roots, 0)
  return roots
}

/**
 * Guards against a parent chain that loops. This should be impossible from the
 * API, but a cycle would recurse forever in the renderer, so it is worth the
 * cheap check. Any node not reachable from a root is promoted to a root, and
 * the back-edge that closed the cycle is severed so no node appears twice.
 */
function breakCycles(roots: TaskNode[], nodes: Map<string, TaskNode>): void {
  const reachable = new Set<TaskNode>()

  // Marks a subtree as reachable, cutting any edge back into it.
  const claim = (node: TaskNode): void => {
    reachable.add(node)
    node.children = node.children.filter((child) => !reachable.has(child))
    for (const child of node.children) claim(child)
  }

  for (const root of roots) claim(root)

  for (const node of nodes.values()) {
    if (reachable.has(node)) continue
    roots.push(node)
    claim(node)
  }
}

/**
 * Orders siblings by `position`, which Google zero-pads for exactly this.
 * Ties fall back to id so the order is stable across renders rather than
 * shuffling on every fetch.
 */
function sortRecursive(nodes: TaskNode[], depth: number): void {
  nodes.sort((a, b) => {
    const byPosition = a.position.localeCompare(b.position)
    return byPosition !== 0 ? byPosition : a.raw.id.localeCompare(b.raw.id)
  })
  for (const node of nodes) {
    node.depth = depth
    sortRecursive(node.children, depth + 1)
  }
}

/** Depth-first flatten, honouring a set of collapsed parent ids. */
export function flattenTree(roots: TaskNode[], collapsed: ReadonlySet<string> = new Set()): TaskNode[] {
  const out: TaskNode[] = []
  const visit = (nodes: TaskNode[]): void => {
    for (const node of nodes) {
      out.push(node)
      if (!collapsed.has(node.raw.id)) visit(node.children)
    }
  }
  visit(roots)
  return out
}

/** Completed-versus-total across a node's descendants, for the progress rollup. */
export function progressOf(node: TaskNode): { done: number; total: number } {
  let done = 0
  let total = 0
  const visit = (nodes: TaskNode[]): void => {
    for (const child of nodes) {
      total += 1
      if (child.completed) done += 1
      visit(child.children)
    }
  }
  visit(node.children)
  return { done, total }
}
