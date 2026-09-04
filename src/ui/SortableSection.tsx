import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import type { Theme } from './theme'

/**
 * Drag wrapper for a class section.
 *
 * Only the handle carries the drag listeners, not the whole section. A section
 * contains its own sortable list of tasks, and making the section body
 * draggable would mean every task drag also tried to drag its section.
 */
export function SortableSection({
  id,
  theme,
  children,
}: {
  id: string
  theme: Theme
  children: (handle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  const handle = (
    <button
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${id}`}
      title="Drag to reorder classes"
      style={{
        all: 'unset',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        padding: '0 2px',
        color: theme.muted,
        fontSize: 11,
      }}
    >
      ⠿
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {children(handle)}
    </div>
  )
}
