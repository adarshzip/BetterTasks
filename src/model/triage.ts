import type { Task } from './types'
import { parseEntry } from './quickadd'

/**
 * Recovering structure from tasks captured elsewhere.
 *
 * The Google Tasks mobile app can only write a title, notes, a due date, and a
 * list. Everything that makes this panel useful — class, effort, priority — is
 * invisible to it. So a task added during a lecture arrives stripped.
 *
 * The fix is a convention rather than an integration: type the same syntax the
 * quick-add field accepts, and let the panel apply it on arrival. Capture
 * becomes lossless with no mobile app and no extra API.
 */

export interface Suggestion {
  taskId: string
  /** The title as captured, shown so the change is reviewable. */
  before: string
  /** The title with the recognised syntax stripped out. */
  title: string
  category?: string
  due?: Date
  time?: string
  eff?: number
  pri?: number
}

/**
 * Finds tasks whose titles still carry unapplied syntax.
 *
 * Deliberately narrow. A task is only suggested when parsing its title yields
 * something actionable, so an ordinary task like "buy milk" is left alone
 * rather than filling a queue with entries that have nothing to apply.
 */
export function suggestionsFor(
  tasks: Task[],
  known: string[] = [],
  dismissed: ReadonlySet<string> = new Set(),
  now = new Date(),
): Suggestion[] {
  const out: Suggestion[] = []

  for (const task of tasks) {
    if (task.completed || dismissed.has(task.raw.id)) continue

    // Any metadata at all means this task has already been through the panel,
    // so its title is not raw capture any more.
    if (Object.keys(task.meta).length > 0) continue
    if (!task.title) continue

    const parsed = parseEntry(task.title, known, now)
    const hasSomething =
      parsed.category !== undefined ||
      parsed.due !== undefined ||
      parsed.eff !== undefined ||
      parsed.pri !== undefined

    // Never suggest a change that would leave the task with no title.
    if (!hasSomething || !parsed.title) continue
    // Nothing was actually stripped and nothing learned; not worth asking.
    if (parsed.title === task.title && parsed.category === undefined) continue

    out.push({
      taskId: task.raw.id,
      before: task.title,
      title: parsed.title,
      ...(parsed.category !== undefined ? { category: parsed.category } : {}),
      ...(parsed.due !== undefined ? { due: parsed.due } : {}),
      ...(parsed.time !== undefined ? { time: parsed.time } : {}),
      ...(parsed.eff !== undefined ? { eff: parsed.eff } : {}),
      ...(parsed.pri !== undefined ? { pri: parsed.pri } : {}),
    })
  }

  return out
}

/** A short human summary of what a suggestion would change. */
export function describeSuggestion(suggestion: Suggestion): string[] {
  const parts: string[] = []
  if (suggestion.category) parts.push(suggestion.category)
  if (suggestion.due) {
    parts.push(
      suggestion.due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        (suggestion.time ? ` ${suggestion.time}` : ''),
    )
  }
  if (suggestion.eff) parts.push(`${suggestion.eff}m`)
  if (suggestion.pri) parts.push(`P${suggestion.pri}`)
  return parts
}
