import { Fragment, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { GTaskList, TaskNode } from '@/model/types'
import type { Theme } from './theme'
import type { TasksApi } from '@/state/useTasks'
import { flattenTree } from '@/model/tree'
import { categoryOf } from '@/model/grouping'
import { projectDrop, type Row } from '@/state/projection'
import { TaskRow, INDENT } from './TaskRow'
import { TaskDetail } from './TaskDetail'
import { SortableRow } from './SortableRow'
import { ScheduleDialog } from './ScheduleDialog'
import type { Interval } from '@/model/schedule'

interface Props {
  nodes: TaskNode[]
  lists: GTaskList[]
  categories: string[]
  colourOf: (category: string) => string
  theme: Theme
  api: TasksApi
  showCategory: boolean
  collapsed: ReadonlySet<string>
  selectedId: string | null
  cursorId: string | null
  busy: Interval[]
  blocks: Map<string, { eventId: string; start: Date; end: Date }>
  schedulingId: string | null
  onStartScheduling: (id: string | null) => void
  onSchedule: (node: TaskNode, slot: Interval) => void
  onComplete: (id: string, completed: boolean) => void
  /** Reordering is only meaningful inside one list; disabled in mixed groups. */
  sortable: boolean
  onToggleCollapse: (id: string) => void
  onSelect: (id: string | null) => void
}

export function TaskTree({
  nodes,
  lists,
  categories,
  colourOf,
  theme,
  api,
  showCategory,
  collapsed,
  selectedId,
  cursorId,
  busy,
  blocks,
  schedulingId,
  onStartScheduling,
  onSchedule,
  onComplete,
  sortable,
  onToggleCollapse,
  onSelect,
}: Props) {
  const listTitles = new Map(lists.map((l) => [l.id, l.title ?? 'Untitled']))
  const rows = flattenTree(nodes, collapsed)

  // Horizontal drag distance decides nesting depth, so it has to be tracked
  // during the drag rather than read at the end.
  const [offsetX, setOffsetX] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // A small activation distance keeps a click on the handle from starting a
  // drag that the user did not intend.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const projection: Row[] = rows.map((node) => ({
    id: node.raw.id,
    depth: node.depth,
    parentId: node.parent,
    hasChildren: node.children.length > 0,
  }))

  const handleDragEnd = (event: DragEndEvent): void => {
    setDraggingId(null)
    setOffsetX(0)

    const { active, over } = event
    if (!over) return

    const overIndex = projection.findIndex((r) => r.id === over.id)
    if (overIndex === -1) return

    const drop = projectDrop(projection, String(active.id), overIndex, offsetX, INDENT)
    if (!drop) return

    const current = projection.find((r) => r.id === active.id)
    // Skip a no-op drop rather than spending an API call on it.
    if (current && current.parentId === drop.parent && drop.previous === previousOf(projection, current)) {
      return
    }

    void api.moveTo(String(active.id), drop.parent, drop.previous)
  }

  const body = rows.map((node) => {
    const selected = node.raw.id === selectedId
    const row = (
      <TaskRow
        node={node}
        theme={theme}
        category={categoryOf(node, listTitles)}
        categoryColour={colourOf(categoryOf(node, listTitles))}
        block={blocks.get(node.raw.id) ?? null}
        showCategory={showCategory}
        collapsed={collapsed.has(node.raw.id)}
        selected={selected}
        focused={cursorId === node.raw.id}
        dragging={draggingId === node.raw.id}
        onToggleCollapse={onToggleCollapse}
        onToggleComplete={(id, completed) => onComplete(id, completed)}
        onSelect={(id) => onSelect(selected ? null : id)}
      />
    )

    return (
      <Fragment key={node.raw.id}>
        {sortable ? (
          <SortableRow id={node.raw.id} theme={theme}>
            {row}
          </SortableRow>
        ) : (
          row
        )}

        {selected && (
          <TaskDetail
            node={node}
            lists={lists}
            categories={categories}
            theme={theme}
            api={api}
            scheduled={blocks.has(node.raw.id)}
            onSchedule={() => onStartScheduling(node.raw.id)}
            onClose={() => onSelect(null)}
          />
        )}

        {schedulingId === node.raw.id && (
          <ScheduleDialog
            node={node}
            theme={theme}
            busy={busy}
            onSchedule={(slot) => onSchedule(node, slot)}
            onCancel={() => onStartScheduling(null)}
          />
        )}
      </Fragment>
    )
  })

  if (!sortable) return <div>{body}</div>

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
      onDragMove={(e: DragMoveEvent) => setOffsetX(e.delta.x)}
      onDragCancel={() => {
        setDraggingId(null)
        setOffsetX(0)
      }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={projection.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div>{body}</div>
      </SortableContext>
    </DndContext>
  )
}

/** The sibling a row currently sits after, used to detect a no-op drop. */
function previousOf(rows: Row[], row: Row): string | null {
  const siblings = rows.filter((r) => r.parentId === row.parentId)
  const index = siblings.findIndex((r) => r.id === row.id)
  return index > 0 ? (siblings[index - 1]?.id ?? null) : null
}
