# Concept notes (`type: concept`)

Loaded from the `knowledge` skill when creating or substantially editing a concept note. The frontmatter and section skeleton come from the vault's concept-note template (for example `Templates/Concept note.md`); this file covers how to write one well.

## When to create

- The user asks a substantial question about a concept ("what is X?", "explain Y", "how does Z work?").
- A learning conversation has produced understanding worth preserving.
- A concept gap surfaces during another task.

## Workflow: collaborative deep-dives

New concept notes (and major expansions) are collaborative. Default flow:

1. Check the vault. Search for existing notes on the topic and related concepts with the `fd`, `rg` backlink and alias-check recipes in `SKILL.md`. If a note already covers the territory, append or extend it instead of creating a parallel one.
2. Research. Use subagents (`researcher`) to gather accurate technical information. Verify claims, gather sources. Do not rely solely on training knowledge.
3. Discuss and teach. Walk the user through the concept interactively. Identify what they already know, where the gaps are, what depth he wants. This step is non-optional: it's how the user learns what entered the vault.
4. Persist at the end. Once understanding is reached, propose what to save. Draft the note and write it. Mention in one line what was captured and where.

For small additions to existing concept notes (a new section, a correction, a link): auto-append and mention what was added.

## Quality standard

Pedagogical, FastAPI-documentation-inspired:

- Start with intuition, not formalism. Open with a practical takeaway or an analogy. Save the formal definition for after the reader grasps the idea.
- Progressive disclosure. Build from simple to complex; each section builds on the previous. Never introduce a term that hasn't been introduced.
- Plain language first, jargon second. Explain the idea in everyday terms before naming the technical term.
- Short paragraphs. One idea per paragraph, never dense walls of text.
- Connect to the user's world. Tie the concept to their projects, research, or tools where relevant. A "Connection to [[Project]]" section makes it actionable.
- Why the user needs the note goes in a frontmatter `context:` property, one quoted string with wikilinks allowed, never in a body sentence; the body opens on the concept itself.
- Python snippets carry type hints on every parameter and return value, and stay runnable as shown.
- A step-by-step explainer uses one running example, one idea per step, and a figure and a runnable snippet per step that agree with the text.
- End with reference material. After the teaching part: tools, reading list, sources, `## Related` wikilinks.

## Related

- `SKILL.md`: the launchpad and capture-discipline rules.
- `paper-digests.md`: when a paper introduces a concept worth its own note.
