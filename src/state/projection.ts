/**
 * Where a dragged task lands.
 *
 * Drag and drop in a tree is really two decisions: which row to sit after, and
 * at what depth. Vertical position gives the first, horizontal offset gives the
 * second. Keeping that logic here, as a pure function over a flattened row
 * list, is what makes it testable without simulating a pointer.
 *
 * Google Tasks allows exactly one level of nesting, so depth is clamped to 1
 * and a task that already has children can never be nested.
 */

export interface Row {
  id: string
  depth: number
  parentId: string | null
  hasChildren: boolean
}

export interface Drop {
  parent: string | null
  previous: string | null
}

export const MAX_DEPTH = 1

/**
 * @param rows      visible rows, in display order, including the dragged one
 * @param activeId  the row being dragged
 * @param overIndex the index it was dropped at, in the same coordinate space
 * @param offsetX   horizontal drag distance in pixels
 * @param indent    pixel width of one nesting level
 */
export function projectDrop(
  rows: Row[],
  activeId: string,
  overIndex: number,
  offsetX: number,
  indent: number,
): Drop | null {
  const active = rows.find((r) => r.id === activeId)
  if (!active) return null

  // Reason about the list as it will be once the dragged row is removed.
  const without = rows.filter((r) => r.id !== activeId)
  const clamped = Math.max(0, Math.min(overIndex, without.length))
  const above = clamped > 0 ? without[clamped - 1] : undefined

  const desired = active.depth + Math.round(offsetX / indent)
  const depth = clampDepth(desired, active, above)

  if (depth === 0) {
    // Sit after the nearest preceding top-level row, skipping over any
    // children of it so the task does not land in the middle of a subtree.
    for (let i = clamped - 1; i >= 0; i--) {
      const row = without[i]
      if (row && row.depth === 0) return { parent: null, previous: row.id }
    }
    return { parent: null, previous: null }
  }

  if (!above) return { parent: null, previous: null }

  // Depth 1: nest under the row above, or alongside it if it is already nested.
  return above.depth === 0
    ? { parent: above.id, previous: null }
    : { parent: above.parentId, previous: above.id }
}

function clampDepth(desired: number, active: Row, above: Row | undefined): number {
  // A task with children cannot be nested: that would make a grandchild.
  if (active.hasChildren) return 0

  // Nothing above means the top of the list, which is always top level.
  if (!above) return 0

  // You can only ever be one level deeper than the row above you.
  const max = Math.min(above.depth + 1, MAX_DEPTH)
  return Math.max(0, Math.min(desired, max))
}
