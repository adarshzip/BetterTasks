import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
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

  return (
    <div
      ref={setNodeRef}
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
        style={{
          all: 'unset',
          cursor: 'grab',
          touchAction: 'none',
          width: 12,
          flexShrink: 0,
          alignSelf: 'stretch',
          color: theme.border,
          fontSize: 11,
          lineHeight: '30px',
          textAlign: 'center',
        }}
      >
        ⠿
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}
