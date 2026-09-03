import { useEffect, useState } from 'react'
import type { GTaskList, TaskNode } from '@/model/types'
import type { Theme } from './theme'
import type { TasksApi } from '@/state/useTasks'
import { parseDateInput, toDateInput } from '@/model/dates'
import { canOutdent, indentTarget, neighbourFor } from '@/state/mutations'

/**
 * The expanded editor for a single task.
 *
 * Everything the Tasks API cannot express (effort, priority, defer date,
 * recurrence) is edited here and stored in the metadata block. Due date and
 * time are edited as one control because they are written as one operation.
 */
interface Props {
  node: TaskNode
  lists: GTaskList[]
  categories: string[]
  theme: Theme
  api: TasksApi
  onClose: () => void
}

export function TaskDetail({ node, lists, categories, theme, api, onClose }: Props) {
  const [title, setTitle] = useState(node.title)
  const [notes, setNotes] = useState(node.notes)

  // Re-seed when a different task is selected.
  useEffect(() => {
    setTitle(node.title)
    setNotes(node.notes)
  }, [node.raw.id, node.title, node.notes])

  const id = node.raw.id
  const canIndent = indentTarget(api.tasks, id) !== null
  const canUp = neighbourFor(api.tasks, id, 'up') !== null
  const canDown = neighbourFor(api.tasks, id, 'down') !== null

  const commitTitle = (): void => {
    if (title.trim() && title !== node.title) void api.editTask(id, { title: title.trim() })
  }

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
        gap: 8,
      }}
    >
      <input
        value={title}
        aria-label="Title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setTitle(node.title)
        }}
        style={inputStyle(theme)}
      />

      <textarea
        value={notes}
        aria-label="Details"
        placeholder="Details"
        rows={2}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== node.notes && void api.editTask(id, { notes })}
        style={{ ...inputStyle(theme), resize: 'vertical', fontFamily: 'inherit' }}
      />

      <Field label="Due" theme={theme}>
        <input
          type="date"
          aria-label="Due date"
          value={toDateInput(node.due)}
          onChange={(e) => void api.setDue(id, parseDateInput(e.target.value), node.meta.time)}
          style={{ ...inputStyle(theme), flex: 1 }}
        />
        <input
          type="time"
          aria-label="Due time"
          value={node.meta.time ?? ''}
          disabled={!node.due}
          onChange={(e) => void api.setDue(id, node.due, e.target.value || null)}
          style={{ ...inputStyle(theme), width: 100 }}
        />
      </Field>

      <Field label="Class" theme={theme}>
        <input
          list="bt-categories"
          aria-label="Class"
          placeholder={listTitle(lists, node.listId)}
          value={node.meta.cat ?? ''}
          onChange={(e) => void api.setMeta(id, { cat: e.target.value.trim() || undefined })}
          style={{ ...inputStyle(theme), flex: 1 }}
        />
        {/* Existing categories as suggestions, without restricting to them. */}
        <datalist id="bt-categories">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </Field>

      <Field label="List" theme={theme}>
        <select
          aria-label="List"
          value={node.listId}
          onChange={(e) => void api.moveToList(id, e.target.value)}
          style={{ ...inputStyle(theme), flex: 1 }}
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.title}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Effort" theme={theme}>
        <input
          type="number"
          min={0}
          step={15}
          aria-label="Effort in minutes"
          placeholder="minutes"
          value={node.meta.eff ?? ''}
          onChange={(e) =>
            void api.setMeta(id, { eff: e.target.value ? Number(e.target.value) : undefined })
          }
          style={{ ...inputStyle(theme), width: 90 }}
        />
        <select
          aria-label="Priority"
          value={node.meta.pri ?? ''}
          onChange={(e) =>
            void api.setMeta(id, { pri: e.target.value ? Number(e.target.value) : undefined })
          }
          style={{ ...inputStyle(theme), flex: 1 }}
        >
          <option value="">No priority</option>
          <option value="1">High</option>
          <option value="2">Medium</option>
          <option value="3">Low</option>
        </select>
      </Field>

      <Field label="Start" theme={theme}>
        <input
          type="date"
          aria-label="Show from"
          value={node.meta.defer ?? ''}
          onChange={(e) => void api.setMeta(id, { defer: e.target.value || undefined })}
          style={{ ...inputStyle(theme), flex: 1 }}
        />
        <select
          aria-label="Repeat"
          value={node.meta.rec ?? ''}
          onChange={(e) => void api.setMeta(id, { rec: e.target.value || undefined })}
          style={{ ...inputStyle(theme), width: 110 }}
        >
          <option value="">No repeat</option>
          <option value="1d">Daily</option>
          <option value="1w">Weekly</option>
          <option value="2w">Fortnightly</option>
          <option value="1m">Monthly</option>
        </select>
      </Field>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
        <Action theme={theme} disabled={!canIndent} onClick={() => void api.indent(id)} title="Indent">
          ⇥
        </Action>
        <Action
          theme={theme}
          disabled={!canOutdent(api.tasks, id)}
          onClick={() => void api.outdent(id)}
          title="Outdent"
        >
          ⇤
        </Action>
        <Action theme={theme} disabled={!canUp} onClick={() => void api.nudge(id, 'up')} title="Move up">
          ↑
        </Action>
        <Action
          theme={theme}
          disabled={!canDown}
          onClick={() => void api.nudge(id, 'down')}
          title="Move down"
        >
          ↓
        </Action>

        <span style={{ flex: 1 }} />

        <Action
          theme={theme}
          onClick={() => {
            void api.createTask(node.listId, 'New subtask', id)
          }}
          title="Add subtask"
        >
          + Subtask
        </Action>
        <Action
          theme={theme}
          danger
          onClick={() => {
            onClose()
            void api.removeTask(id)
          }}
          title="Delete"
        >
          Delete
        </Action>
      </div>
    </div>
  )
}

/** Shown as the placeholder, since an empty category falls back to the list. */
function listTitle(lists: GTaskList[], listId: string): string {
  return lists.find((l) => l.id === listId)?.title ?? 'Other'
}

function Field({
  label,
  theme,
  children,
}: {
  label: string
  theme: Theme
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: theme.muted, width: 42, flexShrink: 0 }}>{label}</span>
      {children}
    </label>
  )
}

function Action({
  theme,
  onClick,
  title,
  children,
  disabled,
  danger,
}: {
  theme: Theme
  onClick: () => void
  title: string
  children: React.ReactNode
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        all: 'unset',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 11,
        padding: '4px 8px',
        borderRadius: 4,
        border: `1px solid ${theme.border}`,
        color: disabled ? theme.border : danger ? '#f28b82' : theme.text,
      }}
    >
      {children}
    </button>
  )
}

function inputStyle(theme: Theme): React.CSSProperties {
  return {
    all: 'unset',
    boxSizing: 'border-box',
    fontSize: 12,
    padding: '5px 8px',
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    background: theme.bg,
    color: theme.text,
  }
}
