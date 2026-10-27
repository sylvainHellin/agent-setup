# Chrome DevTools Protocol through `browser_execute`

The `browser_execute` tool evaluates JavaScript against a connected browser `session` via the Chrome DevTools Protocol.
The snippet runs in-process; `session` is bound to a long-lived CDP `Session` that persists across calls in the same pi session.
There is no helper namespace, just `session`, `console`, and standard JS globals.

Workspace: `<cwd>/.pi/browser-workspace/`. Read and write your reusable scripts here.

## Enabling the tool

`browser_execute` is registered but off by default, so a normal session does not carry it.

- `/browser on` enables it for the current session (`/browser off` disables it, `/browser` shows state).
- `pi --browser -p '…'` enables it headlessly, where a slash command cannot run (keep `--browser` before `-p`, or pi treats it as the prompt value; `pi -p '…' --browser` also works).

If `/browser on` reports the tool is not registered, the extension did not load; check `~/.pi/agent/extensions/browser-execute/`.

## Connecting

Call `session.connect(...)` once at the start of your work. There are two connection methods.

### Way 1: connect to a running Chrome or Chromium-based browser (real profile, popup-gated)

Choose when the task involves the user's logged-in sites, current browser state, cookies, saved data, etc.

```js
// Attempts to connect to every detected Chrome, most-recently-launched first.
await session.connect()
```

For this to work the user must have navigated to `chrome://inspect/#remote-debugging` in their target Chrome and ticked "Allow remote debugging for this browser instance". This setting is per-profile and persists across every future launch of that profile. On Chrome 144 and later, the first attach also triggers an in-browser "Allow remote debugging?" popup that the user must click "Allow" on. The popup may reappear on later attaches under conditions that are not fully characterized (browser restart, time elapsed, new CDP session). Ask the user to click Allow again if a previously working connection starts 403'ing.

Failure modes:
- `connect()` throws "No running browser with remote debugging detected". The checkbox at `chrome://inspect/#remote-debugging` has not been ticked in any running Chrome profile, or no Chrome is running.
- `connect()` throws with "403" / "permission" / "WS closed before open". The checkbox is ticked but the user has not clicked Allow on the popup yet. By default `connect()` errors in 5s; pass `{ timeoutMs: 30000 }` to wait up to 30s for the click.

### Way 2: connect to a Chrome or Chromium-based browser launched with a debug port (isolated profile, no popups)

Choose for unattended automation, or for an isolated browser.

Launch Chrome with `--remote-debugging-port=<port> --user-data-dir=<path>`. Pick a directory you can access, e.g. a project-local one like `./.pi/chrome-data-dir`.

```bash
# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=./.pi/chrome-data-dir
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=./.pi/chrome-data-dir
# Windows (cmd.exe)
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 --user-data-dir=.\.pi\chrome-data-dir
```

```js
// Resolve the live WebSocket URL via `/json/version` and connect:
const ver = await fetch("http://127.0.0.1:9222/json/version").then(r => r.json())
await session.connect({ wsUrl: ver.webSocketDebuggerUrl })
```

`--user-data-dir` must not be Chrome's platform default. Chrome 136 and later silently no-ops the `--remote-debugging-port` flag when `--user-data-dir` is the platform default. The platform defaults are `%LOCALAPPDATA%\Google\Chrome\User Data` on Windows, `~/Library/Application Support/Google/Chrome` on macOS, `~/.config/google-chrome` on Linux.
You cannot reuse the user's everyday Chrome profile by copying its files into a custom directory.

On a Linux box without a system Chrome, use Playwright's bundled Chromium (under `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`), with `--headless` when no window is needed.

Failure modes:
- Chromium exits at launch with `FATAL:...zygote_host_impl_linux.cc... No usable sandbox!`. AppArmor on Ubuntu 23.10+ blocks the unprivileged user namespaces the sandbox needs. Add `--no-sandbox`: acceptable for a throwaway automation profile, not for a profile that holds logins.
- Chrome's launch log prints `DevTools listening on ws://...:<port>/...` immediately followed by `bind() failed: Address already in use` and Chrome exits. Confirm the port is actually open with `curl http://127.0.0.1:<port>/json/version` before connecting.
- `{ profileDir }` raises ENOENT on `DevToolsActivePort`. Chrome 147+ does not write this file under a custom `--user-data-dir`; use the `/json/version` route above instead.
- Launch silently no-ops `--remote-debugging-port`. Launching a second Chrome that points at a `--user-data-dir` matching a running process ignores `--remote-debugging-port`.

## Attaching to a target

After connecting, attach to a page target before driving the browser:

```js
const targets = (await session.Target.getTargets({})).targetInfos
// Pick the first non-internal tab if none was specified.
const page = targets.find(t => t.type === "page" && !t.url.startsWith("chrome://"))
await session.use(page.targetId)
```

If a target-scoped command throws `CdpError` code `-32001` (`Session with given id not found`), the browser connection is still usable but the target session is stale. List targets again, `session.use(...)` the intended page, and retry the rejected command once. Calling `session.connect()` without arguments is a no-op while connected; it does not replace a stale target session.

Every explicit reconnect or browser switch retires the previous socket and clears its active target attachment. Re-list targets, call `session.use(...)`, and rediscover DOM nodes and Runtime objects before continuing.

Opening a tab creates a new `page` target but does not switch the active attachment. Call `Target.getTargets` again and `session.use(targetId)` when continuing there.

## Driving a page

Domain methods follow `session.<Domain>.<method>(params)` and return Promises.
The full surface (652 commands) is the Chrome DevTools Protocol.
`Object.keys(session.domains).sort()` lists every CDP domain bound on the session; `Object.keys(session.Page).sort()` lists the methods for `Page`.
For unknown param shapes, call with `{}` and inspect the thrown `CdpError`: `.data` carries the missing-field detail.

Common moves:

```js
// Navigate. Register the load waiter before navigate so a fast load is not missed.
await session.Page.enable()
const loaded = session.waitFor("Page.loadEventFired", { timeoutMs: 15_000 })
await session.Page.navigate({ url: "https://example.com" })
await loaded
// Page.navigate resolves even on network errors; its result carries `errorText` when the load failed.

// Evaluate JS in the page.
const r = await session.Runtime.evaluate({
  expression: "document.title",
  returnByValue: true,
})
console.log(r.result.value)

// Click by coordinates.
const x = 200, y = 300
await session.Input.dispatchMouseEvent({ type: "mouseMoved", x, y })
await session.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 })

// Type text.
await session.Input.insertText({ text: "hello" })

// Screenshot.
await session.Page.captureScreenshot({ format: "png" })
// You see the image inline on the next turn: browser_execute automatically
// attaches every Page.captureScreenshot result to the tool result. No need to
// decode, save, or `read` the bytes back. The base64 is still in `data` (via
// the return value) for the rare case you want to process it programmatically.
```

`Page.navigate` can return a non-empty `errorText` instead of throwing. Treat it as a failed navigation.

Screenshot attachment is keyed on the `Page.captureScreenshot` response; pixels that arrive as an event (e.g. `Page.screencastFrame`) are never attached, only carried in the return value.

## Reusing code across calls

The connection is what persists, not the code. Because `session` is the same
long-lived object on every call in a pi session, connect and attach once, then
keep driving in later calls without reconnecting. That covers the repair loop:
iterate on the sequence one snippet at a time against the same live page.

The workspace dir `<cwd>/.pi/browser-workspace/` is a place to keep notes and
draft scripts with the `write` tool. Do not try to `await import(...)` those
files from inside a snippet: under pi's extension loader a snippet's dynamic
`import()` throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` (the snippet body is
compiled without a dynamic-import callback). To reuse a script, paste its body
into the snippet you run, rather than importing it. A helper you keep in the
workspace is a copy-paste source, not an import target.

```js
// Reuse by inlining. `session` already carries the connection and the attached
// target from an earlier call, so this snippet just drives.
await session.Page.enable()
const urls = ["https://example.com", "https://example.org"]
const titles = []
for (const url of urls) {
  const loaded = session.waitFor("Page.loadEventFired", { timeoutMs: 15_000 })
  await session.Page.navigate({ url })
  await loaded
  const r = await session.Runtime.evaluate({ expression: "document.title", returnByValue: true })
  titles.push(r.result.value)
}
console.log(JSON.stringify(titles))
return titles
```

## Guardrails

- Top-level `import` statements inside the snippet body are not allowed, and `await import(...)` also fails under pi's loader (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). Use only globals already available (`fetch`, `Buffer`, `process`, timers) plus `session` and `console`; inline any helper you would otherwise import.
- No CPU-bound infinite loops without `await`: they ignore the timeout. Insert `await new Promise(r => setTimeout(r, 0))` to yield.
- `browser_execute` defaults to 60s (max 10 min); longer timeouts delay your next turn. After a timeout, only that call loses CDP access; the next call can continue on the same connection and target. The last command sent by the timed-out call may still finish. `Target.getTargets` succeeding means CDP is live; `session.connect()` is then a no-op, and reattaching the same target does not restart its renderer.
- Pressing Esc cancels the running snippet the same way a timeout does: that call loses CDP access, the persistent session survives.

## Console

- `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug` are all captured and streamed to the user. Treat them as your stdout. Other `console.*` methods write to pi's stderr without being captured into the tool result.
- The snippet's `return` value is captured separately (JSON-serialized when possible).
- A codemode script's `tools.browser_execute(...)` resolves to `{ output, result, screenshots, error? }` instead of the text: `result` is the parsed return value, `screenshots` are image blocks for `image()`, and a snippet that throws or times out still resolves, with `error: { kind, message }` and the partial `output`.
