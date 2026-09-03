import { useState } from 'react'
import type { GTaskList } from '@/model/types'
import type { Theme } from './theme'

/**
 * List management: create and rename, plus clear completed.
 *
 * Deliberately no delete. Deleting a list destroys every task in it with no
 * undo, and Google's own UI is one click away for the rare time it is needed.
 */
interface Props {
  theme: Theme
  lists: GTaskList[]
  activeListId: string
  onCreate: (title: string) => void
  onRename: (listId: string, title: string) => void
  onClearCompleted: (listId: string) => void
}

export function ListMenu({
  theme,
  lists,
  activeListId,
  onCreate,
  onRename,
  onClearCompleted,
}: Props) {
  const [open, setOpen] = useState(false)
  const active = lists.find((l) => l.id === activeListId)

  const prompt = (question: string, initial = ''): string | null => {
    const answer = window.prompt(question, initial)
    return answer?.trim() ? answer.trim() : null
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        aria-label="List options"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          fontSize: 14,
          padding: '3px 6px',
          color: theme.muted,
        }}
      >
        ⋮
      </button>

      {open && (
        <>
          {/* Click-away layer, so the menu closes without a document listener. */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 1 }}
          />

          <div
            style={{
              position: 'absolute',
              top: '100%',
              insetInlineEnd: 0,
              zIndex: 2,
              minWidth: 180,
              padding: 4,
              borderRadius: 6,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            }}
          >
            <Item
              theme={theme}
              onClick={() => {
                setOpen(false)
                const title = prompt('Name for the new list')
                if (title) onCreate(title)
              }}
            >
              New list
            </Item>

            <Item
              theme={theme}
              disabled={!active}
              onClick={() => {
                setOpen(false)
                if (!active) return
                const title = prompt('Rename list', active.title ?? '')
                if (title) onRename(active.id, title)
              }}
            >
              Rename “{active?.title ?? 'list'}”
            </Item>

            <Item
              theme={theme}
              disabled={!active}
              onClick={() => {
                setOpen(false)
                if (!active) return
                if (window.confirm(`Clear completed tasks in “${active.title}”?`)) {
                  onClearCompleted(active.id)
                }
              }}
            >
              Clear completed
            </Item>
          </div>
        </>
      )}
    </div>
  )
}

function Item({
  theme,
  onClick,
  children,
  disabled,
}: {
  theme: Theme
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        all: 'unset',
        display: 'block',
        boxSizing: 'border-box',
        width: '100%',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 12,
        padding: '7px 10px',
        borderRadius: 4,
        color: disabled ? theme.border : theme.text,
      }}
    >
      {children}
    </button>
  )
}
