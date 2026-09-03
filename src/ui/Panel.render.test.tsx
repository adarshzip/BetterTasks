/**
 * @vitest-environment jsdom
 *
 * Smoke test for the side panel. The panel rendered as a blank page twice, in
 * two different hosts, with no visible error. This mounts it the same way the
 * side panel does so any render-time failure surfaces here instead of as a
 * white rectangle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Panel } from './Panel'
import { detectTheme } from './theme'

/** Records every request the panel sends to the service worker. */
let sent: { type: string; [k: string]: unknown }[] = []

/** A snapshot shaped exactly like one the service worker would send. */
const SNAPSHOT = {
  lists: [{ id: 'l1', title: 'MATH 458' }],
  tasks: [
    { id: 'p', title: 'Project', listId: 'l1', due: '2026-09-30T00:00:00.000Z', position: '01', status: 'needsAction' },
    { id: 'c', title: 'Step one', listId: 'l1', parent: 'p', due: '2026-09-04T00:00:00.000Z', position: '01', status: 'needsAction' },
    { id: 'n', title: 'No date', listId: 'l1', position: '02', status: 'needsAction' },
  ],
}

beforeEach(() => {
  vi.stubGlobal('chrome', {
    // JSON.parse(JSON.stringify(...)) is not decoration: chrome.runtime
    // .sendMessage serializes with JSON, and sending Date objects through it
    // silently turned them into strings, which crashed the whole panel.
    runtime: {
      sendMessage: vi.fn(async (request: { type: string }) => {
        sent.push(request)
        return request.type === 'loadAll'
          ? { ok: true, data: JSON.parse(JSON.stringify(SNAPSHOT)) }
          : { ok: true, data: {} }
      }),
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  })
  sent = []
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

const mount = async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(<Panel theme={detectTheme()} />)
  })
  return container
}

describe('Panel', () => {
  it('renders without throwing', async () => {
    const container = await mount()
    expect(container.innerHTML).not.toBe('')
    expect(container.textContent).toContain('BetterTasks')
  })

  it('renders tasks that arrived over the JSON message boundary', async () => {
    const container = await mount()
    expect(container.textContent).toContain('Project')
    expect(container.textContent).toContain('Step one')
    expect(container.textContent).toContain('No date')
  })

  it('formats a due date rather than crashing on a serialized string', async () => {
    const container = await mount()
    // Would throw "due.getFullYear is not a function" if dates stayed strings.
    expect(container.textContent).toContain('Sep 30')
  })
})

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const byLabel = (root: Element, label: string) =>
  root.querySelector(`[aria-label="${label}"]`)

describe('Panel interactions', () => {
  it('offers a quick add field', async () => {
    const container = await mount()
    expect(byLabel(container, 'Add a task')).toBeTruthy()
  })

  it('completes a task through the checkbox', async () => {
    const container = await mount()
    await click(byLabel(container, 'Complete Project'))

    const patch = sent.find((r) => r.type === 'patchTask')
    expect(patch).toMatchObject({ taskId: 'p', patch: { status: 'completed' } })
  })

  it('applies the completion optimistically before the request settles', async () => {
    const container = await mount()
    expect(container.textContent).not.toContain('Completed (')

    await click(byLabel(container, 'Complete Project'))

    // Completing moves the task out of the active list and into the collapsed
    // Completed section. Both halves must happen locally, before the network.
    expect(byLabel(container, 'Complete Project')).toBeFalsy()
    expect(container.textContent).toContain('Completed (')
  })

  it('reopens a completed task from the Completed section', async () => {
    const container = await mount()
    await click(byLabel(container, 'Complete Project'))

    await click(container.querySelector('[role="button"][aria-expanded="false"]'))

    await click(byLabel(container, 'Reopen Project'))
    expect(sent.filter((r) => r.type === 'patchTask')).toHaveLength(2)
    expect(sent.at(-1)).toMatchObject({ patch: { status: 'needsAction' } })
  })

  it('opens the detail editor when a task is clicked', async () => {
    const container = await mount()
    expect(byLabel(container, 'Due date')).toBeFalsy()

    await click(container.querySelector('div[style*="cursor: pointer"]'))
    expect(byLabel(container, 'Details')).toBeTruthy()
    expect(byLabel(container, 'Due date')).toBeTruthy()
  })

  it('offers a category field so Class view works with a single list', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    const field = byLabel(container, 'Class') as HTMLInputElement
    expect(field).toBeTruthy()
    // Falls back to the list name when no category is set.
    expect(field.placeholder).toBe('MATH 458')
  })

  it('shows drag handles when a group holds one list', async () => {
    const container = await mount()
    expect(container.querySelectorAll('[aria-label="Reorder"]').length).toBeGreaterThan(0)
  })

  // One level of nesting: indent must be disabled for a task that is already
  // a child, rather than failing at the API after an optimistic update.
  it('disables indent for a task that is already nested', async () => {
    const container = await mount()

    const rows = [...container.querySelectorAll('div[style*="cursor: pointer"]')]
    const childRow = rows.find((r) => r.textContent?.includes('Step one'))
    await click(childRow)

    expect((byLabel(container, 'Indent') as HTMLButtonElement).disabled).toBe(true)
    expect((byLabel(container, 'Outdent') as HTMLButtonElement).disabled).toBe(false)
  })
})
