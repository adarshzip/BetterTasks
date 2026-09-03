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
      sendMessage: vi.fn().mockResolvedValue({
        ok: true,
        data: JSON.parse(JSON.stringify(SNAPSHOT)),
      }),
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  })
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

describe('Panel', () => {
  const mount = async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(<Panel theme={detectTheme()} />)
    })
    return container
  }

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
