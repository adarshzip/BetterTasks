import type { GTask, Task, TaskNode } from './types'
import { decodeNotes } from './metadata'
import { stripClassPrefix } from './title'

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
    // The class is mirrored into the stored title so Google's own clients show
    // it; here it is rendered as a pill instead, so strip it back off.
    title: stripClassPrefix(raw.title ?? '', meta.cat),
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

export interface Progress {
  done: number
  total: number
}

/**
 * Completed-versus-total for every task with children, computed from the flat
 * list rather than the rendered tree.
 *
 * This has to come from the flat list because completed tasks are pruned
 * before the tree is built. Counting the tree's children made the rollup
 * useless: finishing a subtask removed it, so the denominator shrank with the
 * numerator and a three-part project went 0/3, 0/2, 0/1, gone.
 *
 * Only counts what has been loaded. Completed tasks are fetched lazily, so a
 * subtask finished months ago is missing until the Completed section is
 * opened. Recent completions are always present, which covers work in flight.
 */
export function progressByParent(tasks: Task[]): Map<string, Progress> {
  const children = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.parent) continue
    children.set(task.parent, [...(children.get(task.parent) ?? []), task])
  }

  const progress = new Map<string, Progress>()

  const measure = (id: string, seen: Set<string>): Progress => {
    const cached = progress.get(id)
    if (cached) return cached
    // Guards against a parent cycle, which buildTree also defends against.
    if (seen.has(id)) return { done: 0, total: 0 }
    seen.add(id)

    let done = 0
    let total = 0
    for (const child of children.get(id) ?? []) {
      total += 1
      if (child.completed) done += 1

      const nested = measure(child.raw.id, seen)
      done += nested.done
      total += nested.total
    }

    const result = { done, total }
    progress.set(id, result)
    return result
  }

  for (const id of children.keys()) measure(id, new Set())
  return progress
}
