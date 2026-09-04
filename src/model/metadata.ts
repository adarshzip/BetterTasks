import type { TaskMeta } from './types'

/**
 * Metadata codec.
 *
 * The Tasks API exposes no spare field, so anything it cannot express is
 * serialized as a single compact line at the very END of `notes`, after a
 * sentinel. Keeping it last means the human-readable portion of the note is
 * what previews in the official web and mobile clients.
 *
 * Every function here is total: malformed input yields empty metadata and an
 * untouched note body. A parse failure must never hide or destroy a task.
 */

const SENTINEL = '⟦bt⟧'

/** Matches the sentinel line and any blank space before it, anchored to the end. */
const BLOCK_RE = new RegExp(`\\n*${SENTINEL}[^\\n]*$`)

/** `notes` caps near 8k; refuse to emit a block that would crowd it out. */
const MAX_BLOCK_LENGTH = 512

/**
 * A metadata update. An explicit `undefined` clears a field, which is how a
 * due time or defer date gets removed.
 */
export type MetaPatch = { [K in keyof TaskMeta]?: TaskMeta[K] | undefined }

export interface DecodedNotes {
  /** The note with the metadata block stripped. */
  body: string
  meta: TaskMeta
}

export function decodeNotes(notes: string | undefined | null): DecodedNotes {
  if (!notes) return { body: '', meta: {} }

  const match = notes.match(BLOCK_RE)
  if (!match) return { body: notes, meta: {} }

  const body = notes.slice(0, match.index).replace(/\s+$/, '')
  const payload = match[0].slice(match[0].indexOf(SENTINEL) + SENTINEL.length)

  return { body, meta: parseMeta(payload) }
}

function parseMeta(payload: string): TaskMeta {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    // Corrupt block, most likely hand-edited on a phone. Drop it silently.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }

  const raw = parsed as Record<string, unknown>
  const meta: TaskMeta = {}

  if (typeof raw.cat === 'string' && raw.cat) meta.cat = raw.cat
  if (isPositiveInt(raw.eff)) meta.eff = raw.eff
  if (isPositiveInt(raw.pri)) meta.pri = raw.pri
  if (isIsoDate(raw.defer)) meta.defer = raw.defer
  if (typeof raw.rec === 'string' && /^\d+[dwm]$/.test(raw.rec)) meta.rec = raw.rec
  if (isIsoDate(raw.recu)) meta.recu = raw.recu
  if (isPositiveInt(raw.recn)) meta.recn = raw.recn
  if (isClockTime(raw.time)) meta.time = raw.time
  if (typeof raw.ev === 'string' && raw.ev) meta.ev = raw.ev
  if (isTimestamp(raw.evs)) meta.evs = raw.evs

  return meta
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
}

function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

/**
 * Rebuilds a `notes` value from a body and metadata. Emits no block at all when
 * the metadata is empty, so tasks we never enriched stay byte-identical.
 */
export function encodeNotes(body: string, meta: MetaPatch): string {
  const trimmed = body.replace(/\s+$/, '')
  const compact = compactMeta(meta)

  if (Object.keys(compact).length === 0) return trimmed

  const block = `${SENTINEL}${JSON.stringify(compact)}`
  if (block.length > MAX_BLOCK_LENGTH) return trimmed

  return trimmed ? `${trimmed}\n\n${block}` : block
}

/** Drops undefined and out-of-range values so we never write junk back. */
function compactMeta(meta: MetaPatch): TaskMeta {
  const out: TaskMeta = {}
  if (meta.cat) out.cat = meta.cat
  if (isPositiveInt(meta.eff)) out.eff = meta.eff
  if (isPositiveInt(meta.pri)) out.pri = meta.pri
  if (isIsoDate(meta.defer)) out.defer = meta.defer
  if (meta.rec && /^\d+[dwm]$/.test(meta.rec)) out.rec = meta.rec
  if (isIsoDate(meta.recu)) out.recu = meta.recu
  if (isPositiveInt(meta.recn)) out.recn = meta.recn
  if (isClockTime(meta.time)) out.time = meta.time
  if (meta.ev) out.ev = meta.ev
  if (isTimestamp(meta.evs)) out.evs = meta.evs
  return out
}

/**
 * The first meaningful line of a note, for showing on a row.
 *
 * Notes reaching here have already had the metadata block stripped by
 * `decodeNotes`, so this only ever sees what the user wrote. Whitespace is
 * collapsed because a note pasted from a document often begins with indented
 * or wrapped text that would otherwise render as a ragged fragment.
 */
export function notePreview(notes: string | undefined, max = 120): string {
  if (!notes) return ''

  const line = notes
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean)

  if (!line) return ''

  const collapsed = line.replace(/\s+/g, ' ')
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed
}

export function withMeta(notes: string | undefined, patch: MetaPatch): string {
  const { body, meta } = decodeNotes(notes)
  return encodeNotes(body, { ...meta, ...patch })
}
