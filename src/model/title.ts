/**
 * Class prefixes in task titles.
 *
 * A task's class lives in the metadata block, which Google's own clients do
 * not render. So on a phone, "HW1" gives no clue which course it belongs to.
 *
 * Mirroring the class into the title as "[QBIO 401] HW1" makes it visible
 * everywhere Google shows the task, while BetterTasks strips it back off and
 * renders the class as a pill instead. The prefix is a display convention, not
 * a second source of truth: the metadata block still owns the class.
 */

/** Matches a leading "[anything] " prefix. */
const PREFIX = /^\s*\[([^\]]+)\]\s*/

/** Adds or replaces the class prefix on a title. */
export function applyClassPrefix(title: string, category: string | undefined): string {
  const bare = removeAnyPrefix(title)
  if (!category) return bare
  return bare ? `[${category}] ${bare}` : `[${category}]`
}

/**
 * Removes the class prefix for display.
 *
 * Only strips a prefix that matches the task's own class. A title the user
 * wrote themselves, like "[draft] essay", is left alone: guessing that any
 * bracketed prefix is ours would quietly eat their text.
 */
export function stripClassPrefix(title: string, category: string | undefined): string {
  if (!category) return title.trim()

  const match = title.match(PREFIX)
  if (!match?.[1]) return title.trim()

  return match[1].trim().toLowerCase() === category.trim().toLowerCase()
    ? title.slice(match[0].length).trim()
    : title.trim()
}

/** Strips any bracketed prefix, used when re-applying a changed class. */
function removeAnyPrefix(title: string): string {
  return title.replace(PREFIX, '').trim()
}
