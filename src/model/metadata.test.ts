import { describe, it, expect } from 'vitest'
import { decodeNotes, encodeNotes, withMeta } from './metadata'

describe('decodeNotes', () => {
  it('handles empty input', () => {
    expect(decodeNotes(undefined)).toEqual({ body: '', meta: {} })
    expect(decodeNotes('')).toEqual({ body: '', meta: {} })
  })

  it('returns a plain note untouched', () => {
    const notes = 'Read chapters 4-5 first'
    expect(decodeNotes(notes)).toEqual({ body: notes, meta: {} })
  })

  it('splits body from metadata', () => {
    const notes = 'Read chapters 4-5\n\n⟦bt⟧{"cat":"MATH458","eff":90}'
    expect(decodeNotes(notes)).toEqual({
      body: 'Read chapters 4-5',
      meta: { cat: 'MATH458', eff: 90 },
    })
  })

  it('reads a block with no body', () => {
    expect(decodeNotes('⟦bt⟧{"pri":1}')).toEqual({ body: '', meta: { pri: 1 } })
  })

  // The failure mode that matters: a note hand-edited on a phone.
  it('drops a corrupt block without losing the body', () => {
    const notes = 'Important context\n\n⟦bt⟧{"cat":"MATH458"'
    expect(decodeNotes(notes)).toEqual({ body: 'Important context', meta: {} })
  })

  it('ignores a block that is not an object', () => {
    expect(decodeNotes('body\n\n⟦bt⟧[1,2,3]').meta).toEqual({})
    expect(decodeNotes('body\n\n⟦bt⟧null').meta).toEqual({})
    expect(decodeNotes('body\n\n⟦bt⟧"nope"').meta).toEqual({})
  })

  it('rejects individually invalid fields but keeps valid siblings', () => {
    const notes = '⟦bt⟧{"cat":"MATH458","eff":-5,"pri":"high","defer":"tomorrow","rec":"weekly","time":"25:00"}'
    expect(decodeNotes(notes).meta).toEqual({ cat: 'MATH458' })
  })

  it('only treats a trailing sentinel as metadata', () => {
    const notes = '⟦bt⟧{"cat":"FAKE"}\n\nreal note text'
    expect(decodeNotes(notes)).toEqual({ body: notes, meta: {} })
  })

  it('accepts a scheduled block, and rejects a malformed timestamp', () => {
    expect(decodeNotes('⟦bt⟧{"ev":"abc123","evs":"2026-09-04T17:00:00.000Z"}').meta).toEqual({
      ev: 'abc123',
      evs: '2026-09-04T17:00:00.000Z',
    })
    expect(decodeNotes('⟦bt⟧{"ev":"abc123","evs":"soon"}').meta).toEqual({ ev: 'abc123' })
  })

  it('accepts valid optional fields', () => {
    const meta = decodeNotes('⟦bt⟧{"defer":"2026-09-10","rec":"1w","time":"23:59"}').meta
    expect(meta).toEqual({ defer: '2026-09-10', rec: '1w', time: '23:59' })
  })
})

describe('encodeNotes', () => {
  it('emits nothing for empty metadata, leaving the note byte-identical', () => {
    expect(encodeNotes('just a note', {})).toBe('just a note')
    expect(encodeNotes('', {})).toBe('')
  })

  it('appends the block after a blank line', () => {
    expect(encodeNotes('a note', { eff: 30 })).toBe('a note\n\n⟦bt⟧{"eff":30}')
  })

  it('emits a bare block when there is no body', () => {
    expect(encodeNotes('', { eff: 30 })).toBe('⟦bt⟧{"eff":30}')
  })

  it('strips invalid values rather than writing them back', () => {
    expect(encodeNotes('x', { eff: 0, cat: '', pri: 2 })).toBe('x\n\n⟦bt⟧{"pri":2}')
  })

  it('refuses to write an oversized block', () => {
    expect(encodeNotes('body', { cat: 'x'.repeat(600) })).toBe('body')
  })
})

describe('round trip', () => {
  it('survives decode then encode unchanged', () => {
    const original = 'Office hours Thursday\n\n⟦bt⟧{"cat":"TAC458","eff":120,"pri":1}'
    const { body, meta } = decodeNotes(original)
    expect(encodeNotes(body, meta)).toBe(original)
  })

  it('does not accumulate blocks across repeated writes', () => {
    let notes = 'note'
    notes = withMeta(notes, { eff: 30 })
    notes = withMeta(notes, { eff: 60 })
    notes = withMeta(notes, { pri: 1 })
    expect(notes).toBe('note\n\n⟦bt⟧{"eff":60,"pri":1}')
    expect(notes.match(/⟦bt⟧/g)).toHaveLength(1)
  })
})
