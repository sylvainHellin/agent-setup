# browser-execute

One in-process browser primitive for pi: `browser_execute(code)`. The agent
writes a JavaScript snippet that runs in the pi process with a long-lived Chrome
DevTools Protocol `session` object bound into scope, so one tool call can drive a
whole multi-step sequence (connect, navigate, click, type, read, screenshot) at
raw CDP level instead of one CLI round-trip per action.

It exists for the repair loop: fixing a browser automation script after a site's
DOM drifts, in one call rather than twenty snapshot-click round-trips that each
dump an accessibility tree into context. It does not replace a regular browsing
or scraping tool.

Ported from [browser-use/browsercode](https://github.com/browser-use/browsercode)
(MIT). The vendored CDP layer under `cdp/` is documented in
[`cdp/PROVENANCE.md`](cdp/PROVENANCE.md); the upstream licence is in
[`cdp/LICENSE`](cdp/LICENSE).

## Off by default

The tool is registered on every session but removed from the active set at
`session_start`, so a normal session never carries its schema and never pays the
prompt cost. Enable it when needed:

- `/browser`: show whether it is on for this session.
- `/browser on`: enable it for this session.
- `/browser off`: disable it again.
- `pi --browser -p '…'`: enable it headlessly, where a slash command cannot run. Keep `--browser` before `-p` (otherwise pi reads it as the prompt value); `pi -p '…' --browser` works too.

The tool carries only a `description`; usage guidance belongs in a `cdp`
skill, which the description tells the agent to read if installed, so
that activating the tool does not rebuild the system prompt or invalidate the
provider's cached prefix.

## How it works

- `index.ts`: extension entry. Registers the tool, the `/browser` command, the
  `--browser` flag, and the `session_start` deactivation. It never imports the
  CDP layer at module scope; `execute.ts` is dynamically imported on the first
  tool call and cached, so an inactive session pays nothing for the 655 KB of
  generated CDP bindings.
- `execute.ts`: the snippet runner. Wraps the snippet in
  `new AsyncFunction("session", "console", code)`, tees console output, taps
  `Page.captureScreenshot` results, and enforces the timeout (default 60 s, max
  10 min) and pi's abort signal.
- `session-store.ts`: per-pi-session map of CDP `Session` objects, so a
  `session.connect(...)` from one snippet persists across later snippets in the
  same session.
- `cdp/`: vendored CDP transport (`session.ts`), generated typed bindings
  (`generated.ts`), the codegen (`gen.ts`), and the two protocol JSON mirrors.

## Screenshots

Every `Page.captureScreenshot` a snippet makes is attached to the tool result as
an inline image (`{ type: "image", data, mimeType }`), the same content shape the
built-in `read` tool uses for images, so the agent sees the screenshot on the
next turn with no decode/write/read dance. The base64 is also in the snippet's
return value for programmatic use.

## Refreshing the CDP layer

The generated bindings are pinned to a protocol snapshot. To refresh after a
Chrome DevTools Protocol update, see the steps in
[`cdp/PROVENANCE.md`](cdp/PROVENANCE.md) (`bun gen.ts`, run with Bun).

## Dependencies

Zero runtime dependencies: the vendored CDP layer needs only Node builtins plus
the global `WebSocket` (stable on Node 22). Typechecking uses `../tsconfig.json`
(see `../README.md`).
