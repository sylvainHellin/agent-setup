# Authoring agent instructions

Instruction files (AGENTS.md and CLAUDE.md) and skills (SKILL.md and related files) are loaded into an agent's context and spend its attention budget on every turn, so they need to be carefully crafted.

## Core principles

- Be short: instructions act as a launchpad and point to relevant sources.
  A file should not contain more than ~15-20 instructions and ~100 lines.
- Disclose information progressively: the description announces *when* to activate or use the instruction, and the body gives the essential information and points to external sources for details that can be loaded on demand.
- Point to the information instead of copying it.
  If a fact lives in a template, a `--help`, a note, or the codebase, link to it.
  A copy goes stale and poisons context the moment the original changes.
  If a referenced file is not at the location given, flag it to the user immediately rather than guessing or working around it.
- Write for a cold read.
  Reread every edit as a stranger with no memory of the prior version; delete any sentence that only exists to react to how it was previously worded.

## Pick the surface

Read the one that matches:

1. A repo's `AGENTS.md` / `CLAUDE.md`, or global agent config: `instruction-files.md`
2. A skill (`SKILL.md` and its sibling files): `skills.md`
3. Importing a third-party skill (skills.sh, GitHub) so it works in a local tree: `references/importing-third-party-skills.md`

The first two siblings carry the launchpad shape for that surface plus three modes: bootstrap (create from scratch), refactor (slim a bloated one), and audit/add (place a new item, or review what exists).

## Before writing

1. Detect the mode.
   Does the target exist? Is it short and healthy, or long and bloated?
   Confirm the mode with the user in one line before proceeding.
2. Default to discuss first.
   Collect answers, draft, show the draft with a line count and what you intentionally dropped, then write.
3. Skills load from the folders listed in the `skills` array of `settings.json` (plus `~/.pi/agent/skills/` and `~/.agents/skills/`).
   Top-level skills route to parts in subfolders; pi stops discovery at the first `SKILL.md`, so a part's file is never listed on its own and carries no frontmatter.
   Where a new skill goes, when a part is promoted, and the context budget to measure before and after any change: `../strategy.md`.
   Edits are live after `/reload`.
