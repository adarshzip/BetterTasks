import { useEffect, useRef, useState } from 'react'

/**
 * A text field that keeps its own value while you type and commits on blur or
 * Enter.
 *
 * Writing on every keystroke is what broke the class field: each write patches
 * the task, which can move it to a different group, which unmounts the input
 * mid-word. It also fires one API call per character. Committing on blur fixes
 * both, and matches how Google's own task fields behave.
 */
export function useDraft<T extends string | number | undefined>(
  value: T,
  commit: (next: string) => void,
) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const editing = useRef(false)

  // Accept external changes only while the user is not mid-edit, so a
  // background refresh cannot overwrite half-typed text.
  useEffect(() => {
    if (!editing.current) setDraft(value === undefined ? '' : String(value))
  }, [value])

  return {
    value: draft,
    onFocus: () => {
      editing.current = true
    },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      editing.current = false
      if (draft !== (value === undefined ? '' : String(value))) commit(draft)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.currentTarget.blur()
      }
      if (e.key === 'Escape') {
        setDraft(value === undefined ? '' : String(value))
        editing.current = false
        e.currentTarget.blur()
      }
    },
  }
}
