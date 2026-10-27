# Skills

Generic versions of the skills I use with pi.
Each top-level folder is one skill; its `SKILL.md` carries the frontmatter pi reads and routes to the parts in its subfolders.
Adapt the placeholders in angle brackets (`<your vault>`, `<workspace-slug>`) before use.

| Skill | Loads when | What it does |
|---|---|---|
| `agents` | Editing AGENTS.md, a skill, an extension, a prompt or a setting; delegating to subagents | Authoring rules for instruction files and skills, the context budget, and how to dispatch the `scout`, `researcher`, `worker` and `reviewer` subagents. |
| `code` | Writing or changing code, reviewing a diff, triaging reviewer findings | Python through `uv`, JavaScript through `pnpm`, and a review bar with admission gates and a separate blocking bar. |
| `writing` | Drafting or reviewing any text a person reads | A checklist of AI tells with mechanical `rg` checks, the shape of a closing chat reply, and German copy rules. |
| `documents` | Authoring Typst or LaTeX documents and slides, drawing figures, parsing PDFs and Office files, writing HTML report pages | Template and slide conventions, tex-fig figures and TUM chart colours, the `doc` CLI, and the HTML report round trip. |
| `knowledge` | Any read or write in an Obsidian vault; papers, citations and Zotero | Vault search with `rg`, `fd` and `qmd`, capture discipline for notes, and the `zot` CLI for a Zotero library. |
| `web` | Any web fetch, search, sourced answer, crawl or YouTube video; operating a website | The `web` CLI with its provider chain, YouTube transcripts with `yt-dlp`, and browser automation notes. |
| `productivity` | Todos, tasks, Plane issues | The `plane` CLI for a self-hosted Plane instance, with conventions for states, dates and labels. |

The CLIs these skills call are listed in `TOOLS.md` at the root of this repo.

## How pi finds skills

pi lists every skill's name and description in the system prompt and reads the full `SKILL.md` only when a task matches.
It scans `~/.pi/agent/skills/`, `~/.agents/skills/`, the project's `.agents/skills/`, and every path in the `skills` array of `settings.json`.
Point that array at this folder (`"skills": ["<path to this repo>/pi/skills"]`) or copy the folders you want into `~/.pi/agent/skills/`.

A folder that contains a `SKILL.md` is a skill, and pi does not look further down inside it.
That is why the parts below a skill (`agents/subagents/SKILL.md`, `knowledge/zotero/SKILL.md`) carry no frontmatter and never appear in the skill list: the parent's `SKILL.md` points the agent at them.
A Markdown file without a `description` in its frontmatter, like this README, is ignored.
Run `/reload` after editing a skill in an open session.
