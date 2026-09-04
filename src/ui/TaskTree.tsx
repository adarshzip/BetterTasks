import { Fragment, useCallback, useRef, useState } from 'react'
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
import { categoryOf, resolveCategories } from '@/model/grouping'
import { projectDrop, type Row } from '@/state/projection'
import { TaskRow, INDENT } from './TaskRow'
import { TaskDetail } from './TaskDetail'
import { SortableRow } from './SortableRow'
import { ScheduleDialog } from './ScheduleDialog'
import { SubtaskComposer } from './SubtaskComposer'
import { useClickOutside } from './useClickOutside'
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
  atRisk: (node: TaskNode) => boolean
  progress: Map<string, { done: number; total: number }>
  revealed: ReadonlySet<string>
  onToggleReveal: (id: string) => void
  flashId: string | null
  showMore: boolean
  onToggleMore: (next: boolean) => void
  schedulingId: string | null
  onStartScheduling: (id: string | null) => void
  onSchedule: (node: TaskNode, slot: Interval) => void
  onComplete: (id: string, completed: boolean) => void
  /** Reordering is only meaningful inside one list; disabled in mixed groups. */
  sortable: boolean
  onToggleCollapse: (id: string) => void
  onSelect: (id: string | null, range?: boolean) => void
  selection: ReadonlySet<string>
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
  atRisk,
  progress,
  revealed,
  onToggleReveal,
  flashId,
  showMore,
  onToggleMore,
  schedulingId,
  onStartScheduling,
  onSchedule,
  onComplete,
  sortable,
  onToggleCollapse,
  onSelect,
  selection,
}: Props) {
  // Which task is currently accepting inline subtasks.
  const [composingUnder, setComposingUnder] = useState<string | null>(null)

  const listTitles = new Map(lists.map((l) => [l.id, l.title ?? 'Untitled']))
  const rows = flattenTree(nodes, collapsed)

  // The selected row and its editor, treated as one group for click-outside.
  //
  // Only the section that actually holds the selected row may listen. Every
  // section receives the same `selectedId`, so without this check the other
  // sections run the handler with an empty ref, decide the press was outside,
  // and close the editor the instant it opens.
  const editorRef = useRef<HTMLDivElement>(null)

  /**
   * A press outside the editor closes it. If that press landed on another
   * task, open that one instead: closing first and relying on the subsequent
   * click does not work, because removing the editor shifts the layout out
   * from under the pointer before the click resolves.
   */
  const closeEditor = useCallback(
    (target: Element | null) => {
      const row = target?.closest('[data-task-id]')
      const id = row?.getAttribute('data-task-id')
      onSelect(id && id !== selectedId ? id : null)
    },
    [onSelect, selectedId],
  )
  const ownsSelection = rows.some((row) => row.raw.id === selectedId)
  useClickOutside(editorRef, closeEditor, ownsSelection)


  // Subtasks inherit their parent's class unless they carry their own.
  const resolved = resolveCategories(nodes, listTitles, lists[0]?.id)
  const categoryFor = (node: TaskNode): string =>
    resolved.get(node.raw.id)?.category ?? categoryOf(node, listTitles)

  /**
   * The row after which the composer belongs: the parent's last descendant, or
   * the parent itself when it has none. Anything else would put new subtasks
   * above the existing ones.
   */
  const composerAnchor = (): string | null => {
    if (!composingUnder) return null
    const index = rows.findIndex((r) => r.raw.id === composingUnder)
    if (index === -1) return null

    const parentDepth = rows[index]!.depth
    let last = index
    while (rows[last + 1] && rows[last + 1]!.depth > parentDepth) last += 1
    return rows[last]!.raw.id
  }

  const anchorId = composerAnchor()

  /**
   * A child showing the same pill as its parent is noise: the indent already
   * says it belongs to that project. Only show a child's pill when it differs.
   */
  const showPillFor = (node: TaskNode): boolean => {
    if (!showCategory) return false
    // An untagged task in the default list gets no pill: "My Tasks" on every
    // row is noise, not information.
    if (!resolved.get(node.raw.id)?.tagged) return false

    if (!node.parent) return true
    const parent = rows.find((r) => r.raw.id === node.parent)
    return !parent || categoryFor(parent) !== categoryFor(node)
  }

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
        category={categoryFor(node)}
        categoryColour={colourOf(categoryFor(node))}
        block={blocks.get(node.raw.id) ?? null}
        atRisk={atRisk(node)}
        progress={progress.get(node.raw.id)}
        revealed={revealed.has(node.raw.id)}
        onToggleReveal={onToggleReveal}
        showCategory={showPillFor(node)}
        collapsed={collapsed.has(node.raw.id)}
        selected={selected}
        inSelection={selection.has(node.raw.id)}
        focused={cursorId === node.raw.id}
        dragging={draggingId === node.raw.id}
        onToggleCollapse={onToggleCollapse}
        onToggleComplete={(id, completed) => onComplete(id, completed)}
        flash={flashId === node.raw.id}
        onRename={(id, next) => void api.editTask(id, { title: next })}
        onDone={() => onSelect(null)}
        onSelect={(id, range) => onSelect(range ? id : selected ? null : id, range)}
      />
    )

    return (
      <Fragment key={node.raw.id}>
        <div ref={selected ? editorRef : undefined} data-task-id={node.raw.id}>
        {sortable ? (
          <SortableRow id={node.raw.id} theme={theme} disabled={selected}>
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
            showMore={showMore}
            onToggleMore={onToggleMore}
            onAddSubtask={() => setComposingUnder(node.raw.id)}
            onSchedule={() => onStartScheduling(node.raw.id)}
            onClose={() => onSelect(null)}
          />
        )}

        {anchorId === node.raw.id && composingUnder && (
          <SubtaskComposer
            theme={theme}
            depth={(rows.find((r) => r.raw.id === composingUnder)?.depth ?? 0) + 1}
            onAdd={(title) => void api.createTask(node.listId, title, composingUnder)}
            onAddMany={(titles) => void api.createTasks(node.listId, titles, composingUnder)}
            onClose={() => setComposingUnder(null)}
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
        </div>
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
