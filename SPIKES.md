# Phase 0 spikes

Two unknowns whose answers change downstream work. Record the results here
before building further.

## Spike 1: does the Tasks API preserve a due time?

The API has historically accepted an RFC3339 `due` value and silently
truncated it to midnight UTC, discarding the time, even though the web UI now
lets you set one. This decides whether "due Friday 11:59pm" is representable
at all, or whether time-of-day has to live in the metadata block.

The code already hedges: `TaskMeta.time` exists, and `toTask` in
`src/model/tree.ts` applies it to a date-only `due` when present. If the API
turns out to preserve times, that field becomes dead weight and should be
removed.

To run it, open the service worker console: `edge://extensions`, find
BetterTasks, click **service worker** under Inspect views.

The worker exposes a `bt` debug handle, because dynamic `import()` is banned
inside service workers by spec and `chrome.identity.getAuthToken` does not
exist in Edge. Neither is available to you there, so `bt` is the way in.

```js
// Prompt first. Nothing else here is interactive, so without this a cold
// worker fails with AuthError: interaction_required.
await bt.getToken(true)

const { lists } = await bt.listEverything()
const listId = lists[0].id

const created = await bt.createTask(listId, {
  title: 'spike due time',
  due: '2026-09-04T17:30:00.000Z',
})

console.log('sent    ', '2026-09-04T17:30:00.000Z')
console.log('got back', created.due)
```

Clean up afterwards:

```js
await bt.deleteTask(listId, created.id)
```

**Result (2 Sep 2026): times are truncated.** Sent
`2026-09-04T17:30:00.000Z`, got back `2026-09-04T00:00:00.000Z`.

Consequences, all now settled:

- `TaskMeta.time` stays and is load-bearing, not a hedge.
- The `parseDue` fallback in `src/model/tree.ts` is the only reason a task can
  display a due time at all.
- The Phase 2 task editor must write `due` and `meta.time` together, always.
  Writing one without the other silently loses the time.
- Times set in Google's own UI are invisible to us, since the API never
  reports them. A task the user set to 11:59pm on their phone reads as
  midnight here. Nothing can be done about that from the API side; it is worth
  a note in the UI rather than a fix.

Delete the spike task afterwards.

## Spike 2: is the right-rail anchor stable?

`src/content/anchor.ts` tries three selectors in order and falls back to a
floating panel. Confirm which one actually matches, and that the mount survives
navigation.

**Result (2 Sep 2026):** Google Tasks renders directly in the page DOM, not in
an iframe, so an overlay can replace it. The panel initially mounted in the rail, but Calendar's
collapsed icon strip matches `div[role="complementary"]` at roughly 56px wide,
which is unreadable. `anchor.ts` now requires a matched rail to be at least
280px and picks the widest match, falling back to a floating resizable panel
otherwise.

Still to confirm, with the extension loaded on calendar.google.com, in the
**page** console (not the worker):

```js
['div[role="complementary"]', '[aria-label="Side panel"]', '#drawer']
  .flatMap(s => [...document.querySelectorAll(s)].map(el => [s, el.offsetWidth]))
  .forEach(([s, w]) => console.log(w, s))
```

Run this twice, once with the native Tasks sidebar open and once closed. If a
selector reports a usable width only when the sidebar is open, the panel will
move between rail and floating depending on that, which is worth knowing.

Then check the mount survives:

- switching between day, week, and month views
- navigating forward and back a week
- opening and closing the native Tasks sidebar
- collapsing the side panel entirely

Record the winning selector here and prune the candidates that never match, so
the failure mode stays legible.
