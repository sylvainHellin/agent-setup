# Skills (`SKILL.md` + siblings)

A skill is a directory with a `SKILL.md` entry point and optional sibling files. When the agent decides a skill applies, the whole `SKILL.md` enters context for the rest of the turn. `SKILL.md` is a launchpad: it says when to fire and where detail lives; the detail sits in siblings read on demand.

## Frontmatter

Only `name` and `description` are required. A skill with no `description` does not load at all.

- `name`: lowercase letters, numbers, hyphens; no leading/trailing/double hyphen. Prefer gerund/verb form (`processing-inbox-notes`, not `inbox`) so the trigger is obvious.
- `description`: the single highest-leverage line in the skill. It is the only text always in context, and the sole basis on which the agent decides to load the skill. It must state both what the skill does AND when to use it, in the words a user would actually say.

Optional, rarely needed: `license`, `compatibility` (environment requirements), `metadata`, `allowed-tools`, `disable-model-invocation` (true = loadable only via `/skill:name`).

### Writing the description

Trigger-first and terse: open with "Load when/before ..." and name the concrete situations, file types, and phrases that should fire it, including near-misses where it competes with another skill.
Add capability wording only where needed to disambiguate (for example which CLI).
Keep it under ~35 words: every description sits in context on every turn of every session.

- Weak: `Helps with PDFs.`
- Bloated: a paragraph restating the skill's whole feature list before the triggers.
- Strong: `Load when extracting text or tables from a PDF, filling forms, merging files, or when the user mentions PDFs or document extraction.`

## Two kinds of skill

The judgement call that decides the shape:

- Process skill: the skill *is* a workflow (research, orchestration, this skill). One coherent procedure, no variants. A single longer `SKILL.md` is defensible; do not force a split.
- Content-variant skill: the skill documents several variants (brands, templates, languages, targets). `SKILL.md` selects; each variant lives in its own sibling. Always split these.

If a section starts with "for variant X..." or "when using mode Y...", it belongs in a sibling with a one-line pointer from `SKILL.md`.

## Target shape

```
<skill-name>/
├── SKILL.md          launchpad: frontmatter, purpose, when it fires,
│                     selection logic, cross-cutting rules, pointers
├── <variant>.md      full detail for one variant, loaded on demand
├── <reference>.md    extended reference (e.g. fallback flow)
└── <recipe>.py       runnable asset, executed directly
```

Keep `SKILL.md` lean: ~50-150 lines for a content-variant skill, under ~500 as a hard cap for any skill. Keep references one level deep. For a reference file over ~100 lines, put a short table of contents at the top so a partial read still shows its scope.

## What belongs where

In `SKILL.md`: when the skill fires (triggers), selection logic across variants, cross-cutting rules that apply to every variant, the 1-2 footguns hit every task, and one-line pointers to the siblings.

In a sibling file: the full reference for one variant, per-variant assets / workflows / gotchas, exhaustive constants and tables and brand tokens, long code recipes (extract to `.py` / `.sh`), and variant-specific footguns.

## Mode: bootstrap (new skill)

1. Capture intent: what task, what triggers it, which variants (if any). Decide process vs content-variant.
2. Draft the `description` first and hardest: it determines whether the skill ever loads.
3. Write a lean `SKILL.md` to the target shape. Put variant detail and any code recipe over ~10 lines into siblings from the start.
4. Create the directory in a skills folder pi reads (the `skills` array in `settings.json`, or `~/.pi/agent/skills/`). Run `/reload` in an open session to pick it up.
5. Show the draft, line count, and structure for review before finishing.

## Mode: refactor (bloated skill)

Symptoms: `SKILL.md` over ~150 lines without a process justification, repeated `## <Variant>` sections with the same sub-headings, inline directory listings, inline code recipes, or the agent loading the whole file to read one variant.

1. Identify the per-variant axis (theme, mode, language, target).
2. Move each variant's content into its own `<variant>.md`.
3. Reduce `SKILL.md` to triggers, selection table, cross-cutting rules, and pointers.
4. Extract inline code over ~10 lines into sibling `.py` / `.sh` files.
5. Replace duplicated domain knowledge with a link to its source of truth (a note, a template, a `--help`).
6. Show before/after line counts and the new file tree.

## Mode: audit (review existing skills)

For each skill, report and flag against the principle:

- Is the `description` specific, with explicit triggers? (Vague description = undertriggers.)
- Is `SKILL.md` a launchpad, or a crammed single file over ~150 lines with no process reason?
- Does it use siblings for variants and reference, or pile everything into one file?
- Does it duplicate knowledge that lives elsewhere (codebase, template, vault note) instead of pointing at it?
- Anti-patterns to call out: inline directory trees ("`ls` is always available"), all-caps `ALWAYS` / `NEVER`, deeply nested references, rules the base model already knows, stale file paths.

## Anti-patterns

- Bloated single-file skill: everything in `SKILL.md` instead of siblings.
- Vague description: the skill exists but never fires.
- Directory listings inside instructions: paths drift; document capability, not file trees.
- All-caps shouting: reframe as the reasoning instead.
- Duplicated domain knowledge: a copy of what a template, note, or `--help` already owns.
- Deeply nested references: chains the agent will not follow.
