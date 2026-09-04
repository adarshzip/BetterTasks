import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { Theme } from './theme'
import {
  groupTasks,
  knownCategories,
  lingers,
  matchesQuery,
  remainingEffort,
  type ViewMode,
} from '@/model/grouping'
import { buildTree, progressByParent, toTask } from '@/model/tree'
import { useTasks } from '@/state/useTasks'
import { useCalendar } from '@/state/useCalendar'
import { isAtRisk } from '@/model/schedule'
import type { ParsedEntry } from '@/model/quickadd'
import { formatEffort } from './TaskRow'
import { loadViewState, saveViewState } from '@/state/store'
import { TaskTree } from './TaskTree'
import { QuickAdd } from './QuickAdd'
import { Toast } from './Toast'
import { ListMenu } from './ListMenu'
import { BulkBar } from './BulkBar'
import { TriageQueue } from './TriageQueue'
import { SortableSection } from './SortableSection'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { suggestionsFor, type Suggestion } from '@/model/triage'
import { useKeyboard, SHORTCUTS } from './useKeyboard'
import { flattenTree } from '@/model/tree'

export function Panel({ theme }: { theme: Theme }) {
  const api = useTasks()
  const calendar = useCalendar()
  const [mode, setMode] = useState<ViewMode>('due')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [categoryOrder, setCategoryOrder] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The cursor is separate from the open editor: you move through the list
  // without opening anything, then press Enter on the one you want.
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [activeListId, setActiveListId] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [showDeferred, setShowDeferred] = useState(false)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  // Sticky for the session: someone who wants the full field set should not
  // re-open it on every task.
  const [showMore, setShowMore] = useState(false)
  const [dismissedTriage, setDismissedTriage] = useState<ReadonlySet<string>>(new Set())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  // Search does not earn a permanent row; it opens from the header or `/`.
  const [searchOpen, setSearchOpen] = useState(false)
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    void loadViewState().then((state) => {
      setMode(state.mode)
      setCollapsed(new Set(state.collapsed))
      setCategoryOrder(state.categoryOrder)
    })
  }, [])

  // Default the add field to the first list once lists arrive.
  useEffect(() => {
    if (!activeListId && api.lists[0]) setActiveListId(api.lists[0].id)
  }, [api.lists, activeListId])

  const persist = useCallback(
    (next: { mode?: ViewMode; collapsed?: ReadonlySet<string>; categoryOrder?: string[] }) => {
      void saveViewState({
        mode: next.mode ?? mode,
        collapsed: [...(next.collapsed ?? collapsed)],
        categoryOrder: next.categoryOrder ?? categoryOrder,
      })
    },
    [mode, collapsed, categoryOrder],
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
  const visible = useMemo(() => {
    if (!query.trim()) return tasks
    const titles = new Map(api.lists.map((l) => [l.id, l.title ?? 'Untitled']))
    return tasks.filter((t) => matchesQuery(t, query, titles))
  }, [tasks, query, api.lists])

  const { urgent, groups, deferred } = useMemo(
    () => groupTasks(visible, api.lists, mode, new Date(), categoryOrder, revealed),
    [visible, api.lists, mode, categoryOrder, revealed],
  )
  const categories = useMemo(() => {
    const fromTasks = knownCategories(tasks, api.lists)
    const fromCalendar = calendar.courses.map((c) => c.code)
    return [...new Set([...fromCalendar, ...fromTasks])].sort((a, b) => a.localeCompare(b))
  }, [tasks, api.lists, calendar.courses])
  // Excludes tasks still shown in the list above, so nothing appears twice.
  /** Tasks captured elsewhere whose titles still carry unapplied syntax. */
  const suggestions = useMemo(
    () => suggestionsFor(tasks, categories, dismissedTriage),
    [tasks, categories, dismissedTriage],
  )

  // Computed over every loaded task, including completed ones, so finishing a
  // subtask moves the rollup forward instead of shrinking it.
  const progress = useMemo(() => progressByParent(tasks), [tasks])

  const completed = useMemo(() => {
    const defaultListId = api.lists[0]?.id
    const options = defaultListId ? { defaultListId } : {}
    // In the due view nothing lingers, so everything completed belongs here.
    const shown = (t: (typeof tasks)[number]) =>
      mode === 'category' && lingers(t, new Date(), options)
    return buildTree(tasks.filter((t) => t.completed && !shown(t)))
  }, [tasks, api.lists, mode])

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
          if (task) void completeTask(task.id, task.status !== 'completed')
        },
        indent: () => cursor && void api.indent(cursor),
        outdent: () => cursor && void api.outdent(cursor),
        nudge: (direction: 'up' | 'down') => cursor && void api.nudge(cursor, direction),
        remove: () => cursor && void api.removeTask(cursor),
        focusQuickAdd: () => document.getElementById('bt-quickadd')?.focus(),
        focusSearch: () => {
          setSearchOpen(true)
          // Opening renders the field, so focus has to wait a frame for it.
          requestAnimationFrame(() => document.getElementById('bt-search')?.focus())
        },
        snooze: (days: number) => cursor && void api.snooze(cursor, days),
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

  /**
   * Creates the work block, then records the event id on the task so the row
   * can show when it is scheduled without scanning the calendar.
   */
  const scheduleTask = useCallback(
    async (node: (typeof urgent)[number], slot: { start: Date; end: Date }) => {
      setSchedulingId(null)

      // Replace rather than orphan: rescheduling should not leave the old block.
      const existing = calendar.blocks.get(node.raw.id)
      if (existing) await calendar.unschedule(existing.eventId)

      await calendar.schedule(node.raw.id, node.title, slot)
    },
    [calendar],
  )

  /**
   * Completing a task clears a work block that has not happened yet: an hour
   * blocked out this evening for something already finished is noise. A block
   * in the past is left alone, because it is a record of where time went.
   */
  const completeTask = useCallback(
    async (id: string, completed: boolean) => {
      const block = calendar.blocks.get(id)

      await api.setCompleted(id, completed)
      if (!completed || !block) return

      // Only a block that has not happened yet. A past one is a record.
      if (block.start > new Date()) await calendar.unschedule(block.eventId)
    },
    [api, calendar],
  )

  /**
   * Flags a task that needs more time than remains free before it is due. This
   * is the one thing the panel can say that no task app without calendar
   * access can, so it is worth a marker on the row.
   */
  const atRisk = useCallback(
    (node: (typeof urgent)[number]): boolean => {
      if (node.completed || !calendar.busy.length) return false
      // No estimate, no warning: see isAtRisk.
      if (!node.meta.eff) return false

      return isAtRisk(
        { due: node.due, minutes: node.meta.eff, hasTime: !!node.meta.time },
        { now: new Date(), busy: calendar.busy },
      )
    },
    [calendar.busy],
  )

  /**
   * Applies an action across the selection, one request at a time.
   *
   * Sequential rather than parallel on purpose: the Tasks API rate-limits
   * readily, and thirty simultaneous writes is exactly the shape that trips it.
   */
  const applyToSelection = useCallback(
    async (action: (id: string) => Promise<void>) => {
      for (const id of selection) await action(id)
      setSelection(new Set())
    },
    [selection],
  )

  /**
   * What a new quick-add entry would nest under.
   *
   * Google allows one level, so a subtask cannot take children. When the
   * cursor is already on a subtask, the sensible target is its parent, which
   * makes Tab add a sibling rather than doing nothing.
   */
  const nestTarget = useMemo((): { id: string; title: string } | null => {
    if (!cursor) return null
    const all = [...urgent, ...groups.flatMap((g) => g.nodes)]

    const find = (nodes: typeof urgent): (typeof urgent)[number] | null => {
      for (const node of nodes) {
        if (node.raw.id === cursor) return node
        const child = find(node.children)
        if (child) return child
      }
      return null
    }

    const node = find(all)
    if (!node) return null
    if (!node.parent) return { id: node.raw.id, title: node.title }

    const parent = all.find((n) => n.raw.id === node.parent)
    return parent ? { id: parent.raw.id, title: parent.title } : null
  }, [cursor, urgent, groups])

  /**
   * Adds a task and shows where it landed.
   *
   * A new task sorts straight into a due bucket that may be far down the list
   * or inside a collapsed section, so without this, typing a task and pressing
   * Enter looks like nothing happened. Moving the cursor reuses the row's
   * existing scroll-into-view, and the flash says which row is new.
   */
  const addTask = useCallback(
    async (listId: string, parsed: ParsedEntry, parent?: string) => {
      const id = await api.createTask(listId, parsed.title, parent, {
        ...(parsed.due ? { due: parsed.due } : {}),
        ...(parsed.time ? { time: parsed.time } : {}),
        ...(parsed.category ? { category: parsed.category } : {}),
        ...(parsed.eff ? { eff: parsed.eff } : {}),
        ...(parsed.pri ? { pri: parsed.pri } : {}),
      })
      if (!id) return

      // The server's id, not the optimistic `pending-` one: that row has
      // already been replaced by the reload.
      setCursorId(id)
      setFlashId(id)
      setTimeout(() => setFlashId((current) => (current === id ? null : current)), 1200)
    },
    [api],
  )

  // A small activation distance keeps a click on the handle from starting a
  // drag nobody intended.
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  /** Drops one class onto another's position. */
  const reorderCategory = useCallback(
    (from: string, to: string) => {
      const current = categoryOrder.length ? [...categoryOrder] : groups.map((g) => g.label)
      const fromIndex = current.indexOf(from)
      const toIndex = current.indexOf(to)
      if (fromIndex === -1 || toIndex === -1) return

      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      if (moved) next.splice(toIndex, 0, moved)

      setCategoryOrder(next)
      persist({ categoryOrder: next })
    },
    [categoryOrder, groups, persist],
  )

  /**
   * Moves a class up or down.
   *
   * The stored order starts from whatever is on screen, so the first move
   * pins the current arrangement rather than reshuffling everything the user
   * had not thought about yet.
   */
  const moveCategory = useCallback(
    (label: string, direction: -1 | 1) => {
      const current = categoryOrder.length
        ? [...categoryOrder]
        : groups.map((group) => group.label)

      const from = current.indexOf(label)
      if (from === -1) return

      const to = from + direction
      if (to < 0 || to >= current.length) return

      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (moved) next.splice(to, 0, moved)

      setCategoryOrder(next)
      persist({ categoryOrder: next })
    },
    [categoryOrder, groups, persist],
  )

  /**
   * Shows or hides a parent's completed subtasks.
   *
   * Completed tasks load lazily, so revealing also pulls the full history in:
   * otherwise a subtask finished more than a week ago would be counted in the
   * rollup but missing from the list it just expanded.
   */
  const toggleReveal = useCallback(
    (id: string) => {
      setRevealed((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else {
          next.add(id)
          if (!api.completedLoaded) void api.loadCompleted()
        }
        return next
      })
    },
    [api],
  )

  /** Incomplete tasks whose due date has already passed. */
  const overdueIds = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const out: string[] = []
    const visit = (nodes: typeof urgent): void => {
      for (const node of nodes) {
        if (!node.completed && node.due && node.due < startOfToday) out.push(node.raw.id)
        visit(node.children)
      }
    }
    visit(urgent)
    return out
  }, [urgent])

  /** Sequential, like the other bulk paths: the Tasks API rate-limits readily. */
  const applyAllSuggestions = useCallback(
    async (items: Suggestion[]) => {
      for (const suggestion of items) await api.applySuggestion(suggestion)
    },
    [api],
  )

  const tree = (nodes: typeof urgent, showCategory: boolean) => (
    <TaskTree
      nodes={nodes}
      lists={api.lists}
      categories={categories}
      colourOf={calendar.colourOf}
      theme={theme}
      api={api}
      showCategory={showCategory}
      cursorId={cursor}
      busy={calendar.busy}
      blocks={calendar.blocks}
      atRisk={atRisk}
      progress={progress}
      revealed={revealed}
      onToggleReveal={toggleReveal}
      flashId={flashId}
      showMore={showMore}
      onToggleMore={setShowMore}
      schedulingId={schedulingId}
      onStartScheduling={setSchedulingId}
      onSchedule={scheduleTask}
      onComplete={completeTask}
      sortable={singleList(nodes)}
      collapsed={collapsed}
      selectedId={selectedId}
      onToggleCollapse={toggleCollapse}
      onSelect={(id, range) => {
        // Shift-click extends a selection instead of opening the editor.
        if (range && id) {
          setSelection((prev) => extendSelection(prev, visibleIds, cursor, id))
          setCursorId(id)
          return
        }
        setSelectedId(id)
        if (id) setCursorId(id)
      }}
      selection={selection}
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
          aria-label={searchOpen ? 'Close search' : 'Search'}
          title="Search"
          onClick={() => {
            if (searchOpen) setQuery('')
            setSearchOpen(!searchOpen)
          }}
          style={{ ...buttonStyle(theme), border: 'none', padding: '3px 6px', color: theme.muted }}
        >
          ⌕
        </button>

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
            <TriageQueue
              theme={theme}
              suggestions={suggestions}
              onApply={(suggestion) => void api.applySuggestion(suggestion)}
              onApplyAll={() => void applyAllSuggestions(suggestions)}
              onDismiss={(taskId) =>
                setDismissedTriage((prev) => new Set([...prev, taskId]))
              }
            />

            {selection.size > 0 && (
              <BulkBar
                theme={theme}
                count={selection.size}
                categories={categories}
                onSetCategory={(category) => void applyToSelection((id) => api.setMeta(id, { cat: category }))}
                onSnooze={(days) => void applyToSelection((id) => api.snooze(id, days))}
                onClear={() => setSelection(new Set())}
              />
            )}

            {searchOpen && (
              <SearchBox
                theme={theme}
                value={query}
                onChange={setQuery}
                onClose={() => {
                  setQuery('')
                  setSearchOpen(false)
                }}
              />
            )}

            <QuickAdd
              theme={theme}
              lists={api.lists}
              activeListId={activeListId}
              categories={categories}
              colourOf={calendar.colourOf}
              nestTarget={nestTarget}
              onListChange={setActiveListId}
              onAdd={(listId, parsed, parent) => void addTask(listId, parsed, parent)}
            />

            {urgent.length > 0 && (
              <Section
                title="Overdue and today"
                theme={theme}
                accent
                effort={remainingEffort(urgent)}
                action={
                  overdueIds.length > 0
                    ? {
                        label: `Move ${overdueIds.length} overdue to today`,
                        onClick: () => void api.carryOverdueForward(overdueIds),
                      }
                    : undefined
                }
              >
                {tree(urgent, true)}
              </Section>
            )}

            {mode === 'category' ? (
              <DndContext
                sensors={sectionSensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active, over }) => {
                  if (over && active.id !== over.id) {
                    reorderCategory(String(active.id), String(over.id))
                  }
                }}
              >
                <SortableContext
                  items={groups.map((group) => group.label)}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.map((group, index) => (
                    <SortableSection key={group.key} id={group.label} theme={theme}>
                      {(handle) => (
                        <Section
                          title={group.label}
                          theme={theme}
                          effort={group.effort}
                          handle={handle}
                          reorder={{
                            label: group.label,
                            canUp: index > 0,
                            canDown: index < groups.length - 1,
                            onMove: moveCategory,
                          }}
                        >
                          {tree(group.nodes, false)}
                        </Section>
                      )}
                    </SortableSection>
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              groups.map((group) => (
                <Section key={group.key} title={group.label} theme={theme} effort={group.effort}>
                  {tree(group.nodes, mode === 'due')}
                </Section>
              ))
            )}

            {urgent.length === 0 && groups.length === 0 && (
              <Notice theme={theme}>Nothing due. Nice work.</Notice>
            )}

            {deferred.length > 0 && (
              <Section
                title={`Scheduled for later (${deferred.length})`}
                theme={theme}
                collapsible
                open={showDeferred}
                onToggle={() => setShowDeferred((v) => !v)}
              >
                {showDeferred && tree(deferred, true)}
              </Section>
            )}

            <Section
              title={completedTitle(completed.length, api.completedLoaded, api.completedLoading)}
              theme={theme}
              collapsible
              open={showCompleted}
              onToggle={() => {
                const next = !showCompleted
                setShowCompleted(next)
                // Fetched on first open, then cached for the session.
                if (next && !api.completedLoaded) void api.loadCompleted()
              }}
            >
              {showCompleted &&
                (completed.length > 0 ? (
                  tree(completed, true)
                ) : (
                  <Notice theme={theme}>
                    {api.completedLoading ? 'Loading…' : 'Nothing completed yet.'}
                  </Notice>
                ))}
            </Section>
          </>
        )}
      </div>

      <Toast
        theme={theme}
        undoLabel={api.undo?.label ?? null}
        error={calendar.error || (api.tasks.length ? api.error : '')}
        onUndo={() => void api.runUndo()}
        onDismissUndo={api.dismissUndo}
        onDismissError={() => {
          calendar.dismissError()
          api.dismissError()
        }}
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
      {/* No title here: the browser's own side panel header already shows it,
          and repeating it cost a third of the row. */}
      <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 999 }}>
        {(['today', 'due', 'category'] as const).map((value) => (
          <button
            key={value}
            onClick={() => onMode(value)}
            aria-label={
              value === 'today'
                ? 'Today'
                : value === 'due'
                  ? 'Group by due date'
                  : 'Group by class'
            }
            aria-pressed={mode === value}
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
            {value === 'today' ? 'Today' : value === 'due' ? 'Due' : 'Class'}
          </button>
        ))}
      </div>

      <span style={{ flex: 1 }} />

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
  effort,
  action,
  reorder,
  handle,
  onToggle,
  children,
}: {
  title: string
  theme: Theme
  accent?: boolean
  collapsible?: boolean
  open?: boolean
  effort?: number | undefined
  action?: { label: string; onClick: () => void } | undefined
  handle?: React.ReactNode
  reorder?:
    | {
        label: string
        canUp: boolean
        canDown: boolean
        onMove: (label: string, direction: -1 | 1) => void
      }
    | undefined
  onToggle?: () => void
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 14 }}>
      {/* Flex rather than a float, so the controls sit at the right edge with
          real space between them and the label. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div
          onClick={onToggle}
          {...(collapsible
            ? { role: 'button', 'aria-expanded': !!open, 'aria-label': title }
            : {})}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: accent ? '#f28b82' : theme.muted,
            cursor: collapsible ? 'pointer' : 'default',
          }}
        >
          {collapsible && <span style={{ marginRight: 4 }}>{open ? '▾' : '▸'}</span>}
          {title}
          {/* Remaining effort, so a heavy week is visible before you open it. */}
          {!!effort && <span style={{ color: theme.muted }}> · {formatEffort(effort)}</span>}
        </div>

        {reorder && (
          <>
            <ReorderButton
              theme={theme}
              label={`Move ${reorder.label} up`}
              disabled={!reorder.canUp}
              onClick={() => reorder.onMove(reorder.label, -1)}
            >
              ↑
            </ReorderButton>
            <ReorderButton
              theme={theme}
              label={`Move ${reorder.label} down`}
              disabled={!reorder.canDown}
              onClick={() => reorder.onMove(reorder.label, 1)}
            >
              ↓
            </ReorderButton>
          </>
        )}

        {handle}
      </div>

      {action && (
        <button
          aria-label={action.label}
          onClick={action.onClick}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontSize: 11,
            color: theme.accent,
            marginBottom: 4,
          }}
        >
          {action.label}
        </button>
      )}
      {children}
    </section>
  )
}

/**
 * The count is only exact once completed tasks have been fetched. Before that
 * we may still know about tasks completed in this session, so the count is
 * shown with a "+" rather than pretending to be the total.
 */
function completedTitle(known: number, loaded: boolean, loading: boolean): string {
  if (loading) return 'Completed (loading…)'
  if (loaded) return `Completed (${known})`
  return known > 0 ? `Completed (${known}+)` : 'Completed'
}

/** Selects everything between the cursor and the clicked row, inclusive. */
function extendSelection(
  current: ReadonlySet<string>,
  order: string[],
  from: string | null,
  to: string,
): Set<string> {
  const next = new Set(current)
  const start = from ? order.indexOf(from) : -1
  const end = order.indexOf(to)

  if (start === -1 || end === -1) {
    // No anchor to extend from, so treat it as toggling one row.
    if (next.has(to)) next.delete(to)
    else next.add(to)
    return next
  }

  for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
    const id = order[i]
    if (id) next.add(id)
  }
  return next
}

function SearchBox({
  theme,
  value,
  onChange,
  onClose,
}: {
  theme: Theme
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <input
        id="bt-search"
        autoFocus
        value={value}
        aria-label="Search tasks"
        placeholder="Search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.currentTarget.blur()
            onClose()
          }
        }}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          width: '100%',
          fontSize: 12,
          padding: '5px 10px',
          borderRadius: 6,
          border: `1px solid ${theme.border}`,
          color: theme.text,
        }}
      />
      {value && (
        <button
          aria-label="Clear search"
          onClick={onClose}
          style={{
            all: 'unset',
            cursor: 'pointer',
            position: 'absolute',
            insetInlineEnd: 8,
            top: 4,
            color: theme.muted,
            fontSize: 12,
          }}
        >
          ✕
        </button>
      )}
    </div>
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

      <div style={{ gridColumn: '1 / -1', marginTop: 6, color: theme.text, fontWeight: 600 }}>
        Capture syntax
      </div>
      <div style={{ gridColumn: '1 / -1', color: theme.muted, marginBottom: 2 }}>
        Works in the add field and in tasks captured on your phone.
      </div>

      {CAPTURE_SYNTAX.map(([example, description]) => (
        <Fragment key={example}>
          <kbd style={{ color: theme.accent, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {example}
          </kbd>
          <span style={{ color: theme.muted }}>{description}</span>
        </Fragment>
      ))}
    </div>
  )
}

/**
 * The convention that lets a task typed on a phone arrive fully tagged. Shown
 * here because a syntax nobody can find is a syntax nobody uses.
 */
const CAPTURE_SYNTAX: [string, string][] = [
  ['math 458', 'Class, from a course code'],
  ['#thesis', 'Class, for anything not a course'],
  ['fri, tomorrow', 'Due date'],
  ['fri 5pm', 'Due date with a time'],
  ['90m, 2h', 'Effort estimate'],
  ['!1 !2 !3', 'Priority, 1 highest'],
]

function ReorderButton({
  theme,
  label,
  disabled,
  onClick,
  children,
}: {
  theme: Theme
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: disabled ? 'default' : 'pointer',
        padding: '0 4px',
        color: disabled ? theme.border : theme.muted,
      }}
    >
      {children}
    </button>
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
