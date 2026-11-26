# Skills

Generic versions of the skills used with pi.
Each top-level folder is one skill; its `SKILL.md` carries the frontmatter pi reads and routes to the parts in its subfolders.
Adapt the placeholders in angle brackets (`<your vault>`, `<workspace-slug>`) before use.

| Skill | Loads when | What it does |
|---|---|---|
| `agents` | Editing AGENTS.md, a skill, an extension, a prompt or a setting; delegating to subagents | Authoring rules for instruction files and skills, the context budget, and how to dispatch the `scout`, `researcher`, `worker` and `reviewer` subagents. |
| `code` | Writing or changing code, parallel branches in git worktrees, reviewing a diff, triaging reviewer findings | Python through `uv`, JavaScript through `pnpm`, tests before the fix, Worktrunk (`wt`) worktrees, and a review bar with admission gates, a bar guard against weakened checks and a separate blocking bar. |
| `writing` | Drafting or reviewing any text a person reads | A checklist of AI tells with mechanical `rg` checks, the shape of a closing chat reply, and German copy rules. |
| `documents` | Authoring Typst or LaTeX documents and slides, drawing figures, parsing PDFs and Office files | Template and slide conventions, tex-fig figures and TUM chart colours, the `doc` CLI, and a pointer to the `agent-pages` skill for HTML report pages. |
| `knowledge` | Any read or write in an Obsidian vault; papers, citations and Zotero | Vault search with `rg`, `fd` and `qmd`, capture discipline for notes, and the `zot` CLI for a Zotero library. |
| `web` | Any web fetch, search, sourced answer, crawl or YouTube video; operating a website | The `web` CLI with its provider chain, YouTube transcripts with `yt-dlp`, and browser automation through BrowserOS or Playwright over CDP. |
| `productivity` | Todos, tasks, Plane issues | The `plane` CLI for a self-hosted Plane instance, with conventions for states, dates and labels. |

Two more skills live in the [agent-pages](https://github.com/sylvainHellin/agent-pages) repo, next to the page template they use:

| Skill | Loads when | What it does |
|---|---|---|
| `agent-pages` | Any answer beyond a short chat reply: tables, figures, an audit, a plan, several questions | An HTML report page the reader comments on and answers in the browser, then pastes the export back into the chat. |
| `tutor` | Learning a concept, a method or an unfamiliar codebase | A lesson page with figures and recall questions, graded through the same comment round trip. |

The agent-pages README (section Agent skills) shows how to link them for pi, Claude Code and other harnesses.

The CLIs these skills call are listed in `TOOLS.md` at the root of this repo.

## How pi finds skills

pi lists every skill's name and description in the system prompt and reads the full `SKILL.md` only when a task matches.
It scans `~/.pi/agent/skills/`, `~/.agents/skills/`, the project's `.agents/skills/`, and every path in the `skills` array of `settings.json`.
Either that array points at this folder (`"skills": ["<path to this repo>/pi/skills"]`), or the chosen folders are copied into `~/.pi/agent/skills/`.
The agent-pages skills join through the same array: `"skills": ["~/code/agent-pages/skills"]`.

A folder that contains a `SKILL.md` is a skill, and pi does not look further down inside it.
That is why the parts below a skill (`agents/subagents/SKILL.md`, `knowledge/zotero/SKILL.md`) carry no frontmatter and never appear in the skill list: the parent's `SKILL.md` points the agent at them.
A Markdown file without a `description` in its frontmatter, like this README, is ignored.
Run `/reload` after editing a skill in an open session.
