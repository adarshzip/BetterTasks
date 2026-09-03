# BetterTasks

A replacement Google Tasks panel for Google Calendar, built for coursework.

The native sidebar renders subtasks flat, has no concept of a category, and
gives no visual signal about which class a task belongs to. This is a browser
extension that puts a replacement panel in the browser's side panel, beside
your calendar, backed entirely by the Google Tasks API so data stays in sync
with the official mobile app.

No backend, no database, no hosting. Google stores the data; this owns the
rendering.

## Status

Phase 2. The panel is now read-write and does not force you back to Google's
UI for ordinary work.

**Working:**

- Hanging-indent tree with connector lines and collapsible parents
- Course pill per row, coloured deterministically per class
- View toggle between due date and class, with a pinned "Overdue and today"
  bucket above both
- Parent progress rollup
- Add tasks and subtasks, complete and reopen, edit title and details
- Due date and time, effort, priority, start (defer) date, repeat interval
- Indent, outdent, move up and down
- Move a task to another list
- Collapsible Completed section, and clear completed
- Create and rename lists
- Undo on delete, complete, edit, and move
- Optimistic updates with rollback, so nothing waits on the network
- Theme follows the browser's light or dark mode

**Known gaps, and why:**

- **No starring.** Google's star is not in the public Tasks API. Implementing
  our own would create two things called "star" that disagree between apps.
  Priority covers the same need.
- **No "Deadline" or "Starred recently" sort.** Neither has any API
  representation.
- **No print.**
- **Due times are ours alone.** The API discards the time component, so a time
  set here lives in the metadata block and is invisible to Google's clients.
  Equally, a time you set on your phone is invisible here.
- **No list deletion.** It destroys every task in the list with no undo, and
  Google's UI is one click away.

Not yet built: keyboard navigation, natural language quick add, recurrence
regeneration on completion, drag and drop, and the whole calendar layer. See
the plan for the phase breakdown.

## Getting started

See [SETUP.md](SETUP.md). Two steps need your Google account and take about
fifteen minutes, once.

```bash
npm install
npm run build     # then load dist/ unpacked at chrome://extensions
npm test
```

## Design notes

**Metadata lives in `notes`.** The Tasks API exposes only `title`, `notes`,
`due`, `status`, `parent`, and `position` as writable. There is no spare field.
Anything the API cannot express is serialized as a single compact line at the
end of `notes`, after a `⟦bt⟧` sentinel. Keeping it last means the readable
part of the note is what previews in Google's own clients. The codec is total:
a corrupt block is dropped and the task survives.

**Nothing touches Google's DOM.** An earlier version injected a panel into
calendar.google.com and fought obfuscated class names, stacking contexts, and
a single-page app that re-rendered underneath it. The Side Panel API gives us
a browser-managed page we fully own, which removes that entire class of
failure. Phase 4's drag-a-task-onto-the-calendar feature will need a small,
focused content script; if that breaks, it breaks a nice-to-have rather than
the whole panel.

**Auth uses launchWebAuthFlow, not getAuthToken.** `getAuthToken` is Chrome
only and throws on Edge. The implicit flow avoids shipping a client secret
inside an extension, where it would not be secret. Tokens are cached in
`chrome.storage.session`, which is memory-only.

**The Tasks API discards due times.** Confirmed in `SPIKES.md`: send 17:30 and
it returns 00:00. Times therefore live in the metadata block, and any write of
`due` must set `meta.time` alongside it.

**The service worker owns auth and network.** `chrome.identity` is unavailable
in content scripts, so the panel talks to the worker over messages.
