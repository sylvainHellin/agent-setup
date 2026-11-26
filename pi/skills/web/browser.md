# Operating a website

Clicking, forms, sign-in, screenshots, page data and web app QA need a real browser driven by the agent.
Pick whichever of these you have; the rules at the bottom hold for all of them.

## BrowserOS

BrowserOS (https://github.com/browseros-ai/BrowserOS) is a Chromium fork built for agents, with an MCP server that runs JavaScript against a `browser` SDK.
Run one instance (on a desktop, or headed on a virtual display in a container with a noVNC view), sign in to the sites the agent needs once in its window, and let every agent session share it; sign-ins persist in its profile.
Its own guide (the server's usage guide tool or the project docs) carries the API; read it at the start of a task.

- Name each task so calls share one session, its tab group and its tab ownership, and end the session when done.
- Chain snapshot, act, wait and read in one script, since every round trip costs a tool call.
  The `run` tool stops the whole script when its `timeout` argument expires, so keep that short (30 s works) and open slow pages one per run.
- Read a tool's schema before its first call: `act` takes `kind`, not `action`.
- `page.snapshot()` returns `{refs, text, url}`; pick a ref from `snap.refs` by `name` and `role` (`snap.refs.find(r => r.name === "Images.txt").ref`) rather than parsing the text.
- `page.evaluate("... return x")` takes a function body that needs `return` and answers `{page, value}`.
- Keep an evaluate result small and snapshot a large page with `mode: "interactive"`: a result over the size cap is saved to a file inside the browser's own filesystem, which a containerised instance may not expose to the host.
- A cross-origin iframe is read through `browser.cdp` with the frame's session id (in the guide).
- `page.diff` is noisy on dropdowns; check the field value instead.
- When a response breaks off mid-read, the call may have run (a click that re-rendered a large page): list the tabs and snapshot before repeating it.
- Close the tabs a task opened when it ends: every session shares one browser, and leftover tabs in a memory-capped instance crash heavy pages.
- `request_human_help` with a reason shows the user a "Take over" prompt in the browser window; poll `await_human_help` and do nothing on the page until it reports that control came back.
- `page.download(ref)` saves to the browser's download folder; in a container, mount it to a host folder so the files reach the host, and stage uploads in the same folder, since the container sees no other host path.
  A secret staged there for an upload (a certificate, an ID scan) is deleted right after.
- Once a short flow that finishes within one run works, save it with `page.saveHelper` for the site; later sessions on that host are told it exists.
  Keep the canonical script in git as well, since the browser keeps helpers only in its own database.
- A dev server is reachable from a containerised browser only when it listens on all interfaces or a private network address; one bound to `127.0.0.1` stays invisible to the container.
- Neither the MCP endpoint nor the CDP port has authentication: bind them to localhost or a private network, and check that telemetry is off after an image upgrade.

## Playwright over CDP

Any Chromium launched with `--remote-debugging-port=<port> --user-data-dir=<dir>`, BrowserOS included, can be driven from a script run as `uv run -q --with playwright script.py`: `browser = p.chromium.connect_over_cdp("http://127.0.0.1:<port>")`, then `ctx = browser.contexts[0]` and `page = ctx.new_page()`.
From another machine dial the IP address, since Chromium rejects a hostname in the `Host` header.
Close your own page and call `browser.close()` at the end, which only disconnects; leave other tabs alone when other agents share the browser.

## Rules for every browser

- Never type a password yourself; credentials stay with the user.
  To sign in, open the site's login page, leave it open, ask the user to finish in the browser window and say when done.
- A subagent that lands on a login page reports `login needed` instead of waiting.
- Code editors in a page auto-indent typed text: insert multi-line content through the editor's API or the clipboard, not by typing.
- When a click times out on an element that was just found, a re-rendering list (typeahead suggestions, menus) replaced it: dispatch the pointer and mouse events from inside the page instead.
- When a modal intercepts pointer events, call `element.click()` inside the page.
- Keep evaluated results small: filter, slice and join in the page before returning.
- Once a flow works, keep the script in git next to the note or runbook that uses it.
