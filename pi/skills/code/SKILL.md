---
name: code
description: "Load before writing or changing code in any repo (Python with uv, JS with pnpm, virtual environments, dependencies, git worktrees and parallel branches with wt), and before reviewing a diff, dispatching reviewer subagents or triaging their findings."
---
# Code

Defaults for working in any repo; a repo's own AGENTS.md or CLAUDE.md overrides them.

## Python and JavaScript

- Python goes through `uv`: `uv run` for scripts and tools, `uv add` for dependencies, `uv init` for a new project, `uv venv` when a bare environment is needed.
  Never call `python` or `pip` directly; a one-off script with a dependency runs as `uv run --with <pkg> script.py`.
- The project venv is `.venv/` at the repo root, created and kept in sync by `uv`; never activate it by hand, since `uv run` picks it up.
- JavaScript and TypeScript go through `pnpm` (`pnpm add`, `pnpm install`, `pnpm dlx`), never `npm` or `npx`.
- Batch installs and dependency changes and name the reason; a new library also needs a quick landscape check and the user's permission first.

## Tests first

- Every code change that adds or alters behaviour starts with a test that fails for the right reason, then the code that makes it pass; a bug report, the user's or an agent's own, starts with a test that reproduces it.
- Run the new test before the fix and keep its failing output as evidence; a reproduction that cannot be written goes back as a finding instead of a guessed fix.
- The fix never edits, skips, deletes or loosens another test, and the new test stays in the suite as a regression test.
- A repo without a test suite gets a minimal one (pytest, `cargo test`, vitest) with the first change that needs it.
- Exempt: docs, configuration, figures, throwaway scripts under `/tmp` and pure refactors already covered by tests.

## Worktrees

- Parallel work in one repo (a long task beside quick fixes, or several writing agents) runs in git worktrees managed by Worktrunk (`wt`, docs at https://worktrunk.dev); its user config, with each repo's setup hook, is `~/.config/worktrunk/config.toml`.
- `wt switch --create <branch>` makes the sibling worktree `<repo>.<branch>` and runs the repo's setup hook (ignored files copied, dependencies synced); an agent adds `--no-cd` and then works with absolute paths or `wt -C <path>`.
- Commits stay on the branch until `git pull --rebase --autostash` in the main checkout and `wt -C <worktree> merge main`, which rebases, fast-forwards main, removes the worktree and deletes the branch; `git push` from the main checkout follows.
  With squash off in the config, pass `--squash` when a fix should land as one commit.
- `wt list` shows every worktree with its changes, commits ahead and running agents; `wt remove` drops an abandoned one, and `-D` (unmerged branch) or `-f` (uncommitted changes) deserves the same care as any destructive git command.
- A repo with heavy ignored state (build trees, `node_modules`, `.env`, dev databases) gets a `[projects."<host>/<owner>/<repo>"]` entry in that config before its first parallel task.

## Review

Before reviewing a diff, dispatching reviewer subagents or triaging their findings, read `review/SKILL.md`: it carries the admission gates and the separate bar for calling a finding blocking.
