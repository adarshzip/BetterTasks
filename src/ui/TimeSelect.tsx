import type { Theme } from './theme'

/**
 * A due-time picker.
 *
 * Replaces `input[type=time]`, which was awkward for three reasons: its
 * segments could not be tabbed between, its display format is dictated by the
 * OS locale rather than the user, and typing into segmented fields is fiddly
 * for a value that is almost always one of a handful of round times.
 *
 * The stored value stays "HH:MM" in 24-hour form, which is what the metadata
 * block holds; only the display is localised.
 */
interface Props {
  theme: Theme
  value: string | undefined
  disabled?: boolean
  onChange: (value: string | null) => void
}

/** Every half hour, plus end-of-day, which is the most common deadline of all. */
function options(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []

  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const value = toClock(minutes)
    out.push({ value, label: formatClock(value) })
  }

  out.push({ value: '23:59', label: `${formatClock('23:59')} (end of day)` })
  return out
}

const CHOICES = options()

export function TimeSelect({ theme, value, disabled, onChange }: Props) {
  // A time set elsewhere may not be on the half hour; keep it selectable
  // rather than silently snapping it to something else.
  const known = CHOICES.some((choice) => choice.value === value)

  return (
    <select
      aria-label="Due time"
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        fontSize: 12,
        padding: '5px 8px',
        width: 130,
        borderRadius: 4,
        border: `1px solid ${theme.border}`,
        background: theme.bg,
        color: disabled ? theme.muted : theme.text,
      }}
    >
      <option value="">No time</option>
      {!known && value && <option value={value}>{formatClock(value)}</option>}
      {CHOICES.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

function toClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Renders in the viewer's own locale, so 12- or 24-hour follows their setting. */
export function formatClock(clock: string): string {
  const [h, m] = clock.split(':').map(Number)
  if (h === undefined || m === undefined) return clock

  const date = new Date(2000, 0, 1, h, m)
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
