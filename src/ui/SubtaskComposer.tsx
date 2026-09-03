import { useEffect, useRef, useState } from 'react'
import type { Theme } from './theme'
import { splitPastedLines } from '@/model/quickadd'

/**
 * Inline entry for subtasks, staying open after each one.
 *
 * Breaking a project down is a burst of typing, not a series of separate
 * decisions. Enter commits the current line and clears the field for the next,
 * so five subtasks are five lines rather than five round trips through a menu.
 *
 * Pasting several lines creates one subtask each, which is how a project gets
 * broken down from notes that already exist.
 */
interface Props {
  theme: Theme
  depth: number
  onAdd: (title: string) => void
  onAddMany: (titles: string[]) => void
  onClose: () => void
}

export function SubtaskComposer({ theme, depth, onAdd, onAddMany, onClose }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        // Line up with the rows at this depth, including the connector gutter.
        paddingInlineStart: 8 + depth * 20 + 20,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          borderRadius: '50%',
          border: `1.5px dashed ${theme.muted}`,
        }}
      />

      <input
        ref={ref}
        value={title}
        aria-label="New subtask"
        placeholder="Subtask, Enter to add another, or paste a list"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!title.trim()) {
              // Enter on an empty field is how you finish, matching most
              // outliners. No stray blank task gets created.
              onClose()
              return
            }
            onAdd(title.trim())
            setTitle('')
          }

          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (!text.includes('\n')) return

          // Multi-line paste is a list, not a title. Single-line paste falls
          // through to normal input handling.
          e.preventDefault()
          const titles = splitPastedLines(text)
          if (titles.length) onAddMany(titles)
        }}
        onBlur={() => {
          if (!title.trim()) onClose()
        }}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          padding: '3px 6px',
          borderRadius: 4,
          border: `1px solid ${theme.accent}66`,
          color: theme.text,
        }}
      />
    </div>
  )
}
