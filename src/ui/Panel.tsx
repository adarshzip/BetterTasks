import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GTaskList, WireTask } from '@/model/types'
import type { Theme } from './theme'
import { groupTasks, type ViewMode } from '@/model/grouping'
import { toTask } from '@/model/tree'
import { send, PanelError } from '@/lib/messaging'
import type { Snapshot } from '@/background/messages'
import { loadViewState, saveViewState } from '@/state/store'
import { TaskTree } from './TaskTree'

type Status = 'loading' | 'ready' | 'signedOut' | 'error'

export function Panel({ theme }: { theme: Theme }) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string>('')
  const [lists, setLists] = useState<GTaskList[]>([])
  const [wire, setWire] = useState<WireTask[]>([])
  const [mode, setMode] = useState<ViewMode>('due')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const snapshot = await send<Snapshot>({ type: 'loadAll' })
      setLists(snapshot.lists)
      setWire(snapshot.tasks)
      setStatus('ready')
    } catch (err) {
      if (err instanceof PanelError && err.needsAuth) {
        setStatus('signedOut')
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadViewState().then((state) => {
      setMode(state.mode)
      setCollapsed(new Set(state.collapsed))
    })
    void load()
  }, [load])

  const persist = useCallback((next: { mode?: ViewMode; collapsed?: ReadonlySet<string> }) => {
    void saveViewState({
      mode: next.mode ?? mode,
      collapsed: [...(next.collapsed ?? collapsed)],
    })
  }, [mode, collapsed])

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persist({ collapsed: next })
      return next
    })
  }, [persist])

  const switchMode = useCallback((next: ViewMode) => {
    setMode(next)
    persist({ mode: next })
  }, [persist])

  // Dates are rebuilt here, on this side of the JSON boundary.
  const { urgent, groups } = useMemo(() => {
    const tasks = wire.map((raw) => toTask(raw, raw.listId))
    return groupTasks(tasks, lists, mode)
  }, [wire, lists, mode])

  const signIn = useCallback(async () => {
    try {
      await send({ type: 'signIn' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [load])

  return (
    <div
      style={{
        fontFamily: 'Google Sans, Roboto, system-ui, sans-serif',
        background: theme.bg,
        color: theme.text,
        padding: 12,
        overflowY: 'auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Header theme={theme} mode={mode} onMode={switchMode} onRefresh={load} disabled={status !== 'ready'} />

      {status === 'loading' && <Notice theme={theme}>Loading tasks…</Notice>}

      {status === 'signedOut' && (
        <Notice theme={theme}>
          <div style={{ marginBottom: 8 }}>Connect your Google account to load tasks.</div>
          <button onClick={() => void signIn()} style={buttonStyle(theme)}>
            Sign in
          </button>
        </Notice>
      )}

      {status === 'error' && (
        <Notice theme={theme}>
          <div style={{ marginBottom: 8, color: '#f28b82' }}>{error}</div>
          <button onClick={() => void load()} style={buttonStyle(theme)}>
            Retry
          </button>
        </Notice>
      )}

      {status === 'ready' && (
        <>
          {urgent.length > 0 && (
            <Section title="Overdue and today" theme={theme} accent>
              <TaskTree
                nodes={urgent}
                lists={lists}
                theme={theme}
                showCategory
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
              />
            </Section>
          )}

          {groups.map((group) => (
            <Section key={group.key} title={group.label} theme={theme}>
              <TaskTree
                nodes={group.nodes}
                lists={lists}
                theme={theme}
                showCategory={mode === 'due'}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
              />
            </Section>
          ))}

          {urgent.length === 0 && groups.length === 0 && (
            <Notice theme={theme}>Nothing due. Nice work.</Notice>
          )}
        </>
      )}
    </div>
  )
}

function Header({
  theme,
  mode,
  onMode,
  onRefresh,
  disabled,
}: {
  theme: Theme
  mode: ViewMode
  onMode: (m: ViewMode) => void
  onRefresh: () => void
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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

      <button
        onClick={onRefresh}
        disabled={disabled}
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
  children,
}: {
  title: string
  theme: Theme
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: accent ? '#f28b82' : theme.muted,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </section>
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
