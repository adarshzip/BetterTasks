import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { Theme } from './theme'
import { groupTasks, knownCategories, type ViewMode } from '@/model/grouping'
import { buildTree, toTask } from '@/model/tree'
import { useTasks } from '@/state/useTasks'
import { loadViewState, saveViewState } from '@/state/store'
import { TaskTree } from './TaskTree'
import { QuickAdd } from './QuickAdd'
import { Toast } from './Toast'
import { ListMenu } from './ListMenu'
import { useKeyboard, SHORTCUTS } from './useKeyboard'
import { flattenTree } from '@/model/tree'

export function Panel({ theme }: { theme: Theme }) {
  const api = useTasks()
  const [mode, setMode] = useState<ViewMode>('due')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The cursor is separate from the open editor: you move through the list
  // without opening anything, then press Enter on the one you want.
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [activeListId, setActiveListId] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    void loadViewState().then((state) => {
      setMode(state.mode)
      setCollapsed(new Set(state.collapsed))
    })
  }, [])

  // Default the add field to the first list once lists arrive.
  useEffect(() => {
    if (!activeListId && api.lists[0]) setActiveListId(api.lists[0].id)
  }, [api.lists, activeListId])

  const persist = useCallback(
    (next: { mode?: ViewMode; collapsed?: ReadonlySet<string> }) => {
      void saveViewState({
        mode: next.mode ?? mode,
        collapsed: [...(next.collapsed ?? collapsed)],
      })
    },
    [mode, collapsed],
  )

  const toggleCollapse = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        persist({ collapsed: next })
        return next
      })
    },
    [persist],
  )

  const switchMode = useCallback(
    (next: ViewMode) => {
      setMode(next)
      persist({ mode: next })
    },
    [persist],
  )

  // Dates are rebuilt here, on this side of the JSON message boundary.
  const tasks = useMemo(() => api.tasks.map((raw) => toTask(raw, raw.listId)), [api.tasks])
  const { urgent, groups } = useMemo(
    () => groupTasks(tasks, api.lists, mode),
    [tasks, api.lists, mode],
  )
  const categories = useMemo(() => knownCategories(tasks, api.lists), [tasks, api.lists])
  const completed = useMemo(() => buildTree(tasks.filter((t) => t.completed)), [tasks])

  // A task that scrolls out of existence should not keep the editor open.
  useEffect(() => {
    if (selectedId && !api.tasks.some((t) => t.id === selectedId)) setSelectedId(null)
    if (cursorId && !api.tasks.some((t) => t.id === cursorId)) setCursorId(null)
  }, [api.tasks, selectedId, cursorId])

  /** Every visible row, in display order, which is what the cursor walks. */
  const visibleIds = useMemo(() => {
    const sections = [urgent, ...groups.map((g) => g.nodes)]
    return sections.flatMap((nodes) => flattenTree(nodes, collapsed)).map((n) => n.raw.id)
  }, [urgent, groups, collapsed])

  const cursor = cursorId ?? visibleIds[0] ?? null

  useKeyboard(
    useMemo(
      () => ({
        moveCursor: (delta: number) => {
          if (visibleIds.length === 0) return
          const at = cursor ? visibleIds.indexOf(cursor) : -1
          const next = Math.max(0, Math.min(visibleIds.length - 1, at + delta))
          setCursorId(visibleIds[next] ?? null)
        },
        toggleDetail: () => cursor && setSelectedId((prev) => (prev === cursor ? null : cursor)),
        toggleComplete: () => {
          const task = api.tasks.find((t) => t.id === cursor)
          if (task) void api.setCompleted(task.id, task.status !== 'completed')
        },
        indent: () => cursor && void api.indent(cursor),
        outdent: () => cursor && void api.outdent(cursor),
        nudge: (direction: 'up' | 'down') => cursor && void api.nudge(cursor, direction),
        remove: () => cursor && void api.removeTask(cursor),
        focusQuickAdd: () => document.getElementById('bt-quickadd')?.focus(),
        dismiss: () => setSelectedId(null),
        undo: () => void api.runUndo(),
      }),
      [cursor, visibleIds, api],
    ),
    api.status === 'ready',
  )

  /**
   * Manual order is a property of a list, so dragging only makes sense when a
   * group holds tasks from a single list. In a mixed group the handles are
   * hidden rather than reordering something the user cannot see.
   */
  const singleList = (nodes: typeof urgent): boolean => {
    const ids = new Set<string>()
    const walk = (items: typeof urgent): void => {
      for (const node of items) {
        ids.add(node.listId)
        walk(node.children)
      }
    }
    walk(nodes)
    return ids.size <= 1
  }

  const tree = (nodes: typeof urgent, showCategory: boolean) => (
    <TaskTree
      nodes={nodes}
      lists={api.lists}
      categories={categories}
      theme={theme}
      api={api}
      showCategory={showCategory}
      cursorId={cursor}
      sortable={singleList(nodes)}
      collapsed={collapsed}
      selectedId={selectedId}
      onToggleCollapse={toggleCollapse}
      onSelect={(id) => {
        setSelectedId(id)
        if (id) setCursorId(id)
      }}
    />
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: theme.bg,
        color: theme.text,
        padding: 12,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Header
        theme={theme}
        mode={mode}
        onMode={switchMode}
        onRefresh={() => void api.load()}
        busy={api.status === 'loading'}
      >
        <button
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => setShowHelp((v) => !v)}
          style={{ ...buttonStyle(theme), border: 'none', padding: '3px 6px', color: theme.muted }}
        >
          ?
        </button>

        <ListMenu
          theme={theme}
          lists={api.lists}
          activeListId={activeListId}
          onCreate={(title) => void api.createList(title)}
          onRename={(id, title) => void api.renameList(id, title)}
          onClearCompleted={(id) => void api.clearCompleted(id)}
        />
      </Header>

      {showHelp && <Shortcuts theme={theme} />}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {api.status === 'loading' && <Notice theme={theme}>Loading tasks…</Notice>}

        {api.status === 'signedOut' && (
          <Notice theme={theme}>
            <div style={{ marginBottom: 8 }}>Connect your Google account to load tasks.</div>
            <button onClick={() => void api.signIn()} style={buttonStyle(theme)}>
              Sign in
            </button>
          </Notice>
        )}

        {api.status === 'error' && !api.tasks.length && (
          <Notice theme={theme}>
            <div style={{ marginBottom: 8, color: '#f28b82' }}>{api.error}</div>
            <button onClick={() => void api.load()} style={buttonStyle(theme)}>
              Retry
            </button>
          </Notice>
        )}

        {api.status === 'ready' && (
          <>
            <QuickAdd
              theme={theme}
              lists={api.lists}
              activeListId={activeListId}
              categories={categories}
              onListChange={setActiveListId}
              onAdd={(listId, parsed) =>
                void api.createTask(listId, parsed.title, undefined, {
                  ...(parsed.due ? { due: parsed.due } : {}),
                  ...(parsed.time ? { time: parsed.time } : {}),
                  ...(parsed.category ? { category: parsed.category } : {}),
                  ...(parsed.eff ? { eff: parsed.eff } : {}),
                  ...(parsed.pri ? { pri: parsed.pri } : {}),
                })
              }
            />

            {urgent.length > 0 && (
              <Section title="Overdue and today" theme={theme} accent>
                {tree(urgent, true)}
              </Section>
            )}

            {groups.map((group) => (
              <Section key={group.key} title={group.label} theme={theme}>
                {tree(group.nodes, mode === 'due')}
              </Section>
            ))}

            {urgent.length === 0 && groups.length === 0 && (
              <Notice theme={theme}>Nothing due. Nice work.</Notice>
            )}

            {completed.length > 0 && (
              <Section
                title={`Completed (${completed.length})`}
                theme={theme}
                collapsible
                open={showCompleted}
                onToggle={() => setShowCompleted((v) => !v)}
              >
                {showCompleted && tree(completed, true)}
              </Section>
            )}
          </>
        )}
      </div>

      <Toast
        theme={theme}
        undoLabel={api.undo?.label ?? null}
        error={api.tasks.length ? api.error : ''}
        onUndo={() => void api.runUndo()}
        onDismissUndo={api.dismissUndo}
        onDismissError={api.dismissError}
      />
    </div>
  )
}

function Header({
  theme,
  mode,
  onMode,
  onRefresh,
  busy,
  children,
}: {
  theme: Theme
  mode: ViewMode
  onMode: (m: ViewMode) => void
  onRefresh: () => void
  busy: boolean
  children?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <strong style={{ fontSize: 13, flex: 1 }}>BetterTasks</strong>

      <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 999 }}>
        {(['due', 'category'] as const).map((value) => (
          <button
            key={value}
            onClick={() => onMode(value)}
            style={{
              ...buttonStyle(theme),
              border: 'none',
              borderRadius: 999,
              fontSize: 11,
              padding: '3px 10px',
              background: mode === value ? theme.accent : 'transparent',
              color: mode === value ? theme.bg : theme.muted,
            }}
          >
            {value === 'due' ? 'Due' : 'Class'}
          </button>
        ))}
      </div>

      {children}

      <button
        onClick={onRefresh}
        disabled={busy}
        aria-label="Refresh"
        style={{ ...buttonStyle(theme), border: 'none', padding: '3px 6px' }}
      >
        ↻
      </button>
    </div>
  )
}

function Section({
  title,
  theme,
  accent,
  collapsible,
  open,
  onToggle,
  children,
}: {
  title: string
  theme: Theme
  accent?: boolean
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 14 }}>
      <div
        onClick={onToggle}
        {...(collapsible
          ? { role: 'button', 'aria-expanded': !!open, 'aria-label': title }
          : {})}
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: accent ? '#f28b82' : theme.muted,
          marginBottom: 4,
          cursor: collapsible ? 'pointer' : 'default',
        }}
      >
        {collapsible && <span style={{ marginRight: 4 }}>{open ? '▾' : '▸'}</span>}
        {title}
      </div>
      {children}
    </section>
  )
}

function Shortcuts({ theme }: { theme: Theme }) {
  return (
    <div
      style={{
        marginBottom: 10,
        padding: 8,
        borderRadius: 6,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        fontSize: 11,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '4px 10px',
      }}
    >
      {SHORTCUTS.map(([keys, description]) => (
        <Fragment key={keys}>
          <kbd style={{ color: theme.accent, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {keys}
          </kbd>
          <span style={{ color: theme.muted }}>{description}</span>
        </Fragment>
      ))}
    </div>
  )
}

function Notice({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: theme.muted, padding: '8px 0' }}>{children}</div>
}

function buttonStyle(theme: Theme): React.CSSProperties {
  return {
    all: 'unset',
    cursor: 'pointer',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    color: theme.text,
  }
}
