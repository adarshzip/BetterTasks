import type { Theme } from './theme'

/**
 * Actions across a multi-row selection.
 *
 * Tagging thirty tasks with a class one at a time in September is the tedious
 * case the quick-add parser only half solves, since it only helps tasks you
 * are creating right now.
 */
interface Props {
  theme: Theme
  count: number
  categories: string[]
  onSetCategory: (category: string) => void
  onSnooze: (days: number) => void
  onClear: () => void
}

export function BulkBar({ theme, count, categories, onSetCategory, onSnooze, onClear }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 8,
        padding: '6px 8px',
        borderRadius: 6,
        background: theme.surface,
        border: `1px solid ${theme.accent}55`,
        fontSize: 11,
      }}
    >
      <strong style={{ color: theme.text }}>{count} selected</strong>

      <select
        aria-label="Set class for selection"
        value=""
        onChange={(e) => e.target.value && onSetCategory(e.target.value)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          fontSize: 11,
          padding: '3px 8px',
          borderRadius: 4,
          border: `1px solid ${theme.border}`,
          color: theme.text,
        }}
      >
        <option value="">Set class…</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>

      <button aria-label="Selection due tomorrow" onClick={() => onSnooze(1)} style={chip(theme)}>
        Tomorrow
      </button>
      <button aria-label="Selection due next week" onClick={() => onSnooze(7)} style={chip(theme)}>
        Next week
      </button>

      <span style={{ flex: 1 }} />

      <button aria-label="Clear selection" onClick={onClear} style={chip(theme)}>
        Clear
      </button>
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
