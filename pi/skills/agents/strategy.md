# Context strategy

How the always-loaded context (AGENTS.md, SYSTEM.md, tool declarations, the skill list) and the skills behind it are kept small and current.
Read before adding or changing an instruction, skill, tool or extension, and when auditing them.

## Context budget

Set a ceiling for the prompt the model receives before the first user message; 7,000 tokens is a workable one.
Measure it before and after any change to AGENTS.md, SYSTEM.md, a skill description, a tool or an extension, and report both numbers:

```sh
cd ~ && pi --mode json -p --no-session "Reply with exactly: OK" 2>/dev/null | rg '"usage"' | tail -1 \
  | jq '[.. | objects | select(has("cacheRead") and has("totalTokens"))][0] | .input + .cacheRead + .cacheWrite'
```

Above the ceiling, flag it to the user with what grew, and propose a cut before adding anything.
Levers, cheapest first: shorten a description, move a rule from AGENTS.md into the skill that needs it, hide a rarely used tool's declaration (its call syntax moves into the skill), fold a skill into a parent.

## Skill structure

- A small number of top-level skills, each a router whose `SKILL.md` points at parts in subfolders.
- pi stops discovery at the first `SKILL.md` it finds in a folder tree, so a part's own `SKILL.md` is never listed on its own and carries no frontmatter.
- A new skill starts as a part under the matching parent: a router line, plus its trigger words in the parent's `description` (35 words or fewer).
- A part becomes a top-level skill when its triggers no longer fit the parent's description and it is used in a large share of sessions; the decision rests on usage, counted from the session logs (`rg -o 'skills/[a-z/-]+SKILL.md'` over the tool-call arguments in `~/.pi/agent/sessions/`).

## Runbooks

- Repeat procedures (a yearly filing, a monthly export) can live in a `runbooks` skill: a short description naming each domain, and one register in its `SKILL.md`.
- One file per runbook: steps, failure modes, last-verified date; the business content stays in the notes.
- Link each runbook from the note an agent would most likely open for that domain, since that link finds it more reliably than a description.

## Hygiene

- No scheduled audit.
- Before changing a skill, measure the token budget and check the runbooks' last-verified dates.
