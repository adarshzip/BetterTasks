import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type ReactNode } from 'react'
import type { Theme } from './theme'

/**
 * Drag wrapper for a task row.
 *
 * The handle is deliberately separate from the row body: the row is clickable
 * to open the editor, and making the whole row draggable would make every
 * click feel like a failed drag.
 */
export function SortableRow({
  id,
  theme,
  children,
}: {
  id: string
  theme: Theme
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const [hover, setHover] = useState(false)

  return (
    <div
      ref={setNodeRef}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        // Keep the dragged row visible but clearly lifted.
        opacity: isDragging ? 0.4 : 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Reorder"
        title="Drag to reorder, drag right to nest"
        style={{
          all: 'unset',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          width: 18,
          flexShrink: 0,
          alignSelf: 'stretch',
          // Visible at rest, obvious on hover. The earlier version used the
          // border colour and was effectively invisible.
          color: isDragging || hover ? theme.accent : theme.muted,
          background: hover ? `${theme.accent}1a` : 'transparent',
          borderRadius: 4,
          fontSize: 14,
          lineHeight: '30px',
          textAlign: 'center',
          transition: 'color 120ms, background 120ms',
        }}
      >
        ⠿
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}
