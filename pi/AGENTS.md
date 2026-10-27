# General Instructions

## User

<!-- Fill this in: who you are, what you work on, where your knowledge lives. Keep it to three or four lines. -->
The user is `<your-name>`, `<your role>` at `<your organisation>`.
`<one line on the main project or research topic>`.
The single source of truth for notes and knowledge is `<your vault>` (`knowledge` skill).

## Writing

- No em-dashes and no `--` standing in for one, no emojis (Unicode symbols or Nerd Font icons instead), no `**Bold:**` label patterns, no "X, so Y, not Z" contrast scaffold, no signposting sentence announcing the reply's structure ("Assessment first, then the export path"): all read as AI tells.
- Answers are short, straightforward and easy to process; separate explanation and context from the questions and instructions the user has to answer or follow.
- A question or decision put to the user stands on its own: the problem, the options with their trade-off, and a recommendation, with every decision number, ticket or file label spelled out in words; a bare "decide X" or "see D62" costs a round trip.
- Update an existing document instead of creating a new one and marking the old one "superseded"; git keeps the history, so documents carry only the current state.
  Decision logs and ADRs are the exception: a superseded entry stays, and only its status line points at its replacement.
- Anything beyond a short chat answer (tables, figures, a concept, several questions) goes into an HTML report page (`documents` skill), never a long Markdown file; the user comments in the page and pastes the export back.
- One line per item and one sentence per line.
- When explaining a concept, a system architecture or a non-obvious tradeoff, add a figure drawn with tex-fig (`documents` skill, never mermaid, draw.io or ASCII art) and embed the PNG in the report page.

## Tooling

- Use `rg` and `fd` instead of `grep` and `find`; Python and JS defaults live in the `code` skill.
- Git: `git pull --rebase --autostash` before touching a repo with an upstream, commit each atomic verified change and push it immediately, never force-push, no co-author lines; a repo's own AGENTS.md or CLAUDE.md overrides this default.
- Long-running processes (dev servers, watchers, jobs) run in a terminal multiplexer tab (herdr, tmux, zellij) labelled by project, never detached from a plain bash call.
- Never install or adopt a new tool or library without due diligence first (a quick `web` check of the current landscape, since training knowledge goes stale) and the user's permission.

## Workflow

- Before starting a task, load every skill whose description could relate to it, even one that may turn out not to apply, and search the notes before drafting anything.
- Destructive commands (`rm`, overwrites, `git reset`/`clean`, `umount`, force pushes) run as their own isolated bash call.
  Do not chain them or bury them in a one-liner.
  Start with a `# <what it removes and why>` comment, so an approval prompt shows the user exactly that line plus the command.
- Throwaway files go under `/tmp` and stay there, with no cleanup deletes, since the system ages `/tmp` out.
  Builds, test runs, downloads and anything over ~100 MB go under `/var/tmp` instead.
  Anything that regenerates a delivered artifact (figure sources, build scripts, data-prep code) is not throwaway: it lives next to the document or repo that embeds the result.
- Every git repo has a gitignored `.agents/` folder for agent state (handoffs, plans, research).
  Save anything the user has to look at (image, PDF, render, screenshot) to a known folder in the repo or the working directory, and hand over that path.
- Use critical judgement: when an instruction doesn't make sense, push back instead of inventing a justification to execute it.
- Delegate to subagents (`agents` skill) any task that would consume too much of the context window: content gathering, research, large test runs, and similar.
- A durable decision settled with the user, in chat or in a report page's comment export, goes into the repo's `decision-log.md` in the same commit as the change (format: `agents` skill).
- Persist new knowledge proactively via the `knowledge` skill (check for existing notes first, then mention the write in one line).
- When a path, name, version, date or title no longer matches reality, fix it in the same pass without asking, replace the old value instead of keeping it as history, and report the fix in one line.
