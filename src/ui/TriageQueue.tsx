import { useState } from 'react'
import type { Theme } from './theme'
import { describeSuggestion, type Suggestion } from '@/model/triage'

/**
 * Tasks captured elsewhere that still carry unapplied syntax.
 *
 * A task added on a phone during a lecture arrives as a plain title, because
 * the mobile app cannot write class, effort, or priority. If the title was
 * typed in the quick-add syntax, this recovers it.
 *
 * Collapsed by default: it should announce itself without taking over the top
 * of the panel, since the list underneath is still the point.
 */
interface Props {
  theme: Theme
  suggestions: Suggestion[]
  onApply: (suggestion: Suggestion) => void
  onApplyAll: () => void
  onDismiss: (taskId: string) => void
}

export function TriageQueue({ theme, suggestions, onApply, onApplyAll, onDismiss }: Props) {
  const [open, setOpen] = useState(false)
  if (suggestions.length === 0) return null

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 6,
        border: `1px solid ${theme.accent}55`,
        background: theme.surface,
        fontSize: 11,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
        <button
          aria-label={open ? 'Hide captured tasks' : 'Show captured tasks'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={{ all: 'unset', cursor: 'pointer', color: theme.text, flex: 1 }}
        >
          {open ? '▾' : '▸'} {suggestions.length} captured{' '}
          {suggestions.length === 1 ? 'task looks' : 'tasks look'} taggable
        </button>

        <button aria-label="Tag all captured tasks" onClick={onApplyAll} style={chip(theme)}>
          Tag all
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 8px 8px' }}>
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.taskId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
                borderTop: `1px solid ${theme.border}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: theme.text }}>{suggestion.title}</div>
                <div style={{ color: theme.muted, marginTop: 1 }}>
                  {/* The original, so the change is reviewable rather than silent. */}
                  <s>{suggestion.before}</s>
                  {describeSuggestion(suggestion).length > 0 && (
                    <span style={{ color: theme.accent }}>
                      {' '}
                      → {describeSuggestion(suggestion).join(' · ')}
                    </span>
                  )}
                </div>
              </div>

              <button
                aria-label={`Tag ${suggestion.before}`}
                onClick={() => onApply(suggestion)}
                style={chip(theme)}
              >
                Tag
              </button>
              <button
                aria-label={`Leave ${suggestion.before} alone`}
                onClick={() => onDismiss(suggestion.taskId)}
                style={chip(theme)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function chip(theme: Theme): React.CSSProperties {
  return {
    all: 'unset',
    cursor: 'pointer',
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    color: theme.text,
  }
}
