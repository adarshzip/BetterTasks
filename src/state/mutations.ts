import type { GTask, WireTask } from '@/model/types'

/**
 * Pure optimistic mutation logic.
 *
 * The Tasks API takes several hundred milliseconds per call, so the UI applies
 * every change locally first and reconciles later. That makes these functions
 * the place where a bug shows up as data that silently disagrees with Google,
 * which is why they are pure and separately tested.
 *
 * Positions are opaque zero-padded strings from Google. We cannot invent a
 * value "between" two of them, so any reorder re-sequences the affected
 * siblings from their index. The server's real positions replace ours on the
 * next load.
 */

export type Mutation =
  | { type: 'create'; task: WireTask }
  | { type: 'patch'; id: string; patch: Partial<GTask> }
  | { type: 'delete'; id: string }
  | { type: 'move'; id: string; parent: string | null; previous: string | null }

const POSITION_WIDTH = 20

export function positionAt(index: number): string {
  return String(index).padStart(POSITION_WIDTH, '0')
}

/**
 * Sorts after any real position.
 *
 * Google's positions are zero-padded digit strings, so any non-digit above '9'
 * sorts last. Used for an optimistic insert that should land at the end of its
 * sibling group; `resequence` renumbers it properly straight afterwards.
 */
export const LAST_POSITION = '~'.repeat(POSITION_WIDTH)

/** Applies a mutation to the task array, returning a new array. */
export function applyMutation(tasks: WireTask[], mutation: Mutation): WireTask[] {
  switch (mutation.type) {
    case 'create':
      return resequence([...tasks, mutation.task], mutation.task.listId)

    case 'patch':
      return tasks.map((t) => (t.id === mutation.id ? { ...t, ...mutation.patch } : t))

    case 'delete': {
      const target = tasks.find((t) => t.id === mutation.id)
      if (!target) return tasks
      // Deleting a parent deletes its children, which is what the API does.
      const doomed = new Set([mutation.id])
      for (const t of tasks) if (t.parent && doomed.has(t.parent)) doomed.add(t.id)
      return tasks.filter((t) => !doomed.has(t.id))
    }

    case 'move':
      return applyMove(tasks, mutation)
  }
}

function applyMove(tasks: WireTask[], mutation: Extract<Mutation, { type: 'move' }>): WireTask[] {
  const target = tasks.find((t) => t.id === mutation.id)
  if (!target) return tasks

  const moved: WireTask = { ...target }
  if (mutation.parent) moved.parent = mutation.parent
  else delete moved.parent

  const others = tasks.filter((t) => t.id !== mutation.id)
  const siblings = others
    .filter((t) => t.listId === moved.listId && (t.parent ?? null) === (moved.parent ?? null))
    .sort(byPosition)

  // `previous: null` means "first among siblings", matching the API.
  const index = mutation.previous ? siblings.findIndex((t) => t.id === mutation.previous) + 1 : 0

  const ordered = [...siblings]
  ordered.splice(index, 0, moved)

  const positions = new Map(ordered.map((t, i) => [t.id, positionAt(i)]))

  return [...others, moved].map((task) => {
    const position = positions.get(task.id)
    return position === undefined ? task : { ...task, position }
  })
}

const byPosition = (a: WireTask, b: WireTask): number =>
  (a.position ?? '').localeCompare(b.position ?? '')

/** Renumbers every sibling group in a list so local order is well defined. */
function resequence(tasks: WireTask[], listId: string): WireTask[] {
  const groups = new Map<string, WireTask[]>()

  for (const task of tasks) {
    if (task.listId !== listId) continue
    const key = task.parent ?? ''
    groups.set(key, [...(groups.get(key) ?? []), task])
  }

  const positions = new Map<string, string>()
  for (const group of groups.values()) {
    group
      .sort(byPosition)
      .forEach((task, i) => positions.set(task.id, positionAt(i)))
  }

  return tasks.map((t) => {
    const position = positions.get(t.id)
    return position === undefined ? t : { ...t, position }
  })
}

/**
 * Computes the mutation that undoes another, captured against the state before
 * it was applied. Returns null when there is nothing meaningful to undo.
 *
 * Undoing a delete recreates the task rather than restoring it: the API has no
 * trash, so the restored task necessarily gets a new id.
 */
export function inverseOf(before: WireTask[], mutation: Mutation): Mutation | null {
  switch (mutation.type) {
    case 'create':
      return { type: 'delete', id: mutation.task.id }

    case 'patch': {
      const target = before.find((t) => t.id === mutation.id)
      if (!target) return null

      // Restore exactly the fields the patch touched, including ones that were
      // absent: `undefined` here means "clear it again".
      const patch: Partial<GTask> = {}
      for (const key of Object.keys(mutation.patch) as (keyof GTask)[]) {
        patch[key] = target[key] as never
      }
      return { type: 'patch', id: mutation.id, patch }
    }

    case 'delete': {
      const target = before.find((t) => t.id === mutation.id)
      return target ? { type: 'create', task: target } : null
    }

    case 'move': {
      const target = before.find((t) => t.id === mutation.id)
      if (!target) return null

      const siblings = before
        .filter(
          (t) =>
            t.listId === target.listId &&
            (t.parent ?? null) === (target.parent ?? null) &&
            t.id !== target.id,
        )
        .sort(byPosition)

      const originalIndex = before
        .filter((t) => t.listId === target.listId && (t.parent ?? null) === (target.parent ?? null))
        .sort(byPosition)
        .findIndex((t) => t.id === target.id)

      return {
        type: 'move',
        id: mutation.id,
        parent: target.parent ?? null,
        previous: originalIndex > 0 ? (siblings[originalIndex - 1]?.id ?? null) : null,
      }
    }
  }
}

/**
 * Google Tasks allows exactly one level of nesting, so a task can only be
 * indented under a top-level sibling, and only if it has no children itself.
 * Checking here means the UI can disable the action rather than letting the
 * API reject it after the optimistic update has already landed.
 */
export function indentTarget(tasks: WireTask[], id: string): string | null {
  const task = tasks.find((t) => t.id === id)
  if (!task || task.parent) return null
  if (tasks.some((t) => t.parent === id)) return null

  const siblings = tasks
    .filter((t) => t.listId === task.listId && !t.parent)
    .sort(byPosition)

  const index = siblings.findIndex((t) => t.id === id)
  return index > 0 ? (siblings[index - 1]?.id ?? null) : null
}

export function canOutdent(tasks: WireTask[], id: string): boolean {
  return !!tasks.find((t) => t.id === id)?.parent
}

/** The sibling a task would sit after when moved one step up or down. */
export function neighbourFor(
  tasks: WireTask[],
  id: string,
  direction: 'up' | 'down',
): { previous: string | null } | null {
  const task = tasks.find((t) => t.id === id)
  if (!task) return null

  const siblings = tasks
    .filter((t) => t.listId === task.listId && (t.parent ?? null) === (task.parent ?? null))
    .sort(byPosition)

  const index = siblings.findIndex((t) => t.id === id)
  if (index === -1) return null

  if (direction === 'up') {
    if (index === 0) return null
    // Land after whatever preceded the task we are jumping over.
    return { previous: index >= 2 ? (siblings[index - 2]?.id ?? null) : null }
  }

  if (index >= siblings.length - 1) return null
  return { previous: siblings[index + 1]?.id ?? null }
}
