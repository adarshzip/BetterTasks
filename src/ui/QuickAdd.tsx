import { useState } from 'react'
import type { GTaskList } from '@/model/types'
import type { Theme } from './theme'

/**
 * The add field, always visible at the top of the panel.
 *
 * Phase 3 replaces the plain title with natural language parsing, so that
 * "math 458 pset 4 fri 5p" fills in the list and due date too.
 */
interface Props {
  theme: Theme
  lists: GTaskList[]
  activeListId: string
  onListChange: (listId: string) => void
  onAdd: (listId: string, title: string) => void
}

export function QuickAdd({ theme, lists, activeListId, onListChange, onAdd }: Props) {
  const [title, setTitle] = useState('')

  const submit = (): void => {
    if (!title.trim()) return
    onAdd(activeListId, title)
    setTitle('')
  }

  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
      <input
        value={title}
        placeholder="Add a task"
        aria-label="Add a task"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setTitle('')
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
  )
}
