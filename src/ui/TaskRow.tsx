import { useEffect, useRef } from 'react'
import { useDraft } from './Draft'
import type { TaskNode } from '@/model/types'
import type { Theme } from './theme'
import { progressOf } from '@/model/tree'
import { describeEnd } from '@/model/recurrence'

/** Width of one nesting level, and of the connector gutter beside it. */
export const INDENT = 20

interface Props {
  node: TaskNode
  theme: Theme
  category: string
  categoryColour: string
  /** Live work block from the calendar, or null when not scheduled. */
  block: { start: Date; end: Date } | null
  /** True when the task needs more time than remains free before it is due. */
  atRisk: boolean
  showCategory: boolean
  collapsed: boolean
  selected: boolean
  inSelection: boolean
  focused: boolean
  dragging: boolean
  onToggleCollapse: (id: string) => void
  onToggleComplete: (id: string, completed: boolean) => void
  onSelect: (id: string, range: boolean) => void
  /** Briefly highlighted, so a newly created task is visibly located. */
  flash: boolean
  onRename: (id: string, title: string) => void
  onDone: () => void
}

export function TaskRow({
  node,
  theme,
  category,
  categoryColour,
  block,
  atRisk,
  showCategory,
  collapsed,
  selected,
  inSelection,
  focused,
  dragging,
  onToggleCollapse,
  onToggleComplete,
  onSelect,
  flash,
  onRename,
  onDone,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Without this the cursor walks off-screen and keyboard navigation is
  // unusable past the first screenful. Optional-called because not every
  // environment implements it, and a missing scroll must not break the row.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focused])

  /**
   * The title is editable in place while the row is selected. Google Tasks
   * does the same, and it is the difference between renaming a task and
   * opening a ten-field form to rename a task.
   */
  const title = useDraft(node.title, (next) => {
    if (next.trim()) onRename(node.raw.id, next.trim())
  })

  const progress = progressOf(node)
  const hasChildren = node.children.length > 0
  const overdue = node.due !== null && !node.completed && node.due < new Date()

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 8px',
        // The hanging indent, with a connector gutter to its left.
        paddingInlineStart: 8 + node.depth * INDENT,
        borderRadius: 6,
        position: 'relative',
        background: flash
          ? `${theme.accent}33`
          : inSelection
            ? `${theme.accent}22`
            : selected
              ? theme.surface
              : 'transparent',
        transition: 'background 400ms',
        outline: dragging
          ? `1px dashed ${theme.accent}`
          : focused
            ? `1px solid ${theme.accent}66`
            : 'none',
      }}
    >
      {node.depth > 0 && <Connector depth={node.depth} theme={theme} />}

      <button
        aria-label={collapsed ? 'Expand' : 'Collapse'}
        onClick={() => onToggleCollapse(node.raw.id)}
        style={{
          all: 'unset',
          cursor: hasChildren ? 'pointer' : 'default',
          width: 12,
          flexShrink: 0,
          color: theme.muted,
          visibility: hasChildren ? 'visible' : 'hidden',
          lineHeight: '18px',
          fontSize: 10,
        }}
      >
        {collapsed ? '▸' : '▾'}
      </button>

      <button
        role="checkbox"
        aria-checked={node.completed}
        aria-label={node.completed ? `Reopen ${node.title}` : `Complete ${node.title}`}
        onClick={() => onToggleComplete(node.raw.id, !node.completed)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: 14,
          height: 14,
          marginTop: 2,
          flexShrink: 0,
          borderRadius: '50%',
          border: `1.5px solid ${node.completed ? theme.accent : theme.muted}`,
          background: node.completed ? theme.accent : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          color: theme.bg,
        }}
      >
        {node.completed ? '✓' : ''}
      </button>

      <div
        onClick={(event) => onSelect(node.raw.id, event.shiftKey)}
        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
        {selected ? (
          <input
            {...title}
            autoFocus
            aria-label="Task title"
            onKeyDown={(event) => {
              title.onKeyDown(event)
              // Enter commits through the draft's own handler, then closes.
              if (event.key === 'Enter' && !event.shiftKey) onDone()
            }}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              width: '100%',
              fontSize: 13,
              lineHeight: '18px',
              color: theme.text,
              borderBottom: `1px solid ${theme.accent}66`,
            }}
          />
        ) : (
          <div
            style={{
              color: node.completed ? theme.muted : theme.text,
              textDecoration: node.completed ? 'line-through' : 'none',
              fontSize: 13,
              lineHeight: '18px',
              wordBreak: 'break-word',
            }}
          >
            {node.title || '(untitled)'}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
          {showCategory && <Pill label={category} color={categoryColour} />}

          {node.due && (
            <span style={{ fontSize: 11, color: overdue ? '#f28b82' : theme.muted }}>
              {formatDue(node.due, node.meta.time)}
            </span>
          )}

          {node.meta.eff && (
            <span style={{ fontSize: 11, color: theme.muted }}>{formatEffort(node.meta.eff)}</span>
          )}

          {atRisk && (
            <span
              title="Not enough free time before this is due"
              aria-label="At risk"
              style={{ fontSize: 11, color: '#fdd663' }}
            >
              ⚠ tight
            </span>
          )}

          {block && (
            <span style={{ fontSize: 11, color: theme.accent }}>▦ {formatBlock(block.start)}</span>
          )}

          {node.meta.rec && (
            <span style={{ fontSize: 11, color: theme.muted }}>
              ↻ {node.meta.rec}
              {describeEnd(node.meta) ? `, ${describeEnd(node.meta)}` : ''}
            </span>
          )}

          {progress.total > 0 && (
            <Progress done={progress.done} total={progress.total} theme={theme} />
          )}
        </div>
      </div>
    </div>
  )
}

/** The vertical rule linking a child back to its parent. */
function Connector({ depth, theme }: { depth: number; theme: Theme }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        insetInlineStart: 8 + (depth - 1) * INDENT + 5,
        top: 0,
        bottom: 0,
        width: 1,
        background: theme.border,
      }}
    />
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: '1px 6px',
        borderRadius: 999,
        color,
        border: `1px solid ${color}66`,
        background: `${color}1a`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function Progress({ done, total, theme }: { done: number; total: number; theme: Theme }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: theme.muted }}>
        {done}/{total}
      </span>
      <span style={{ width: 32, height: 3, borderRadius: 2, background: theme.border }}>
        <span
          style={{
            display: 'block',
            width: `${(done / total) * 100}%`,
            height: '100%',
            borderRadius: 2,
            background: theme.accent,
          }}
        />
      </span>
    </span>
  )
}

export function formatDue(due: Date, time?: string): string {
  const today = new Date()
  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  )

  const clock = time ? ` ${time}` : ''
  if (days === 0) return `Today${clock}`
  if (days === 1) return `Tomorrow${clock}`
  if (days === -1) return `Yesterday${clock}`
  if (days < 0) return `${Math.abs(days)}d overdue`

  // Within the week, the weekday is what you actually plan around. "Fri" beats
  // "Sep 4" when the date is four days away.
  if (days < 7) return due.toLocaleDateString(undefined, { weekday: 'short' }) + clock

  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + clock
}

/** 45 -> "45m", 120 -> "2h", 90 -> "1h 30m". */
function formatBlock(start: Date): string {
  return start.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
