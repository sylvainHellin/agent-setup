# pi extensions

Extensions for [pi](https://github.com/earendil-works/pi-coding-agent), written in TypeScript and loaded by pi without a build step.
pi auto-discovers its user extensions folder, `~/.pi/agent/extensions/` (or `$PI_CODING_AGENT_DIR/extensions/`), and loads every top-level `.ts` file and every subfolder with an `index.ts`; `plan/` and `shared/` have none and hold helpers only.
To install everything, link this folder there with `ln -s <agent-setup>/pi/extensions ~/.pi/agent/extensions`, or copy it; for a single project, use `<project>/.pi/extensions/` instead.
Do not also list the folder under `extensions` in `settings.json`, or every extension loads twice.
To pick only some, copy them together with `shared/`, `plan/` and `smart-compact/`, since other extensions import from those by relative path.
The folder holds 26 extensions.
Then add the npm packages from [`../settings.example.json`](../settings.example.json) to the `packages` list of `~/.pi/agent/settings.json` and restart pi or run `/reload`.

| Name | What it does | Depends on |
|---|---|---|
| `agent-pages-inbox/` | Holds one SSE stream per session to the agent-pages server and queues a page's comment export as a follow-up when the page's Send to agent targets this session; off in subagent sessions; `npm test`. | the [agent-pages](https://github.com/sylvainHellin/agent-pages) server (`base_url` in its `config.toml`, else `AGENT_PAGES_URL`), silent without either |
| `annotate.ts` | `/annotate` opens the latest answers (`/annotate N` one answer, `/annotate <path>` a file) in a TUI overlay for line and general comments, which stay editable and deletable and are typed in a vim input, then sends them back as one message. | `plan/`, `shared/session-answers.ts`, `shared/tool-path.ts`, `smart-compact/src/prompts.ts`; optional `pi-vim` for the vim input |
| `bash-timeout.ts` | Re-registers `bash` with a 300 s default timeout, so no command hangs a session; an explicit `timeout` still wins. | |
| `branch.ts` | `/branch [name]` forks the session into a new tab of the Herdr desktop app for a side quest. | `shared/hc-pane.ts`; the Herdr app (`herdr-app` and `hc` CLIs) |
| `diff.ts` | `/diff` (`--staged`, `<commit>`) reviews the git working tree in a file list and diff viewer with inline comments. | `shared/diff-utils.ts`, `shared/notify.ts`; git; optional `$EDITOR`, tuicr |
| `footer/` | One-row footer in the terminal's ANSI palette, so it follows the terminal or Herdr theme: model and thinking level, path and git state, session name, mode indicators, context and cost; other extensions add segments through a registry on `globalThis`. | |
| `guardrails.ts` | Hard-blocks bare `pip install` and unrecoverable git operations (`reset --hard`, `clean -f`, `checkout --`, `restore`), asks before package installs and destructive commands (`rm -rf`, `rsync --delete`, `git push --force`, `wt remove --force`, disk tools, ...), and blocks them in unattended runs. | `shared/quiet-ui.ts` |
| `hide-declarations.ts` | Leaves rarely used tools (`Agent`, `get_subagent_result`, `steer_subagent`, `smart_compact`, `prune`) out of every request while they stay callable; edit `HIDDEN` to taste. | a skill or message that names the hidden tools |
| `narrow/` | Below 60 terminal columns, such as a phone, the transcript turns compact: thinking hidden, Markdown tables as nested lists, tool calls cut to two lines, tool results hidden unless they failed or are expanded; decided per render, so it follows the pane width live; `npm test`. | |
| `notify.ts` | Desktop notification and terminal bell when a turn ends. | `shared/notify.ts`; optional terminal-notifier on macOS |
| `orchestrator/` | `/orchestrator [off]` turns the session into a dispatcher that delegates reading, research and edits to subagents. | `@tintinweb/pi-subagents`; agent definitions in `../agents/`; `footer/` for the indicator |
| `plan-mode/` | `/plan-mode [off]` holds the session in read-only planning: explore, ask only what the evidence leaves open, write a plan page or file, stop. | `footer/` for the indicator; optional `agent-pages` skill for the plan page; `annotate.ts` to review a markdown plan |
| `prefer-read.ts` | Blocks `cat`, `sed -n`, `head` and `tail` file reads in bash and tells the agent to use `read`. | |
| `prune/` | `/prune` copies the branch into a new, reduced session without an LLM summary; the `prune` tool does the same in place; above 120k tokens the extension prunes on its own at a seam such as a turn end or a commit (`PI_AUTO_PRUNE=0` turns it off); thinking is stripped on a cold cache or with a prune. | `smart-compact/src/prompts.ts`; `@tintinweb/pi-subagents` (result names) |
| `python-repl/` | `python` tool backed by a persistent IPython kernel per session (polars, pandas, duckdb, matplotlib, ...), with `PI_SESSION_ID` and `PI_SESSION_FILE` set as for `bash`; `/python-reset`. | uv |
| `redraw.ts` | `/redraw` forces a full TUI repaint after a resize leaves stray characters. | |
| `review.ts` | `/review` lists every file the agent edited in this session, from the session log, with diffs and inline comments to send back. | `shared/diff-utils.ts`, `shared/tool-path.ts`; pbcopy, wl-copy, xclip or xsel for copying |
| `safe-write.ts` | `write` refuses to overwrite an existing file and points the agent to `edit`. | `shared/tool-path.ts` |
| `session-name-date.ts` | Prefixes every session name with today's date unless it already starts with one. | |
| `smart-compact/` | Escalating reminders past a token boundary; the agent compacts itself with the `smart_compact` tool and its own handoff, saved under `.agents/handoff/`; the reminders stay quiet while the automatic prune of `prune/` runs, until it stops paying; `/smart-compact`, `/smart-boundary`. | `prune/src/estimate.ts`, `prune/src/auto-config.ts`; vendored fork of dasomji/pi-smart-compact (MIT, `smart-compact/LICENSE`) |
| `static-indicator.ts` | Replaces the animated spinner with a static glyph, which removes a repaint timer of 12.5 frames per second; `/spinner` toggles. | |
| `subagents-busy.ts` | Keeps the Herdr app status at working while background subagents run, by holding back pi's own resting status reports (OSC 7501). | `@tintinweb/pi-subagents` (lifecycle events); the Herdr app |
| `thoughtdag.ts` | `/thoughtdag` opens the session tree in the ThoughtDAG desktop app. | ThoughtDAG |
| `tool-call-repair.ts` | Repairs orphaned tool calls in the outgoing context before each request; `/repair` trims a broken tail from the branch. | |
| `workflows-on-demand.ts` | Keeps the `SubagentWorkflow` tool inactive until the agent reads the skill file named in `TRIGGER_SUFFIX`; `/workflows` toggles it. | `@tintinweb/pi-subagents` with `workflowsEnabled` |
| `worktrunk.ts` | Marks the branch as working or waiting in `wt list` on agent start, settle and shutdown, except in a repo without a remote; a fork of the file `wt config plugins pi install` writes, so after a `wt` upgrade its output is diffed by hand instead of installed. | `wt` and `git` CLIs, silent without them |

`plan/` holds the review overlay used by `annotate.ts`.
`shared/` holds code used by several extensions: diff rendering, notifications, path resolution, the quiet spinner for prompts, and the Herdr app placement used by `branch.ts`.

## Highlights

- `prune/` and `smart-compact/` manage a long session's context without a lossy LLM summary: prune keeps every message and cuts tool output to pointers, on its own at a seam once the context grows, and smart-compact lets the agent pick the moment to compact and write its own handoff.
- `annotate.ts` with `plan-mode/` gives a review loop: plan in read-only mode, comment on the plan or any answer line by line in an overlay, and the comments come back as one message.
- `review.ts` and `diff.ts` review the agent's edits inside pi with inline comments, from the session log or from git.
- `orchestrator/` keeps the main context small on long tasks by delegating to subagents.
- `python-repl/` keeps data loaded between calls, so an analysis does not re-parse its input in every bash heredoc.
- `guardrails.ts`, `safe-write.ts` and `prefer-read.ts` catch the destructive, overwriting and wasteful tool calls agents make most often.

## Settings

[`../settings.example.json`](../settings.example.json) is a starting point for `~/.pi/agent/settings.json`: the two npm packages (`pi-vim` for a vim editor mode, optional; `@tintinweb/pi-subagents` for the `Agent` tool), pi's native auto-compaction left on as the failsafe behind `smart-compact/`, `codemode` enabled, and a few interface defaults.
It merges into an existing settings file rather than replacing it; provider and model settings stay untouched.

## Typecheck and tests

pi loads the extensions without `node_modules`; typechecking needs a link to the folder that contains pi's own install.

```sh
cd pi/extensions
ln -s "$(brew --prefix pi-coding-agent)/libexec/lib/node_modules" node_modules   # Homebrew
# ln -s "$(npm root -g)" node_modules                                          # npm -g
tsc -p .
(cd prune && node --import ./tests/ts-resolve.mjs --test tests/*.test.ts)
(cd narrow && npm test)
(cd agent-pages-inbox && npm test)
(cd smart-compact && pnpm install && pnpm test)
```

## Not included

- A custom model provider, tied to a personal subscription setup.
- A plan-usage footer segment, which reads its data through that provider.
- A personal startup header.
- A mail-draft review command, tied to a personal mail setup.
- A file-sync hook for a personal folder convention.
- A command that moves a session between two personal machines.
- A hook that drops a symlinked second copy of the global `AGENTS.md` from the prompt, a workaround for one personal folder layout.
