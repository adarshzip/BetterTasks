import { describe, it, expect } from 'vitest'
import { projectDrop, type Row } from './projection'

const INDENT = 20

const row = (id: string, depth = 0, parentId: string | null = null, hasChildren = false): Row => ({
  id,
  depth,
  parentId,
  hasChildren,
})

/** a, b (with child b1), c — all top level except b1. */
const rows: Row[] = [row('a'), row('b', 0, null, true), row('b1', 1, 'b'), row('c')]

describe('projectDrop', () => {
  it('drops at the top of the list', () => {
    expect(projectDrop(rows, 'c', 0, 0, INDENT)).toEqual({ parent: null, previous: null })
  })

  it('drops after the preceding top-level row', () => {
    expect(projectDrop(rows, 'c', 1, 0, INDENT)).toEqual({ parent: null, previous: 'a' })
  })

  // Landing inside a subtree must attach to the subtree's root, not to a child.
  it('skips over a subtree when landing at top level', () => {
    expect(projectDrop(rows, 'c', 2, 0, INDENT)).toEqual({ parent: null, previous: 'b' })
  })

  it('nests under the row above when dragged right', () => {
    expect(projectDrop(rows, 'c', 1, INDENT, INDENT)).toEqual({ parent: 'a', previous: null })
  })

  it('sits alongside an existing child rather than under it', () => {
    // Dropping after b1, which is already a child of b.
    expect(projectDrop(rows, 'c', 3, INDENT, INDENT)).toEqual({ parent: 'b', previous: 'b1' })
  })

  it('outdents a child dragged left', () => {
    expect(projectDrop(rows, 'b1', 2, -INDENT, INDENT)).toEqual({ parent: null, previous: 'b' })
  })

  // One level of nesting: a parent can never become a child.
  it('refuses to nest a task that has children', () => {
    expect(projectDrop(rows, 'b', 1, INDENT * 3, INDENT)).toEqual({ parent: null, previous: 'a' })
  })

  it('never exceeds one level however far right it is dragged', () => {
    const drop = projectDrop(rows, 'c', 3, INDENT * 5, INDENT)
    expect(drop).toEqual({ parent: 'b', previous: 'b1' })
  })

  it('clamps an index past the end of the list', () => {
    expect(projectDrop(rows, 'a', 99, 0, INDENT)).toEqual({ parent: null, previous: 'c' })
  })

  it('returns null for an unknown row', () => {
    expect(projectDrop(rows, 'ghost', 1, 0, INDENT)).toBeNull()
  })
})
