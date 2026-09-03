import { useCallback, useEffect, useRef, useState } from 'react'
import type { GTask, GTaskList, WireTask } from '@/model/types'
import type { Snapshot } from '@/background/messages'
import { send, PanelError } from '@/lib/messaging'
import { decodeNotes, encodeNotes, withMeta, type MetaPatch } from '@/model/metadata'
import { encodeDue } from '@/model/dates'
import {
  applyMutation,
  indentTarget,
  inverseOf,
  neighbourFor,
  positionAt,
  type Mutation,
} from './mutations'

/**
 * Owns tasks, mutations, and undo.
 *
 * Every mutation is optimistic. The Tasks API takes a few hundred milliseconds
 * per call, and a panel that freezes on every checkbox is not usable, so the
 * local state changes first and rolls back if the request fails.
 *
 * The rollback captures the array from BEFORE the change rather than computing
 * a reverse patch, because concurrent mutations would make a computed reverse
 * wrong. Undo is a separate concept and does use an inverse, since it must
 * survive later successful mutations.
 */

export type Status = 'loading' | 'ready' | 'signedOut' | 'error'

export interface UndoEntry {
  label: string
  mutation: Mutation
  listId: string
}

export interface TasksApi {
  status: Status
  error: string
  lists: GTaskList[]
  tasks: WireTask[]
  undo: UndoEntry | null

  load: (options?: { silent?: boolean }) => Promise<void>
  signIn: () => Promise<void>
  dismissError: () => void
  dismissUndo: () => void
  runUndo: () => Promise<void>

  createTask: (
    listId: string,
    title: string,
    parent?: string,
    extras?: { due?: Date; time?: string; category?: string; eff?: number; pri?: number },
  ) => Promise<void>
  setCompleted: (id: string, completed: boolean) => Promise<void>
  editTask: (id: string, fields: { title?: string; notes?: string }) => Promise<void>
  setDue: (id: string, date: Date | null, time?: string | null) => Promise<void>
  setMeta: (id: string, patch: MetaPatch) => Promise<void>
  removeTask: (id: string) => Promise<void>
  indent: (id: string) => Promise<void>
  outdent: (id: string) => Promise<void>
  nudge: (id: string, direction: 'up' | 'down') => Promise<void>
  moveToList: (id: string, listId: string) => Promise<void>
  moveTo: (id: string, parent: string | null, previous: string | null) => Promise<void>

  createList: (title: string) => Promise<void>
  renameList: (listId: string, title: string) => Promise<void>
  clearCompleted: (listId: string) => Promise<void>
}

export function useTasks(): TasksApi {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [lists, setLists] = useState<GTaskList[]>([])
  const [tasks, setTasks] = useState<WireTask[]>([])
  const [undo, setUndo] = useState<UndoEntry | null>(null)

  // Mutations read the current array without re-creating every callback.
  const current = useRef<WireTask[]>([])
  current.current = tasks

  /**
   * `silent` reconciles in the background. A create or a cross-list move needs
   * the server's real ids, but flipping to the loading state for that empties
   * the panel and makes every add look like a crash.
   */
  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setStatus('loading')
    try {
      const snapshot = await send<Snapshot>({ type: 'loadAll' })
      setLists(snapshot.lists)
      setTasks(snapshot.tasks)
      setStatus('ready')
    } catch (err) {
      if (err instanceof PanelError && err.needsAuth) {
        setStatus('signedOut')
        return
      }
      setError(message(err))
      // A failed background refresh leaves the optimistic state in place; only
      // a failed initial load has nothing to fall back to.
      if (!silent) setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const signIn = useCallback(async () => {
    try {
      await send({ type: 'signIn' })
      await load()
    } catch (err) {
      setError(message(err))
      setStatus('error')
    }
  }, [load])

  /**
   * Applies a mutation locally, sends the request, and restores the previous
   * array if it fails. `undoLabel` opts the mutation into the undo slot.
   */
  const run = useCallback(
    async (mutation: Mutation, request: () => Promise<unknown>, undoLabel?: string) => {
      const before = current.current
      const optimistic = applyMutation(before, mutation)
      setTasks(optimistic)

      if (undoLabel) {
        const inverse = inverseOf(before, mutation)
        const listId = listIdOf(before, mutation)
        if (inverse && listId) setUndo({ label: undoLabel, mutation: inverse, listId })
      }

      try {
        await request()
      } catch (err) {
        setTasks(before)
        setUndo(null)
        setError(message(err))
      }
    },
    [],
  )

  const find = useCallback((id: string) => current.current.find((t) => t.id === id), [])

  const createTask = useCallback(
    async (
      listId: string,
      title: string,
      parent?: string,
      extras?: { due?: Date; time?: string; category?: string; eff?: number; pri?: number },
    ) => {
      const trimmed = title.trim()
      if (!trimmed) return

      // Quick-add extras become a metadata block and a due date on creation,
      // so the task is complete on its first write rather than patched after.
      const { due } = encodeDue(extras?.due ?? null, extras?.time ?? null)
      const notes = encodeNotes('', {
        ...(extras?.category ? { cat: extras.category } : {}),
        ...(extras?.time ? { time: extras.time } : {}),
        ...(extras?.eff ? { eff: extras.eff } : {}),
        ...(extras?.pri ? { pri: extras.pri } : {}),
      })

      // A temporary id keeps React keys stable until the reload replaces it.
      const task: WireTask = {
        id: `pending-${crypto.randomUUID()}`,
        title: trimmed,
        listId,
        status: 'needsAction',
        position: positionAt(0),
        ...(parent ? { parent } : {}),
        ...(due ? { due } : {}),
        ...(notes ? { notes } : {}),
      }

      await run({ type: 'create', task }, async () => {
        await send({
          type: 'createTask',
          listId,
          task: { title: trimmed, ...(due ? { due } : {}), ...(notes ? { notes } : {}) },
          ...(parent ? { parent } : {}),
        })
        // The server assigns the real id and position, so reconcile quietly.
        await load({ silent: true })
      })
    },
    [run, load],
  )

  const patch = useCallback(
    async (id: string, apiPatch: Partial<GTask>, undoLabel?: string) => {
      const task = find(id)
      if (!task) return

      await run(
        { type: 'patch', id, patch: apiPatch },
        () => send({ type: 'patchTask', listId: task.listId, taskId: id, patch: apiPatch }),
        undoLabel,
      )
    },
    [run, find],
  )

  const setCompleted = useCallback(
    async (id: string, completed: boolean) => {
      await patch(
        id,
        completed
          ? { status: 'completed' }
          : // Clearing `completed` alongside the status is required; leaving it
            // set makes Google treat the task as done despite needsAction.
            { status: 'needsAction', completed: undefined as unknown as string },
        completed ? 'Task completed' : 'Task reopened',
      )
    },
    [patch],
  )

  const editTask = useCallback(
    async (id: string, fields: { title?: string; notes?: string }) => {
      const task = find(id)
      if (!task) return

      const apiPatch: Partial<GTask> = {}
      if (fields.title !== undefined) apiPatch.title = fields.title

      // `fields.notes` is the human-readable body only. Re-attach the existing
      // metadata block so editing a note never drops the task's metadata.
      if (fields.notes !== undefined) {
        apiPatch.notes = encodeNotes(fields.notes, decodeNotes(task.notes).meta)
      }

      await patch(id, apiPatch, 'Task edited')
    },
    [patch, find],
  )

  /** Due date and time always move together; see SPIKES.md. */
  const setDue = useCallback(
    async (id: string, date: Date | null, time?: string | null) => {
      const task = find(id)
      if (!task) return

      const { due, time: clock } = encodeDue(date, time)
      await patch(
        id,
        {
          due: (due ?? undefined) as string,
          notes: withMeta(task.notes, { time: clock }),
        },
        'Due date changed',
      )
    },
    [patch, find],
  )

  const setMeta = useCallback(
    async (id: string, metaPatch: MetaPatch) => {
      const task = find(id)
      if (!task) return
      await patch(id, { notes: withMeta(task.notes, metaPatch) })
    },
    [patch, find],
  )

  const removeTask = useCallback(
    async (id: string) => {
      const task = find(id)
      if (!task) return

      await run(
        { type: 'delete', id },
        () => send({ type: 'deleteTask', listId: task.listId, taskId: id }),
        'Task deleted',
      )
    },
    [run, find],
  )

  const move = useCallback(
    async (id: string, parent: string | null, previous: string | null) => {
      const task = find(id)
      if (!task) return

      await run(
        { type: 'move', id, parent, previous },
        () =>
          send({
            type: 'moveTask',
            listId: task.listId,
            taskId: id,
            ...(parent ? { parent } : {}),
            ...(previous ? { previous } : {}),
          }),
        'Task moved',
      )
    },
    [run, find],
  )

  const indent = useCallback(
    async (id: string) => {
      const target = indentTarget(current.current, id)
      if (target) await move(id, target, null)
    },
    [move],
  )

  const outdent = useCallback(
    async (id: string) => {
      const task = find(id)
      if (!task?.parent) return
      // One level of nesting means the new parent is always the top level, and
      // the task lands directly after its former parent.
      await move(id, null, task.parent)
    },
    [move, find],
  )

  const nudge = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const task = find(id)
      const neighbour = neighbourFor(current.current, id, direction)
      if (!task || !neighbour) return
      await move(id, task.parent ?? null, neighbour.previous)
    },
    [move, find],
  )

  /**
   * The API has no cross-list move, so this is create-then-delete. The task
   * comes back with a new id, which is why anything keyed by task id has to
   * tolerate ids disappearing.
   */
  const moveToList = useCallback(
    async (id: string, listId: string) => {
      const task = find(id)
      if (!task || task.listId === listId) return

      const before = current.current
      try {
        await send({
          type: 'createTask',
          listId,
          task: { title: task.title ?? '', notes: task.notes ?? '', due: task.due ?? '' },
        })
        await send({ type: 'deleteTask', listId: task.listId, taskId: id })
        await load({ silent: true })
      } catch (err) {
        setTasks(before)
        setError(message(err))
      }
    },
    [find, load],
  )

  const runUndo = useCallback(async () => {
    if (!undo) return
    const entry = undo
    setUndo(null)

    const { mutation, listId } = entry
    setTasks((prev) => applyMutation(prev, mutation))

    try {
      switch (mutation.type) {
        case 'create':
          await send({
            type: 'createTask',
            listId,
            task: {
              title: mutation.task.title ?? '',
              notes: mutation.task.notes ?? '',
              ...(mutation.task.due ? { due: mutation.task.due } : {}),
            },
          })
          break
        case 'delete':
          await send({ type: 'deleteTask', listId, taskId: mutation.id })
          break
        case 'patch':
          await send({ type: 'patchTask', listId, taskId: mutation.id, patch: mutation.patch })
          break
        case 'move':
          await send({
            type: 'moveTask',
            listId,
            taskId: mutation.id,
            ...(mutation.parent ? { parent: mutation.parent } : {}),
            ...(mutation.previous ? { previous: mutation.previous } : {}),
          })
          break
      }
      await load({ silent: true })
    } catch (err) {
      setError(message(err))
      await load({ silent: true })
    }
  }, [undo, load])

  const createList = useCallback(
    async (title: string) => {
      if (!title.trim()) return
      try {
        await send({ type: 'createTaskList', title: title.trim() })
        await load({ silent: true })
      } catch (err) {
        setError(message(err))
      }
    },
    [load],
  )

  const renameList = useCallback(
    async (listId: string, title: string) => {
      if (!title.trim()) return
      setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, title: title.trim() } : l)))
      try {
        await send({ type: 'renameTaskList', listId, title: title.trim() })
      } catch (err) {
        setError(message(err))
        await load({ silent: true })
      }
    },
    [load],
  )

  const clearCompleted = useCallback(
    async (listId: string) => {
      try {
        await send({ type: 'clearCompleted', listId })
        await load({ silent: true })
      } catch (err) {
        setError(message(err))
      }
    },
    [load],
  )

  return {
    status,
    error,
    lists,
    tasks,
    undo,
    load,
    signIn,
    dismissError: () => setError(''),
    dismissUndo: () => setUndo(null),
    runUndo,
    createTask,
    setCompleted,
    editTask,
    setDue,
    setMeta,
    removeTask,
    indent,
    outdent,
    nudge,
    moveToList,
    moveTo: move,
    createList,
    renameList,
    clearCompleted,
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function listIdOf(tasks: WireTask[], mutation: Mutation): string | null {
  if (mutation.type === 'create') return mutation.task.listId
  return tasks.find((t) => t.id === mutation.id)?.listId ?? null
}
