/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboard, type KeyboardActions } from './useKeyboard'

const actions = (): KeyboardActions => ({
  moveCursor: vi.fn(),
  toggleDetail: vi.fn(),
  toggleComplete: vi.fn(),
  indent: vi.fn(),
  outdent: vi.fn(),
  nudge: vi.fn(),
  remove: vi.fn(),
  focusQuickAdd: vi.fn(),
  dismiss: vi.fn(),
  undo: vi.fn(),
})

let api: KeyboardActions

const press = (key: string, init: KeyboardEventInit = {}, target?: HTMLElement) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
  return event
}

beforeEach(() => {
  api = actions()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useKeyboard', () => {
  const mount = (enabled = true) => renderHook(() => useKeyboard(api, enabled))

  it('moves the cursor with j and k', () => {
    mount()
    press('j')
    press('k')
    expect(api.moveCursor).toHaveBeenNthCalledWith(1, 1)
    expect(api.moveCursor).toHaveBeenNthCalledWith(2, -1)
  })

  it('accepts arrows as well as vi keys', () => {
    mount()
    press('ArrowDown')
    expect(api.moveCursor).toHaveBeenCalledWith(1)
  })

  it('completes with space and opens with enter', () => {
    mount()
    press(' ')
    press('Enter')
    expect(api.toggleComplete).toHaveBeenCalled()
    expect(api.toggleDetail).toHaveBeenCalled()
  })

  it('indents with tab and outdents with shift tab', () => {
    mount()
    press('Tab')
    press('Tab', { shiftKey: true })
    expect(api.indent).toHaveBeenCalledOnce()
    expect(api.outdent).toHaveBeenCalledOnce()
  })

  it('reorders with alt and an arrow', () => {
    mount()
    press('ArrowUp', { altKey: true })
    expect(api.nudge).toHaveBeenCalledWith('up')
    expect(api.moveCursor).not.toHaveBeenCalled()
  })

  it('undoes with the platform modifier', () => {
    mount()
    press('z', { metaKey: true })
    press('z', { ctrlKey: true })
    expect(api.undo).toHaveBeenCalledTimes(2)
  })

  it('prevents default only for keys it handles', () => {
    mount()
    expect(press('j').defaultPrevented).toBe(true)
    expect(press('q').defaultPrevented).toBe(false)
  })

  // The bug this guards against: typing a task title completing a task because
  // the space bar was treated as a shortcut.
  it('ignores keystrokes while a text field has focus', () => {
    mount()
    const input = document.createElement('input')
    document.body.appendChild(input)

    press(' ', {}, input)
    press('j', {}, input)
    press('#', {}, input)

    expect(api.toggleComplete).not.toHaveBeenCalled()
    expect(api.moveCursor).not.toHaveBeenCalled()
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('still lets escape leave a text field', () => {
    mount()
    const input = document.createElement('input')
    input.blur = vi.fn()
    document.body.appendChild(input)

    press('Escape', {}, input)
    expect(input.blur).toHaveBeenCalled()
  })

  it('does nothing while disabled', () => {
    mount(false)
    press('j')
    expect(api.moveCursor).not.toHaveBeenCalled()
  })
})
