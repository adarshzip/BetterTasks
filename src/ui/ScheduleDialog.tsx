import { useMemo, useState } from 'react'
import type { TaskNode } from '@/model/types'
import type { Theme } from './theme'
import { DEFAULT_HOURS, DEFAULT_MINUTES, findSlots, type Interval } from '@/model/schedule'

/**
 * Proposes times to work on a task.
 *
 * The panel holds the effort estimate and the calendar holds the busy time, so
 * it can answer "when will I actually do this?" rather than making the user
 * find a gap by eye. Manual placement stays available through the start and
 * end fields.
 */
interface Props {
  node: TaskNode
  theme: Theme
  busy: Interval[]
  onSchedule: (slot: Interval) => void
  onCancel: () => void
}

export function ScheduleDialog({ node, theme, busy, onSchedule, onCancel }: Props) {
  const minutes = node.meta.eff ?? DEFAULT_MINUTES

  const slots = useMemo(
    () =>
      findSlots({
        minutes,
        due: node.due,
        now: new Date(),
        busy,
        hours: DEFAULT_HOURS,
        max: 3,
      }),
    [minutes, node.due, busy],
  )

  const [custom, setCustom] = useState('')

  return (
    <div
      style={{
        margin: '0 8px 8px',
        padding: 10,
        borderRadius: 8,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: theme.muted }}>
        {minutes} minutes
        {node.meta.eff ? '' : ' (no estimate, assuming an hour)'}
        {node.due ? `, due ${node.due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
      </div>

      {slots.length === 0 ? (
        <div style={{ fontSize: 12, color: '#f28b82' }}>
          No free slot this long before the deadline.
        </div>
      ) : (
        slots.map((slot) => (
          <button
            key={slot.start.toISOString()}
            aria-label={`Schedule ${formatSlot(slot)}`}
            onClick={() => onSchedule(slot)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 12,
              padding: '6px 10px',
              borderRadius: 4,
              border: `1px solid ${theme.border}`,
              color: theme.text,
            }}
          >
            {formatSlot(slot)}
          </button>
        ))
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <input
          type="datetime-local"
          aria-label="Custom start time"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            flex: 1,
            fontSize: 12,
            padding: '5px 8px',
            borderRadius: 4,
            border: `1px solid ${theme.border}`,
            background: theme.bg,
            color: theme.text,
          }}
        />
        <button
          aria-label="Schedule at custom time"
          disabled={!custom}
          onClick={() => {
            const start = new Date(custom)
            if (Number.isNaN(start.getTime())) return
            onSchedule({ start, end: new Date(start.getTime() + minutes * 60_000) })
          }}
          style={actionStyle(theme, !custom)}
        >
          Use
        </button>
        <button aria-label="Cancel scheduling" onClick={onCancel} style={actionStyle(theme)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function formatSlot(slot: Interval): string {
  const day = slot.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
  return `${day} ${clock(slot.start)}–${clock(slot.end)}`
}

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function actionStyle(theme: Theme, disabled = false): React.CSSProperties {
  return {
    all: 'unset',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 11,
    padding: '5px 8px',
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    color: disabled ? theme.border : theme.text,
  }
}
