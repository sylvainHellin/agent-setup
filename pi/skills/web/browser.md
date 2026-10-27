# Operating a website

Clicking, forms, sign-in, screenshots, page data and web app QA need a real browser driven by the agent.
Pick whichever of these you have; the rules at the bottom hold for all of them.

## BrowserOS

BrowserOS (https://github.com/browseros-ai/BrowserOS) is a Chromium fork built for agents, with an MCP server and a CLI.
Run one instance, sign in to the sites the agent needs once in its window, and let every agent session share it.
Its own guide (the CLI's `guide` command or the project docs) carries the API; read it at the start of a task.
Name each task so calls share one session and its tabs, chain snapshot, act, wait and read in one script (every round trip costs a tool call), and end the session when done.

## Playwright over CDP

Any Chromium launched with `--remote-debugging-port=<port> --user-data-dir=<dir>` can be driven from a script run as `uv run -q --with playwright script.py`: `browser = p.chromium.connect_over_cdp("http://127.0.0.1:<port>")`, then `ctx = browser.contexts[0]` and `page = ctx.new_page()`.
Close your own page and call `browser.close()` at the end, which only disconnects; leave other tabs alone when other agents share the browser.

## The `browser_execute` tool

If the `browser-execute` pi extension is installed, `cdp.md` beside this file documents the tool: connecting to a running Chrome or a debug-port instance, attaching to a target, driving a page through raw CDP.

## Rules for every browser

- Never type a password yourself; credentials stay with the user.
  To sign in, open the site's login page, leave it open, ask the user to finish in the browser window and say when done.
- A subagent that lands on a login page reports `login needed` instead of waiting.
- Code editors in a page auto-indent typed text: insert multi-line content through the editor's API or the clipboard, not by typing.
- When a click times out on an element that was just found, a re-rendering list (typeahead suggestions, menus) replaced it: dispatch the pointer and mouse events from inside the page instead.
- When a modal intercepts pointer events, call `element.click()` inside the page.
- Keep evaluated results small: filter, slice and join in the page before returning.
- Once a flow works, keep the script in git next to the note or runbook that uses it.
