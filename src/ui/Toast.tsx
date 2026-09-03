import type { Theme } from './theme'

/**
 * Undo and error surface.
 *
 * Undo matters most for delete: Google Tasks has no trash, so an accidental
 * delete is otherwise permanent. Undoing a delete recreates the task, which
 * means it comes back with a new id.
 */
interface Props {
  theme: Theme
  undoLabel: string | null
  error: string
  onUndo: () => void
  onDismissUndo: () => void
  onDismissError: () => void
}

export function Toast({
  theme,
  undoLabel,
  error,
  onUndo,
  onDismissUndo,
  onDismissError,
}: Props) {
  if (!undoLabel && !error) return null

  const danger = !!error

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        bottom: 8,
        margin: '8px 0 0',
        padding: '8px 10px',
        borderRadius: 6,
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: theme.surface,
        border: `1px solid ${danger ? '#f28b8255' : theme.border}`,
        color: danger ? '#f28b82' : theme.text,
      }}
    >
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{error || undoLabel}</span>

      {!danger && (
        <button onClick={onUndo} style={linkStyle(theme.accent)}>
          Undo
        </button>
      )}

      <button
        aria-label="Dismiss"
        onClick={danger ? onDismissError : onDismissUndo}
        style={linkStyle(theme.muted)}
      >
        ✕
      </button>
    </div>
  )
}

function linkStyle(color: string): React.CSSProperties {
  return {
    all: 'unset',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    color,
  }
}
