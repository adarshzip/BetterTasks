import { useEffect } from 'react'

/**
 * Panel-wide keyboard navigation.
 *
 * The panel is a list touched dozens of times a day, and every action
 * currently needs a small pointer target. These bindings follow the vi-ish
 * convention most task tools use, so they cost nothing to learn.
 *
 * Nothing fires while a text field has focus, so typing a task title never
 * completes a task by accident.
 */
export interface KeyboardActions {
  moveCursor: (delta: number) => void
  toggleDetail: () => void
  toggleComplete: () => void
  indent: () => void
  outdent: () => void
  nudge: (direction: 'up' | 'down') => void
  remove: () => void
  focusQuickAdd: () => void
  dismiss: () => void
  undo: () => void
}

export const SHORTCUTS: [string, string][] = [
  ['j / ↓', 'Next task'],
  ['k / ↑', 'Previous task'],
  ['Enter / e', 'Open or close the editor'],
  ['Space', 'Complete or reopen'],
  ['Tab / ⇧Tab', 'Indent or outdent'],
  ['⌥↑ / ⌥↓', 'Move up or down'],
  ['n / /', 'Add a task'],
  ['#', 'Delete task'],
  ['⌘Z', 'Undo'],
  ['Esc', 'Close the editor'],
]

export function useKeyboard(actions: KeyboardActions, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const handler = (event: KeyboardEvent): void => {
      // Escape is the one key that must work from inside a field, since it is
      // how you get back out of one.
      if (isTyping(event.target)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur()
        return
      }

      const handled = dispatch(event, actions)
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [actions, enabled])
}

function dispatch(event: KeyboardEvent, actions: KeyboardActions): boolean {
  const { key, altKey, metaKey, ctrlKey, shiftKey } = event

  if ((metaKey || ctrlKey) && key.toLowerCase() === 'z') {
    actions.undo()
    return true
  }

  // Alt with an arrow reorders, matching the modifier most editors use for
  // moving a line.
  if (altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    actions.nudge(key === 'ArrowUp' ? 'up' : 'down')
    return true
  }

  if (metaKey || ctrlKey || altKey) return false

  switch (key) {
    case 'j':
    case 'ArrowDown':
      actions.moveCursor(1)
      return true

    case 'k':
    case 'ArrowUp':
      actions.moveCursor(-1)
      return true

    case 'Enter':
    case 'e':
      actions.toggleDetail()
      return true

    case ' ':
      actions.toggleComplete()
      return true

    case 'Tab':
      if (shiftKey) actions.outdent()
      else actions.indent()
      return true

    case 'n':
    case '/':
      actions.focusQuickAdd()
      return true

    case '#':
      actions.remove()
      return true

    case 'Escape':
      actions.dismiss()
      return true

    default:
      return false
  }
}

/** True when focus is somewhere that swallows plain keystrokes. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}
