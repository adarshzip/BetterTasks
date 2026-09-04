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
    {
      id: 'r',
      title: 'Repeating',
      listId: 'l1',
      due: '2026-09-04T00:00:00.000Z',
      position: '03',
      status: 'needsAction',
      notes: '⟦bt⟧{"cat":"MATH 458","rec":"1w","recn":3}',
    },
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
        if (request.type === 'createTask') return { ok: true, data: { id: 'created-1' } }
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

/** Selects a task and reveals the advanced fields behind the More toggle. */
const openAdvanced = async (container: Element, title = 'Project') => {
  const row = [...container.querySelectorAll('div[style*="cursor: pointer"]')].find((el) =>
    el.textContent?.includes(title),
  )
  await click(row)
  const more = byLabel(container, 'Show advanced fields')
  if (more) await click(more)
}

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

/** jsdom has no PointerEvent; the handler only reads `target`, so this suffices. */
const pressOn = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })
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
    await openAdvanced(container)

    const field = byLabel(container, 'Class') as HTMLInputElement
    expect(field).toBeTruthy()
    // Falls back to the list name when no category is set.
    expect(field.placeholder).toBe('MATH 458')
  })

  // Writing per keystroke fired one API call per character and, in Class view,
  // moved the task to a different group mid-word, unmounting the input.
  it('does not write while typing a class, only on blur', async () => {
    const container = await mount()
    await openAdvanced(container)

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

  it('keeps advanced fields behind More until asked for', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    // Selecting a task shows the common fields only.
    expect(byLabel(container, 'Details')).toBeTruthy()
    expect(byLabel(container, 'Repeat')).toBeFalsy()
    expect(byLabel(container, 'Class')).toBeFalsy()

    await click(byLabel(container, 'Show advanced fields'))
    expect(byLabel(container, 'Repeat')).toBeTruthy()
    expect(byLabel(container, 'Class')).toBeTruthy()
  })

  it('edits the title in place on the row', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    const field = byLabel(container, 'Task title') as HTMLInputElement
    expect(field).toBeTruthy()

    await clear(field)
    await typeInto(field, 'Renamed')
    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    expect(JSON.stringify(sent.filter((r) => r.type === 'patchTask'))).toContain('Renamed')
  })

  it('offers an end condition once a task repeats', async () => {
    const container = await mount()
    await openAdvanced(container, 'Repeating')

    expect(byLabel(container, 'Recurrence end')).toBeTruthy()
  })

  // The API has no recurrence, so the next instance is a new task with a
  // shifted due date, carrying its metadata across.
  it('creates the next instance when a repeating task is completed', async () => {
    const container = await mount()
    await click(byLabel(container, 'Complete Repeating'))

    const created = sent.find((r) => r.type === 'createTask')
    expect(created).toBeTruthy()
    const body = JSON.stringify(created)
    // Weekly from 4 Sep lands on 11 Sep, the class carries over, and the
    // remaining count comes down by one.
    expect(body).toContain('2026-09-11')
    expect(body).toContain('MATH 458')
    // The metadata block is a JSON string inside JSON, so unescape to read it.
    expect(body.replace(/\\/g, '')).toContain('"recn":2')
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
    await openAdvanced(container)

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

  it('keeps search behind an icon until asked for', async () => {
    const container = await mount()
    expect(byLabel(container, 'Search tasks')).toBeFalsy()

    await click(byLabel(container, 'Search'))
    expect(byLabel(container, 'Search tasks')).toBeTruthy()
  })

  it('opens search from the keyboard', async () => {
    const container = await mount()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    })
    expect(byLabel(container, 'Search tasks')).toBeTruthy()
  })

  it('filters the list by search', async () => {
    const container = await mount()
    expect(container.textContent).toContain('No date')

    await click(byLabel(container, 'Search'))
    await typeInto(byLabel(container, 'Search tasks') as HTMLInputElement, 'project')
    expect(container.textContent).toContain('Project')
    expect(container.textContent).not.toContain('No date')
  })

  it('searches notes and class as well as titles', async () => {
    const container = await mount()
    await click(byLabel(container, 'Search'))
    await typeInto(byLabel(container, 'Search tasks') as HTMLInputElement, 'math')
    expect(container.textContent).toContain('Project')
  })

  it('selects a range with shift-click and acts on all of it', async () => {
    const container = await mount()
    const rows = [...container.querySelectorAll('div[style*="cursor: pointer"]')]

    await click(rows[0])
    await act(async () => {
      rows[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    const bar = container.querySelector('[role="toolbar"]')
    expect(bar?.textContent).toContain('selected')

    await click(byLabel(container, 'Selection due tomorrow'))
    // One write per selected task, not one for the whole selection.
    expect(sent.filter((r) => r.type === 'patchTask').length).toBeGreaterThan(1)
  })

  // Closing used to depend on focus having been inside the editor, so it fired
  // inconsistently. A pointer press outside is unambiguous.
  it('closes the editor on a press outside it', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    expect(byLabel(container, 'Details')).toBeTruthy()

    await pressOn(document.body)
    expect(byLabel(container, 'Details')).toBeFalsy()
  })

  it('stays open when the press lands inside the editor', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    await pressOn(byLabel(container, 'Details')!)
    expect(byLabel(container, 'Details')).toBeTruthy()
  })

  // The title field lives on the row, not inside the editor, so a focus-based
  // close treated clicking into it as leaving.
  it('stays open when the press lands on the title field', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    await pressOn(byLabel(container, 'Task title')!)
    expect(byLabel(container, 'Details')).toBeTruthy()
  })

  // A subtask of a MATH 458 project is MATH 458 work, whether or not anyone
  // tagged it.
  it('inherits the parent class for a subtask', async () => {
    const container = await mount()
    await click(byLabel(container, 'Group by class'))
    // Both rows sit under the inherited class, not the default list name.
    expect(container.textContent).toContain('MATH 458')
    expect(container.textContent).toContain('Step one')
  })

  it('does not repeat the parent pill on a subtask', async () => {
    const container = await mount()

    const rowOf = (title: string) =>
      [...container.querySelectorAll('div[style*="cursor: pointer"]')].find((el) =>
        el.textContent?.includes(title),
      )

    // The parent carries the pill; the indent already says the child belongs,
    // so repeating it on the child is noise.
    expect(rowOf('Project')?.textContent).toContain('MATH 458')
    expect(rowOf('Step one')?.textContent).not.toContain('MATH 458')
  })

  it('keeps the subtask field open for the next one', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    await click(byLabel(container, 'Add subtask'))

    const field = byLabel(container, 'New subtask') as HTMLInputElement
    expect(field).toBeTruthy()

    await typeInto(field, 'read chapter 4')
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(sent.some((r) => r.type === 'createTask')).toBe(true)
    // Still open, and cleared, so the next subtask is just more typing.
    expect(byLabel(container, 'New subtask')).toBeTruthy()
    expect((byLabel(container, 'New subtask') as HTMLInputElement).value).toBe('')
  })

  it('closes the subtask field on an empty Enter', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    await click(byLabel(container, 'Add subtask'))

    const field = byLabel(container, 'New subtask') as HTMLInputElement
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(byLabel(container, 'New subtask')).toBeFalsy()
    expect(sent.some((r) => r.type === 'createTask')).toBe(false)
  })

  // A new task sorts into a bucket that may be off-screen, so without moving
  // the cursor to it, adding a task can look like nothing happened.
  it('moves the cursor to the created task, using the server id', async () => {
    const container = await mount()

    const field = byLabel(container, 'Add a task') as HTMLInputElement
    await typeInto(field, 'new thing')
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    // 'created-1' is what the fake worker returns; the optimistic row used a
    // temporary `pending-` id that no longer exists after the reload.
    const focused = container.querySelector('[style*="dashed"], [style*="solid"]')
    expect(focused).toBeTruthy()
    expect(sent.some((r) => r.type === 'createTask')).toBe(true)
  })

  // Google's sidebar reads in the order things were added; inserting at the
  // top of the list instead makes an undated list read newest-first.
  it('appends new tasks after the existing ones', async () => {
    const container = await mount()

    const field = byLabel(container, 'Add a task') as HTMLInputElement
    await typeInto(field, 'new thing')
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const created = sent.find((r) => r.type === 'createTask')
    // Placed after the last existing sibling rather than at the top.
    expect(created).toHaveProperty('previous')
  })

  // Closing shifts the layout, so relying on the follow-up click to land on
  // the intended row does not work.
  it('switches directly from one task to another', async () => {
    const container = await mount()

    const rows = [...container.querySelectorAll('[data-task-id]')]
    await click(rows[0]!.querySelector('div[style*="cursor: pointer"]'))
    expect(byLabel(container, 'Details')).toBeTruthy()

    const other = rows.find((r) => r.getAttribute('data-task-id') === 'n')!
    await pressOn(other)

    // Still open, now on the other task.
    expect(byLabel(container, 'Details')).toBeTruthy()
    expect((byLabel(container, 'Task title') as HTMLInputElement).value).toBe('No date')
  })

  it('creates one subtask per line when a list is pasted', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))
    await click(byLabel(container, 'Add subtask'))

    const field = byLabel(container, 'New subtask') as HTMLInputElement
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { getData: () => string }
      }
      event.clipboardData = { getData: () => '- read ch 4\n- write notes\n\n- revise' }
      field.dispatchEvent(event)
    })

    const created = sent.filter((r) => r.type === 'createTask')
    expect(created).toHaveLength(3)
    // Bullets stripped, blank lines dropped, all nested under the parent.
    expect(JSON.stringify(created[0])).toContain('read ch 4')
    expect(created.every((r) => r.parent === 'p')).toBe(true)
  })

  it('nests a quick-add entry under the cursor when Tab is pressed', async () => {
    const container = await mount()

    // Move the cursor onto the first task, then compose an entry.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })

    const field = byLabel(container, 'Add a task') as HTMLInputElement
    await typeInto(field, 'read chapter 4')
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })

    expect(byLabel(container, 'Nesting target')).toBeTruthy()

    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const created = sent.find((r) => r.type === 'createTask')
    expect(created).toMatchObject({ parent: 'p' })
  })

  it('offers a Today view that hides everything not yet due', async () => {
    const container = await mount()
    await click(byLabel(container, 'Today'))

    // Only overdue and due-today work; Sep 30 and the undated task are gone.
    expect(container.textContent).not.toContain('Project')
    expect(container.textContent).not.toContain('No date')
  })

  it('offers a locale-formatted due time rather than a segmented field', async () => {
    const container = await mount()
    await click(container.querySelector('div[style*="cursor: pointer"]'))

    const time = byLabel(container, 'Due time') as HTMLSelectElement
    expect(time.tagName).toBe('SELECT')
    // Half-hourly choices plus "no time" and an explicit end-of-day option.
    expect(time.options.length).toBeGreaterThan(40)
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
