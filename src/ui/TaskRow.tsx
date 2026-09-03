import type { TaskNode } from '@/model/types'
import type { Theme } from './theme'
import { progressOf } from '@/model/tree'
import { colorFor } from '@/model/grouping'

/** Width of one nesting level, and of the connector gutter beside it. */
export const INDENT = 20

interface Props {
  node: TaskNode
  theme: Theme
  category: string
  showCategory: boolean
  collapsed: boolean
  selected: boolean
  dragging: boolean
  onToggleCollapse: (id: string) => void
  onToggleComplete: (id: string, completed: boolean) => void
  onSelect: (id: string) => void
}

export function TaskRow({
  node,
  theme,
  category,
  showCategory,
  collapsed,
  selected,
  dragging,
  onToggleCollapse,
  onToggleComplete,
  onSelect,
}: Props) {
  const progress = progressOf(node)
  const hasChildren = node.children.length > 0
  const overdue = node.due !== null && !node.completed && node.due < new Date()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 8px',
        // The hanging indent, with a connector gutter to its left.
        paddingInlineStart: 8 + node.depth * INDENT,
        borderRadius: 6,
        position: 'relative',
        background: selected ? theme.surface : 'transparent',
        outline: dragging ? `1px dashed ${theme.accent}` : 'none',
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
        onClick={() => onSelect(node.raw.id)}
        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
          {showCategory && <Pill label={category} color={colorFor(category)} />}

          {node.due && (
            <span style={{ fontSize: 11, color: overdue ? '#f28b82' : theme.muted }}>
              {formatDue(node.due, node.meta.time)}
            </span>
          )}

          {node.meta.eff && (
            <span style={{ fontSize: 11, color: theme.muted }}>{formatEffort(node.meta.eff)}</span>
          )}

          {node.meta.rec && <span style={{ fontSize: 11, color: theme.muted }}>↻ {node.meta.rec}</span>}

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
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + clock
}

function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
}
