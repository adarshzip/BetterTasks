# Setup

Fifteen minutes, once. Two steps need your Google account and cannot be
scripted.

The order matters: the key in step 1 determines the extension ID, the extension
ID is what you register in step 2, and a mismatch between them is the single
most common way this fails.

---

## Step 1: Generate a stable extension key

**Why this exists.** An unpacked extension normally gets a new random ID every
time Chrome loads it. `chrome.identity.getAuthToken` requires an OAuth client
bound to one fixed ID, so a rotating ID means sign-in breaks on every reload.
Pinning a `key` in the manifest fixes the ID permanently.

Run these from the project root:

```bash
openssl genrsa -out bettertasks.pem 2048
```

This writes your private key. It is gitignored, and it is your identity for
this extension. If you lose it you get a new extension ID and have to redo
step 2. On OpenSSL 3.x the file starts with `-----BEGIN PRIVATE KEY-----`
rather than `-----BEGIN RSA PRIVATE KEY-----`. That is the expected PKCS#8
format and works fine.

Now derive the two values you need from it.

**The manifest key** (a long base64 blob, one line, no headers):

```bash
openssl rsa -in bettertasks.pem -pubout -outform DER | openssl base64 -A
```

**The extension ID** (32 characters, letters a through p only):

```bash
openssl rsa -in bettertasks.pem -pubout -outform DER | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p'
```

That second command is not arbitrary. Chrome derives an extension ID by taking
the SHA-256 of the DER public key, keeping the first 16 bytes, and remapping
hex digits `0-9a-f` onto letters `a-p`. Running it locally tells you the ID
Chrome will assign before you ever load the extension, which is what lets you
register it in step 2 first.

Copy both values somewhere for the next two steps.

---

## Step 2: Create the Google Cloud project

Google renamed this area to "Google Auth Platform" in 2025, so menu labels vary
depending on when your console last updated. Both namings are given below.

### 2a. Create the project

Go to <https://console.cloud.google.com/projectcreate>. Any name works.
Make sure it is selected in the project picker at the top before continuing,
since it is easy to configure the wrong project.

### 2b. Enable the two APIs

Under **APIs and Services, Library**, search for and enable:

- **Google Tasks API**
- **Google Calendar API**

Both are needed. Tasks is the data store; Calendar is for Phase 4's
auto-derived categories and time-blocking. Enabling Calendar now saves a
return trip.

### 2c. Configure the consent screen

Under **APIs and Services, OAuth consent screen** (newer consoles: **Google
Auth Platform, Branding** and **Audience**):

- **User type: External.** Internal is only available with Google Workspace,
  and even then External is correct here.
- Fill in app name, your support email, and developer contact email. Nothing
  else on the branding page matters for personal use.

Then on **Data Access** (older consoles: the "Scopes" step), click **Add or
remove scopes** and add these two by pasting them into the manual entry box:

```
https://www.googleapis.com/auth/tasks
https://www.googleapis.com/auth/calendar.events
```

Both are classified "sensitive," not "restricted." That distinction matters:
restricted scopes (Gmail, Drive) require a third-party security assessment
that costs thousands of dollars. Sensitive scopes do not.

### 2d. Add yourself as a test user

On the **Audience** page (older consoles: the OAuth consent screen summary),
leave publishing status as **Testing** and add your own Google account under
**Test users**.

Use the account whose tasks and calendar you actually want to see. If you add
the wrong one, sign-in fails with an "app has not completed verification"
error that does not obviously point at the test user list.

**What Testing costs you.** Google expires the grant after seven days, so
roughly once a week the panel shows "Sign in" again and you click it. That is
the entire consequence. Nothing breaks and no data is lost.

**The one-time warning.** The first sign-in shows a screen reading "Google
hasn't verified this app." Click **Advanced**, then **Go to BetterTasks
(unsafe)**. It says unsafe because Google has not reviewed the app, which is
true and irrelevant for an extension that is yours and runs on your machine.

**If the weekly click starts to grate**, you can publish later. Publishing
removes the expiry, and switching does not invalidate anything or require
rebuilding. The requirements are on the Branding page: app name, support email,
and developer contact filled in, no app logo uploaded, and the home page,
privacy policy, and terms of service URL fields left **empty**. Filling any of
those three URLs obliges you to verify domain ownership in Google Search
Console, which is the usual reason publishing gets blocked. Uploading a logo
triggers a brand review for the same effect.

Verification review is a separate thing again, and is only needed to
distribute to strangers. That is explicitly out of scope here.

### 2e. Create the OAuth client

**Application type: Web application.** Not "Chrome Extension."

That type exists to serve `chrome.identity.getAuthToken`, which is a
Chrome-only API with no Edge equivalent. This extension authenticates with
`launchWebAuthFlow` instead, which is a standard OAuth redirect and works in
every Chromium browser. A redirect flow needs a redirect URI, and the Chrome
Extension client type has nowhere to put one.

Under **Authorized redirect URIs**, add the extension's redirect URL. It looks
like this:

```
https://jelhgglgpkkjkhhfjfnieoncojgnckfk.chromiumapp.org/
```

**Read the real value rather than assembling it by hand.** Load the extension
first (step 4), open its service worker console, and run:

```js
chrome.identity.getRedirectURL()
```

Paste exactly what that prints, trailing slash included. Google matches
redirect URIs literally, so a missing slash fails with `redirect_uri_mismatch`.

Ignore the client secret Google generates. It is never used: the extension
runs the implicit flow, because a secret shipped inside an extension can be
read by anyone who unzips it and is therefore not a secret. Nothing needs to
be kept private here beyond the client ID, which is not sensitive.

Copy the client ID. It looks like
`123456789012-abc...xyz.apps.googleusercontent.com`.

---

## Step 3: Wire it up

```bash
cp extension.local.example.json extension.local.json
```

Open it and paste in both values:

```json
{
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
  "oauthClientId": "123456789012-abc...xyz.apps.googleusercontent.com"
}
```

The `key` is the base64 blob from step 1, not the contents of the `.pem` file,
and not the extension ID. It is a single line with no `BEGIN` or `END` headers.

This file is gitignored because both values are specific to your installation.

---

## Step 4: Build and load

```bash
npm run build
```

The build warns if `extension.local.json` is missing, and succeeds anyway with
a broken sign-in, so read the output rather than assuming success.

Then:

1. Open `chrome://extensions`
2. Turn on **Developer mode**, top right
3. Click **Load unpacked** and select the **`dist/`** directory, not the
   project root
4. **Confirm the ID shown on the extension card matches the one from step 1.**
   If it does not, the key did not make it into the manifest and sign-in will
   fail with "bad client id."

Then click the **BetterTasks toolbar icon** to open the side panel. Pin the
icon first if Edge hid it behind the puzzle-piece menu. Click **Sign in**,
clear the unverified-app warning once, and your tasks load.

The panel is a browser side panel, so it stays open beside whatever tab you
are on and is resizable by dragging its inner edge.

For iterative work:

```bash
npm run dev
```

This rebuilds and hot-reloads on save. You still load `dist/` unpacked the
first time.

---

## Verifying it worked

Four things, in order:

1. The extension card at `chrome://extensions` shows the ID from step 1.
2. The side panel opens when you click the toolbar icon. If clicking does
   nothing, check the service worker console for a side panel setup error.
3. Sign-in completes and tasks appear.
4. A parent task with subtasks renders **indented**, which is the entire point.
   If you have no nested tasks yet, make one in the native Google Tasks
   sidebar, then hit refresh in the panel.

---

## Troubleshooting

**"redirect_uri_mismatch"**
The URI registered on the OAuth client does not exactly match what the browser
sent. Run `chrome.identity.getRedirectURL()` in the service worker console and
compare character for character, including the trailing slash.

**"This API is not supported on Microsoft Edge"**
Something is still calling `chrome.identity.getAuthToken`. That API is Chrome
only. The extension uses `launchWebAuthFlow`; if you see this, the build is
stale. Rerun `npm run build` and reload the extension.

**"bad client id" or "invalid client"**
The extension ID Chrome loaded does not match the one registered on the OAuth
client. Check `chrome://extensions` against Cloud Console, then confirm the key
survived the build:

```bash
grep -o '"key"' dist/manifest.json
```

No output means `extension.local.json` was missing or malformed at build time.

**"Access blocked: This app's request is invalid"**
Usually a scope registered on the consent screen not matching the scopes in the
manifest. They must agree exactly. Check `oauth2.scopes` in
`dist/manifest.json` against the Data Access page.

**Sign-in works, then stops after about a week**
Expected on Testing status. Click sign in again. To remove the weekly prompt
for good, see the publishing notes in step 2d.

**"App has not completed the Google verification process" and no way past it**
The account you are signing in with is not on the Test users list. Add it on
the Audience page. Note this is a different failure from the "Google hasn't
verified this app" warning screen, which you clear via Advanced.

**The panel appears floating on the right instead of in the rail**
Expected fallback behavior, not a crash. Google changed the right-rail markup
and none of the candidate selectors matched. See `src/content/anchor.ts` and
Spike 2 in `SPIKES.md`.

**The panel vanishes when switching calendar views**
The remount observer in `src/content/anchor.ts` failed. Worth reporting with
the view you switched to, since it means the anchor needs work.

**403 with "Tasks API has not been used in project..."**
Step 2b was skipped or applied to a different project. The error text names the
project it expected; confirm it matches the one holding your OAuth client.
