---
name: agents
description: "Load before editing AGENTS.md, CLAUDE.md, a skill, a pi extension, prompt or setting, before delegating to subagents (Agent tool, orchestrator mode, workflows), and for any question about pi itself."
---
# Agents

How the agent itself is configured and extended, and how it delegates.

## Parts

- `authoring/SKILL.md`: before creating, editing, auditing or placing content in any AGENTS.md, CLAUDE.md or skill.
- `strategy.md`: before adding or changing an instruction, skill, tool or extension, and when auditing them: the context budget and how to measure it, where a new skill goes, when a part is promoted.
- `subagents/SKILL.md`: before any `Agent`, `get_subagent_result` or `steer_subagent` call, and for orchestrator mode and workflows.

## pi configuration

- pi reads its config from `~/.pi/agent/`: `AGENTS.md`, `SYSTEM.md`, `extensions/`, `prompts/`, `agents/` (subagent definitions), `settings.json` and `subagents.json`; skills load from the paths in the `skills` array of `settings.json`.
  If that folder is symlinked from a dotfiles repo, edit the files in the repo.
- The pi docs (README.md, `docs/`, `examples/`) ship with the package (with Homebrew: `$(brew --prefix pi-coding-agent)/libexec/lib/node_modules/@earendil-works/pi-coding-agent/`); read them before touching extensions, skills, themes or settings.
- Extension and skill edits take effect after `/reload`; a headless check is `pi -p --no-session "<prompt>"`.

## Decisions and state in repos

- A durable decision (architecture, method, scope, admin) goes at the bottom of `decision-log.md` at the repo root: `## YYYY-MM-DD - <the decision as a sentence>`, then `Why:`, `Rejected:`, `Source:` (chat or report comment export) and `Status: accepted`.
- Software products with many load-bearing architecture decisions keep one file per decision instead, `docs/decisions/ADR-NNNN-slug.md`.
- Entries are never deleted or rewritten; an overturned one only gets `Status: superseded by <date or ADR id>`.
- Scan the log (`rg '^## ' decision-log.md`) before changing direction, append in the same commit as the change it causes, and name the entry in the reply so the user can veto it.
- An answer that only orders a one-off action gets no entry.
- Handoffs and research notes in `.agents/` are inputs; a decision found there counts once it reaches the log.
- Repos owned by others (a student team, an upstream project) keep their own format.
