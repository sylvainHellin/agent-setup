---
name: code
description: "Load before writing or changing code in any repo (Python with uv, JS with pnpm, virtual environments, dependencies), and before reviewing a diff, dispatching reviewer subagents or triaging their findings."
---
# Code

Defaults for working in any repo; a repo's own AGENTS.md or CLAUDE.md overrides them.

## Python and JavaScript

- Python goes through `uv`: `uv run` for scripts and tools, `uv add` for dependencies, `uv init` for a new project, `uv venv` when a bare environment is needed.
  Never call `python` or `pip` directly; a one-off script with a dependency runs as `uv run --with <pkg> script.py`.
- The project venv is `.venv/` at the repo root, created and kept in sync by `uv`; never activate it by hand, since `uv run` picks it up.
- JavaScript and TypeScript go through `pnpm` (`pnpm add`, `pnpm install`, `pnpm dlx`), never `npm` or `npx`.
- Batch installs and dependency changes and name the reason; a new library also needs a quick landscape check and the user's permission first.

## Review

Before reviewing a diff, dispatching reviewer subagents or triaging their findings, read `review/SKILL.md`: it carries the admission gates and the separate bar for calling a finding blocking.
