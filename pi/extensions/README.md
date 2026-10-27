# pi extensions

Extensions for [pi](https://github.com/earendil-works/pi-coding-agent), written in TypeScript and loaded by pi without a build step.
pi auto-discovers its user extensions folder, `~/.pi/agent/extensions/` (or `$PI_CODING_AGENT_DIR/extensions/`), and loads every top-level `.ts` file and every subfolder with an `index.ts`; `plan/` and `shared/` have none and hold helpers only.
To install everything, link this folder there with `ln -s <agent-setup>/pi/extensions ~/.pi/agent/extensions`, or copy it; for a single project, use `<project>/.pi/extensions/` instead.
Do not also list the folder under `extensions` in `settings.json`, or every extension loads twice.
To pick only some, copy them together with `shared/`, `plan/` and `smart-compact/`, since other extensions import from those by relative path.
Then add the npm packages from [`../settings.example.json`](../settings.example.json) to the `packages` list of `~/.pi/agent/settings.json` and restart pi or run `/reload`.

| Name | What it does | Depends on |
|---|---|---|
| `annotate.ts` | `/annotate` opens the latest answers (`/annotate N` one answer, `/annotate <path>` a file) for line and general comments, then sends them back as one message. | `plan/`, `shared/session-answers.ts`, `shared/tool-path.ts`, `smart-compact/src/prompts.ts`; nvim with the plugin in `plan/nvim/` under tmux or herdr, else a TUI overlay (`PI_ANNOTATE_OVERLAY=1` forces it) |
| `bash-timeout.ts` | Re-registers `bash` with a 300 s default timeout, so no command hangs a session; an explicit `timeout` still wins. | |
| `branch.ts` | `/branch [name]` forks the session into a new herdr tab for a side quest. | herdr |
| `browser-execute/` | `browser_execute` tool running a JavaScript snippet against a persistent Chrome DevTools Protocol session; off by default, `/browser on`, or `pi --browser`. | Chrome or Chromium with remote debugging; CDP layer vendored from browser-use/browsercode (MIT, `cdp/LICENSE`) |
| `diff.ts` | `/diff` (`--staged`, `<commit>`) reviews the git working tree in a file list and diff viewer with inline comments. | `shared/diff-utils.ts`, `shared/notify.ts`; git; optional `$EDITOR`, tuicr |
| `footer/` | One-row footer: model and thinking level, path and git state, session name, mode indicators, context and cost; other extensions add segments through a registry on `globalThis`. | |
| `guardrails.ts` | Hard-blocks bare `pip install` and unrecoverable git operations (`reset --hard`, `clean -f`, `checkout --`, `restore`), asks before package installs and destructive commands (`rm -rf`, `rsync --delete`, `git push --force`, disk tools, ...), and blocks them in unattended runs. | `shared/quiet-ui.ts` |
| `herdr-blocked-bridge.ts` | Marks the herdr pane as blocked while a guardrails prompt waits, so herdr notifies you. | `shared/herdr-bus.ts`; herdr with its pi integration installed |
| `hide-declarations.ts` | Leaves rarely used tools (`Agent`, `get_subagent_result`, `steer_subagent`, `smart_compact`, `prune`) out of every request while they stay callable; edit `HIDDEN` to taste. | a skill or message that names the hidden tools |
| `notify.ts` | Desktop notification and terminal bell when a turn ends. | `shared/notify.ts`; optional terminal-notifier on macOS |
| `orchestrator/` | `/orchestrator [off]` turns the session into a dispatcher that delegates reading, research and edits to subagents. | `@tintinweb/pi-subagents`; agent definitions in `../agents/`; `footer/` for the indicator |
| `plan-mode/` | `/plan-mode [off]` holds the session in read-only planning: explore, interview, write a plan file, stop. | `footer/` for the indicator; `annotate.ts` to review the plan |
| `prefer-read.ts` | Blocks `cat`, `sed -n`, `head` and `tail` file reads in bash and tells the agent to use `read`. | |
| `prune/` | `/prune` copies the branch into a new, reduced session without an LLM summary; the `prune` tool does the same in place; completed turns lose their thinking in batches. | `smart-compact/src/prompts.ts` |
| `python-repl/` | `python` tool backed by a persistent IPython kernel per session (polars, pandas, duckdb, matplotlib, ...), `/python-reset`. | uv |
| `redraw.ts` | `/redraw` forces a full TUI repaint after a resize leaves stray characters. | |
| `review.ts` | `/review` lists every file the agent edited in this session, from the session log, with diffs and inline comments you can send back. | `shared/diff-utils.ts`, `shared/tool-path.ts`; pbcopy, wl-copy, xclip or xsel for copying |
| `safe-write.ts` | `write` refuses to overwrite an existing file and points the agent to `edit`. | `shared/tool-path.ts` |
| `session-name-date.ts` | Prefixes every session name with today's date unless it already starts with one. | |
| `smart-compact/` | Escalating reminders past a token boundary; the agent compacts itself with the `smart_compact` tool and its own handoff, saved under `.agents/handoff/`; `/smart-compact`, `/smart-boundary`. | `prune/src/estimate.ts`; vendored fork of dasomji/pi-smart-compact (MIT, `smart-compact/LICENSE`) |
| `static-indicator.ts` | Replaces the animated spinner with a static glyph, which removes a repaint timer of 12.5 frames per second; `/spinner` toggles. | |
| `thoughtdag.ts` | `/thoughtdag` opens the session tree in the ThoughtDAG desktop app. | ThoughtDAG |
| `tool-call-repair.ts` | Repairs orphaned tool calls in the outgoing context before each request; `/repair` trims a broken tail from the branch. | |
| `workflows-on-demand.ts` | Keeps the `SubagentWorkflow` tool inactive until the agent reads the skill file named in `TRIGGER_SUFFIX`; `/workflows` toggles it. | `@tintinweb/pi-subagents` with `workflowsEnabled` |

`plan/` holds the review surfaces used by `annotate.ts` and the nvim annotations plugin (`plan/nvim/README.md`).
`shared/` holds code used by several extensions: diff rendering, notifications, path resolution, the quiet spinner for prompts, and the herdr event bus.

## Highlights

- `prune/` and `smart-compact/` manage a long session's context without a lossy LLM summary: prune keeps every message and cuts tool output to pointers, and smart-compact lets the agent pick the moment to compact and write its own handoff.
- `annotate.ts` with `plan-mode/` gives a review loop: plan in read-only mode, comment on the plan or any answer line by line in nvim, and the comments come back as one message.
- `review.ts` and `diff.ts` review the agent's edits inside pi with inline comments, from the session log or from git.
- `orchestrator/` keeps the main context small on long tasks by delegating to subagents.
- `python-repl/` keeps data loaded between calls, so an analysis does not re-parse its input in every bash heredoc.
- `guardrails.ts`, `safe-write.ts` and `prefer-read.ts` catch the destructive, overwriting and wasteful tool calls agents make most often.

## Settings

[`../settings.example.json`](../settings.example.json) is a starting point for `~/.pi/agent/settings.json`: the two npm packages (`pi-vim` for a vim editor mode, optional; `@tintinweb/pi-subagents` for the `Agent` tool), pi's native auto-compaction left on as the failsafe behind `smart-compact/`, `codemode` enabled, and a few interface defaults.
Merge it into your own file rather than replacing it; provider and model settings stay yours.

## Typecheck and tests

pi loads the extensions without `node_modules`; typechecking needs a link to the folder that contains pi's own install.

```sh
cd pi/extensions
ln -s "$(brew --prefix pi-coding-agent)/libexec/lib/node_modules" node_modules   # Homebrew
# ln -s "$(npm root -g)" node_modules                                          # npm -g
tsc -p .
(cd prune && node --import ./tests/ts-resolve.mjs --test tests/*.test.ts)
(cd smart-compact && pnpm install && pnpm test)
```

## Not included

- A custom model provider, tied to a personal subscription setup.
- A plan-usage footer segment, which reads its data through that provider.
- A personal startup header.
- A mail-draft review command, tied to a personal mail setup.
- A file-sync hook for a personal folder convention.
- The herdr and tuios state reporters, which each tool installs and updates through its own pi integration.
- A hook that keeps the herdr pane busy while background subagents run, which needs a local patch to herdr's managed integration file.
