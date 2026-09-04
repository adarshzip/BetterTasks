import { useEffect, type RefObject } from 'react'

/**
 * Calls back when a pointer press lands outside the referenced element.
 *
 * This replaces a focus-based close, which was unreliable for two reasons: it
 * never fired if the user had not focused a field inside the editor, and it
 * fired wrongly when focus moved to the title input, which lives on the row
 * rather than inside the editor. A pointer press is unambiguous either way.
 *
 * Uses `pointerdown` rather than `click` so the editor closes on press rather
 * than release, which is what makes it feel immediate. That timing is also why
 * the handler receives the target: closing shifts the layout, so by the time a
 * `click` would land the pointer is over something else, and clicking straight
 * from one task to another would otherwise just close the first.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: (target: Element | null) => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      // A press inside the group, including on the row itself, is not "outside".
      if (ref.current?.contains(target)) return
      onOutside(target instanceof Element ? target : null)
    }

    // Capture phase, so a handler that stops propagation cannot swallow it.
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [ref, onOutside, active])
}
