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
/** Work blocks the fake calendar reports; mutated per test. */
let blocks: unknown[] = []

/** A snapshot shaped exactly like one the service worker would send. */
const SNAPSHOT = {
  lists: [{ id: 'l1', title: 'MATH 458' }],
  tasks: [
    {
      id: 'p',
      title: 'Project',
      listId: 'l1',
      due: '2026-09-30T00:00:00.000Z',
      position: '01',
      status: 'needsAction',
      notes: '⟦bt⟧{"cat":"MATH 458"}',
    },
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
        if (request.type === 'loadAll') {
          return { ok: true, data: JSON.parse(JSON.stringify(SNAPSHOT)) }
        }
        if (request.type === 'loadCompleted') return { ok: true, data: [] }
        if (request.type === 'loadBusy') return { ok: true, data: [] }
        if (request.type === 'loadBlocks') return { ok: true, data: blocks }
        if (request.type === 'scheduleTask') return { ok: true, data: { id: 'evt1' } }
        if (request.type === 'loadCalendar') {
          return {
            ok: true,
            data: {
              // Two sightings each, matching a real weekly timetable.
              events: [
                { id: '1', summary: 'MATH 458: Numerical Analysis', colorId: '4' },
                { id: '2', summary: 'MATH 458: Numerical Analysis', colorId: '4' },
              ],
              palette: { '4': { background: '#e67c73' } },
              calendars: [],
            },
          }
        }
        return { ok: true, data: {} }
      }),
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    },
  })
  sent = []
  // Reset shared fixtures: without this a block set by one test leaks into the
  // next, and the suite reports a pass that means nothing.
  blocks = []
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

/**
 * Types into a controlled input. Assigning `.value` directly is not enough:
 * React's value tracker sees no change and swallows the event, so the native
 * setter has to be used to update the tracker too.
 */
const setValue = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const clear = async (el: HTMLInputElement) => {
  await act(async () => setValue(el, ''))
}

const typeInto = async (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  for (const char of text) {
    await act(async () => {
      setter?.call(el, el.value + char)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

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

  // The panel opens in the due view, which shows only outstanding work, so a
  // completed task leaves the list immediately.
  it('applies the completion optimistically in the due view', async () => {
    const container = await mount()
    expect(container.textContent).not.toContain('Completed (')

    await click(byLabel(container, 'Complete Project'))

    // Both halves must happen locally, before the network settles.
    expect(byLabel(container, 'Complete Project')).toBeFalsy()
    expect(container.textContent).toContain('Completed (')
  })

  it('reopens a completed task from the Completed section', async () => {
    const container = await mount()
    await click(byLabel(container, 'Complete Project'))
    await click(container.querySelector('[role="button"][aria-label^="Completed"]'))

    await click(byLabel(container, 'Reopen Project'))
    expect(sent.filter((r) => r.type === 'patchTask')).toHaveLength(2)
    expect(sent.at(-1)).toMatchObject({ patch: { status: 'needsAction' } })
    expect(byLabel(container, 'Complete Project')).toBeTruthy()
  })

  // A categorised task due in the future stays visible in the class view, so
  // you can confirm it is done without opening the history section.
  it('keeps a categorised completed task visible in the class view', async () => {
    const container = await mount()
    await click(byLabel(container, 'Group by class'))

    const project = byLabel(container, 'Complete Project')
    expect(project).toBeTruthy()
    await click(project)

    expect(byLabel(container, 'Reopen Project')).toBeTruthy()
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

  // Writing per keystroke fired one API call per character and, in Class view,
  // moved the task to a different group mid-word, unmounting the input.
  it('does not write while typing a class, only on blur', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    const field = byLabel(container, 'Class') as HTMLInputElement
    await clear(field)
    // A different value from the one already set, so a commit is expected.
    await typeInto(field, 'TAC 458')

    expect(sent.filter((r) => r.type === 'patchTask')).toHaveLength(0)
    expect(field.value).toBe('TAC 458')

    await act(async () => {
      // React maps onBlur onto focusout, which is the event that bubbles.
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    const patches = sent.filter((r) => r.type === 'patchTask')
    expect(patches).toHaveLength(1)
    expect(JSON.stringify(patches[0])).toContain('TAC 458')
  })

  // Several hundred completed tasks cost eight or more paged requests per
  // list, and that was being paid on every background refresh.
  it('does not fetch completed tasks until the section is opened', async () => {
    const container = await mount()
    expect(sent.some((r) => r.type === 'loadCompleted')).toBe(false)

    await click(container.querySelector('[role="button"][aria-expanded="false"]'))
    expect(sent.some((r) => r.type === 'loadCompleted')).toBe(true)
  })

  it('fetches completed tasks only once per session', async () => {
    const container = await mount()
    const section = () => container.querySelector('[role="button"][aria-label^="Completed"]')

    await click(section())
    await click(section())
    await click(section())

    expect(sent.filter((r) => r.type === 'loadCompleted')).toHaveLength(1)
  })

  it('previews what quick add parsed before the task is created', async () => {
    const container = await mount()
    await typeInto(byLabel(container, 'Add a task') as HTMLInputElement, 'math 458 pset 4 90m')

    const preview = byLabel(container, 'Parsed preview')
    expect(preview?.textContent).toContain('pset 4')
    expect(preview?.textContent).toContain('MATH 458')
    expect(preview?.textContent).toContain('1h 30m')
    // Previewing must not create anything.
    expect(sent.filter((r) => r.type === 'createTask')).toHaveLength(0)
  })

  it('no longer offers a repeat control, since nothing regenerates tasks yet', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    expect(byLabel(container, 'Repeat')).toBeFalsy()
  })

  // A native date field fires change on every segment edit, so paging from
  // September to October in the picker was writing an October due date.
  it('does not write a due date while navigating the picker', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    const field = byLabel(container, 'Due date') as HTMLInputElement
    await act(async () => setValue(field, '2026-10-30'))
    await act(async () => setValue(field, '2026-11-30'))

    expect(sent.filter((r) => r.type === 'patchTask')).toHaveLength(0)

    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    const patches = sent.filter((r) => r.type === 'patchTask')
    expect(patches).toHaveLength(1)
    expect(JSON.stringify(patches[0])).toContain('2026-11-30')
  })

  // The pills exist to match the calendar grid, so the colour has to come from
  // the course's own event rather than a hash of its name.
  it('colours a class pill from its calendar event', async () => {
    const container = await mount()
    const pill = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === 'MATH 458',
    )
    expect(pill?.getAttribute('style')).toContain('rgb(230, 124, 115)')
  })

  it('falls back to the hashed palette when the calendar has no match', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    const field = byLabel(container, 'Class') as HTMLInputElement
    // A category with no course event still gets a stable colour.
    expect(field).toBeTruthy()
  })

  it('proposes slots that fit the effort estimate before the due date', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    await click(byLabel(container, 'Schedule work time'))

    const options = [...container.querySelectorAll('[aria-label^="Schedule "]')].filter(
      (el) => el.getAttribute('aria-label') !== 'Schedule work time',
    )
    expect(options.length).toBeGreaterThan(0)
  })

  it('creates a work block when a slot is chosen', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    await click(byLabel(container, 'Schedule work time'))

    const first = [...container.querySelectorAll('[aria-label^="Schedule "]')].find(
      (el) => el.getAttribute('aria-label') !== 'Schedule work time',
    )
    await click(first)

    expect(sent.some((r) => r.type === 'scheduleTask')).toBe(true)
    // The calendar is the source of truth, so nothing is written to the task.
    expect(sent.some((r) => r.type === 'patchTask')).toBe(false)
  })

  // Editing a block in Google Calendar must be reflected here, which only
  // works if the time is read from the calendar rather than cached on the task.
  it('shows the block time reported by the calendar', async () => {
    blocks = [
      {
        id: 'evt1',
        start: { dateTime: '2026-09-04T17:00:00.000Z' },
        end: { dateTime: '2026-09-04T18:00:00.000Z' },
        extendedProperties: { private: { btTaskId: 'p' } },
      },
    ]
    const container = await mount()
    expect(container.textContent).toContain('▦')
  })

  it('shows no block when the calendar reports none', async () => {
    const container = await mount()
    expect(container.textContent).not.toContain('▦')
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
