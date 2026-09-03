import { useMemo, useState } from 'react'
import type { GTaskList } from '@/model/types'
import type { Theme } from './theme'
import { parseEntry, type ParsedEntry } from '@/model/quickadd'
import { formatEffort } from './TaskRow'

/**
 * The add field.
 *
 * Typing "math 458 pset 4 fri 5pm 90m !1" fills in the class, due date, time,
 * effort, and priority in one line. A preview under the field shows what was
 * understood, so the syntax is discoverable without documentation and a
 * mis-parse is visible before the task is created rather than after.
 */
interface Props {
  theme: Theme
  lists: GTaskList[]
  categories: string[]
  activeListId: string
  onListChange: (listId: string) => void
  onAdd: (listId: string, parsed: ParsedEntry) => void
  colourOf: (category: string) => string
}

export function QuickAdd({
  theme,
  lists,
  categories,
  activeListId,
  onListChange,
  onAdd,
  colourOf,
}: Props) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseEntry(text, categories) : null), [text, categories])

  const submit = (): void => {
    if (!parsed?.title) return
    onAdd(activeListId, parsed)
    setText('')
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={text}
          placeholder="Add a task"
          aria-label="Add a task"
          id="bt-quickadd"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              setText('')
              e.currentTarget.blur()
            }
          }}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            padding: '7px 10px',
            borderRadius: 6,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
          }}
        />

        {lists.length > 1 && (
          <select
            aria-label="List for new tasks"
            value={activeListId}
            onChange={(e) => onListChange(e.target.value)}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              fontSize: 11,
              padding: '7px 6px',
              maxWidth: 110,
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              color: theme.muted,
            }}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {parsed && <Preview parsed={parsed} theme={theme} colourOf={colourOf} />}
    </div>
  )
}

function Preview({
  parsed,
  theme,
  colourOf,
}: {
  parsed: ParsedEntry
  theme: Theme
  colourOf: (category: string) => string
}) {
  const chips: { label: string; color?: string }[] = []

  if (parsed.category) chips.push({ label: parsed.category, color: colourOf(parsed.category) })
  if (parsed.due) {
    const date = parsed.due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    chips.push({ label: parsed.time ? `${date} ${parsed.time}` : date })
  }
  if (parsed.eff) chips.push({ label: formatEffort(parsed.eff) })
  if (parsed.pri) chips.push({ label: `P${parsed.pri}` })

  if (chips.length === 0) return null

  return (
    <div
      aria-label="Parsed preview"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        padding: '5px 10px 0',
        fontSize: 11,
        color: theme.muted,
      }}
    >
      <span style={{ color: theme.text }}>{parsed.title || '(no title)'}</span>
      {chips.map((chip) => (
        <span
          key={chip.label}
          style={{
            padding: '1px 6px',
            borderRadius: 999,
            color: chip.color ?? theme.muted,
            border: `1px solid ${chip.color ? `${chip.color}66` : theme.border}`,
            background: chip.color ? `${chip.color}1a` : 'transparent',
          }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  )
}
