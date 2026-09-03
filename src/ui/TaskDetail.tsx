import { useDraft } from './Draft'
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
  scheduled: boolean
  onSchedule: () => void
  onAddSubtask: () => void
  onClose: () => void
}

export function TaskDetail({
  node,
  lists,
  categories,
  theme,
  api,
  scheduled,
  onSchedule,
  onAddSubtask,
  onClose,
}: Props) {
  const id = node.raw.id

  // Text fields commit on blur or Enter, never per keystroke.
  const title = useDraft(node.title, (next) => {
    if (next.trim()) void api.editTask(id, { title: next.trim() })
  })
  const notes = useDraft(node.notes, (next) => void api.editTask(id, { notes: next }))
  const category = useDraft(node.meta.cat, (next) =>
    void api.setMeta(id, { cat: next.trim() || undefined }),
  )
  const effort = useDraft(node.meta.eff, (next) =>
    void api.setMeta(id, { eff: next ? Number(next) : undefined }),
  )

  /**
   * Date inputs commit on blur too. A native date field fires change on every
   * segment edit, so navigating from September to October in the picker was
   * writing an October due date on the way past.
   */
  const dueDate = useDraft(toDateInput(node.due), (next) =>
    void api.setDue(id, parseDateInput(next), node.meta.time),
  )
  const dueTime = useDraft(node.meta.time, (next) => void api.setDue(id, node.due, next || null))
  const startDate = useDraft(node.meta.defer, (next) =>
    void api.setMeta(id, { defer: next || undefined }),
  )

  const canIndent = indentTarget(api.tasks, id) !== null
  const canUp = neighbourFor(api.tasks, id, 'up') !== null
  const canDown = neighbourFor(api.tasks, id, 'down') !== null

  /**
   * Closes once the edit is finished: Enter, or focus leaving the editor
   * entirely. Tabbing between fields inside it must not close it, which is why
   * this checks where focus actually went rather than just reacting to blur.
   */
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null
    if (!next || !event.currentTarget.contains(next)) onClose()
  }

  return (
    <div
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && event.target instanceof HTMLInputElement) {
          // The field's own handler commits on blur; closing after that lands
          // the edit and dismisses the editor in one keystroke.
          event.currentTarget.focus()
          onClose()
        }
      }}
      tabIndex={-1}
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
      <input {...title} aria-label="Title" style={inputStyle(theme)} />

      <textarea
        {...notes}
        aria-label="Details"
        placeholder="Details"
        rows={2}
        style={{ ...inputStyle(theme), resize: 'vertical', fontFamily: 'inherit' }}
      />

      <Field label="Due" theme={theme}>
        <input
          {...dueDate}
          type="date"
          aria-label="Due date"
          style={{ ...inputStyle(theme), flex: 1 }}
        />
        <input
          {...dueTime}
          type="time"
          aria-label="Due time"
          disabled={!node.due}
          style={{ ...inputStyle(theme), width: 100 }}
        />
      </Field>

      <Field label="" theme={theme}>
        {/* Pushing a deadline is frequent enough that a date picker is friction. */}
        <Action theme={theme} onClick={() => void api.snooze(id, 1)} title="Due tomorrow">
          Tomorrow
        </Action>
        <Action theme={theme} onClick={() => void api.snooze(id, 7)} title="Due next week">
          Next week
        </Action>
        <Action theme={theme} onClick={() => void api.setDue(id, null)} title="Clear due date">
          No date
        </Action>
      </Field>

      <Field label="Class" theme={theme}>
        <input
          {...category}
          list="bt-categories"
          aria-label="Class"
          placeholder={listTitle(lists, node.listId)}
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
          {...effort}
          type="number"
          min={0}
          step={15}
          aria-label="Effort in minutes"
          placeholder="minutes"
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
          {...startDate}
          type="date"
          aria-label="Show from"
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

        <Action theme={theme} onClick={onSchedule} title="Schedule work time">
          {scheduled ? 'Reschedule' : 'Schedule'}
        </Action>
        <Action theme={theme} onClick={onAddSubtask} title="Add subtask">
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
