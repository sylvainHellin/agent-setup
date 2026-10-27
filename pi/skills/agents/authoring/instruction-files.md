# Instruction files (`AGENTS.md` / `CLAUDE.md`)

## Target shape

A root file that is a launchpad: what the project is, how to verify a change, and where everything else lives. The shape below is the code-repo case; a non-code config file (e.g. global agent config) drops `## Build and test` and instead carries the few writing / tooling / workflow rules that apply to every task.

~~~markdown
# <project name>

<one sentence: what it is, plus any structural fact true everywhere, e.g. "single crate, library + binary">.

## Build and test

```sh
<the 2-4 commands the agent will actually run>
```

<one optional line about the single footgun hit every task, only if there is one>.

## Further reading

See docs/ for <comma-separated topics>. <optional pointer to a top-level file like BACKLOG.md>.

<0-2 light meta-instructions about behaviour that apply to every task, e.g. "when you find a non-obvious fix, append it to docs/lessons-learned.md the same turn">.
~~~

Include the build/test commands if applicable and not already available in the `README`. Aim for ~5-10 instructions, ~15-25 lines maximum.

## Root vs docs

The `AGENTS.md` must remain lean. Any additional important information goes into the documentation.

| Root | docs/ |
|---|---|
| One-sentence description | Architecture, module map, design patterns |
| Build / test / install commands | Invariants ("no migrations", "WSL only") |
| Single line indexing docs/ | Language / framework conventions, testing patterns |
| The 1-2 footguns hit every task | Auth, secrets, deployment, env setup |
| Behaviour meta-instructions | Workflow (tickets, releases), domain vocabulary, API design |

## Mode: bootstrap (no file yet)

1. Scan to pre-fill defaults: `ls package.json pyproject.toml Cargo.toml go.mod uv.lock 2>/dev/null`, check for a monorepo and existing `docs/` / `README.md`.
2. Ask, in one numbered message, then wait for the combined reply: one-sentence description; package manager (with detected default); any non-obvious build/test/lint command; which domains have project-specific conventions; known gotchas; monorepo y/n; stable domain vocabulary.
3. Write the root file to the target shape. For each domain with real content, create or extend a `docs/<topic>.md`; the root gets only the single `## Further reading` line. Monorepos: add per-package `AGENTS.md` stubs (purpose + stack + package-specific references).
4. Show the final root file + line count, the `docs/*.md` created, and what you dropped and why.

## Mode: refactor (existing, bloated)

Interactive at every contradiction; never silently pick a side.

1. Read root and every nested `AGENTS.md` / `CLAUDE.md`.
2. List contradictions as a numbered set and ask which side wins for each.
3. Keep for root only: the one-sentence description, the 2-4 real commands, up to one footgun line, 0-2 behaviour meta-instructions, and the single `docs/` index line. Everything else moves out: invariants, file/module lists, workflow rules, language conventions. When in doubt, move it out; the root recovers cheaply with a pointer.
4. Group the rest into `docs/<topic>.md` files; reuse existing files, do not invent parallel ones.
5. Flag for deletion with a reason tag (redundant / vague / obvious / stale-path / auto-generated noise) and confirm in one numbered message.
6. Rewrite root to the minimal form and write the docs files.

## Mode: add (one new item)

Place it with this test, never silently grow the root:

| Goes to | When |
|---|---|
| Root | Relevant to literally every task in the repo |
| Existing `docs/<topic>.md` | Fits a domain file that exists |
| New `docs/<topic>.md` | New domain, broad enough to grow |
| `docs/GOTCHAS.md` | Footgun / workaround / edge case |
| Nothing | Model already knows it, or it is too vague |

If it lands in a docs/ file the root does not yet reference, add one light-touch line to root.

## Finishing checks

- Root has ~5-10 instructions, ~15-25 lines, under 40.
- No `## Critical rules` / `## Invariants` / `## Where things live` in root; no multi-row file index; no directory trees or `src/` path lists.
- No rules already covered by global `~/.pi/agent/AGENTS.md`; no generic best practice the model knows.
- Every docs/ file the root names exists; every docs/ file worth surfacing is named.
