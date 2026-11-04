# Concept notes (`type: concept`)

Loaded from the `knowledge` skill when creating or substantially editing a concept note. The frontmatter and section skeleton come from the vault's concept-note template (for example `Templates/Concept note.md`); this file covers what is specific to a vault note.
The teaching itself (asking first, the FastAPI-style rules, figures, recall) lives in the `tutor` skill.

## When to create

- A `tutor` lesson or another learning conversation has produced understanding worth preserving.
- A concept gap surfaces during another task.

## Workflow: collaborative deep-dives

New concept notes (and major expansions) are collaborative. Default flow:

1. Check the vault. Search for existing notes on the topic and related concepts with the `fd`, `rg` backlink and alias-check recipes in `SKILL.md`. If a note already covers the territory, append or extend it instead of creating a parallel one.
2. Research. Use subagents (`researcher`) to gather accurate technical information. Verify claims, gather sources. Do not rely solely on training knowledge.
3. Teach with the `tutor` skill: lesson page, recall questions, round trip. This step is non-optional: it's how the user learns what entered the vault.
4. Persist at the end. Once understanding is reached, propose what to save. Draft the note and write it. Mention in one line what was captured and where.

For small additions to existing concept notes (a new section, a correction, a link): auto-append and mention what was added.

## Quality standard

The body follows the teaching rules of the `tutor` skill, condensed from the lesson page; on top of them:

- A "Connection to [[Project]]" section ties the concept to their projects, research or tools.
- Why the user needs the note goes in a frontmatter `context:` property, one quoted string with wikilinks allowed, never in a body sentence; the body opens on the concept itself.
- Figures from the lesson are embedded as PNG; recall questions and comments stay on the page.
- End with reference material. After the teaching part: tools, reading list, sources, `## Related` wikilinks.

## Related

- `SKILL.md`: the launchpad and capture-discipline rules.
- `tutor` skill: how to teach the concept before the note is written.
- `paper-digests.md`: when a paper introduces a concept worth its own note.
