---
name: knowledge
description: "Load before any search, read or write in the Obsidian vault, whenever a project, person, org, paper, concept or meeting is mentioned, and for Zotero: papers, citations, DOIs, BibTeX, collections (zot CLI)."
---
# Knowledge

Manage the user's Obsidian vault (`<your vault>`) from any working directory.
For any paper, reference, citation or bibliography query and for Zotero writes (add by DOI/arXiv/ISBN/PMID/PDF, fix metadata, file into collections, export BibTeX), read `zotero/SKILL.md`; paper notes stay here (`paper-digests.md`).

## Reading

The vault's own `AGENTS.md` and its structure note (folders, naming, the `type:` vocabulary) are the full reference; read them first.
A common layout is PARA-as-folders, type-as-metadata:

| Domain | Path |
|--------|------|
| Person / org | `03-resources/contacts/First Last.md`, `03-resources/orgs/Company Name.md` |
| Project / area | `01-projects/<slug>.md`, `02-areas/<slug>.md` |
| Meeting | `meetings/YYYY-MM-DD - Title.md` |
| Paper | `03-resources/papers/<Paper Title>.md` |
| Concept / howto / index / note | `03-resources/<Title>.md` (flat, distinguished by `type:`) |
| Daily note | `00-inbox/YYYY-MM-DD.md` (active); `04-archive/daily notes/YYYY/` (processed) |

Adapt the table to your own vault.
From a non-vault directory, expand the path yourself rather than passing a bare `~` to a tool that will not expand it.

### Search tools

A vault is plain Markdown and usually small: `rg` across all of it costs milliseconds, so no index and no running app are needed.
The official `obsidian` CLI only remote-controls the desktop app, which does not exist on a headless machine; never make a lookup depend on it.

When keyword search fails, escalate to `qmd` (https://github.com/tobi/qmd), a local hybrid index over Markdown, if it is installed.
`qmd search "<words>"` ranks by keywords in a fraction of a second, and `qmd vsearch "<sentence>"` retrieves by meaning, across languages, which is what finds the note whose wording you cannot guess.
The index is a snapshot, so a hit is a pointer: read the file before quoting it.

- `fd -e md -F '<Name>.md' <your vault>`: direct filename hit (fastest); drop `-F` for a regex over titles.
- `rg -li 'pattern' <your vault>`: content search; list files first, then read the hits.
- Backlinks: `rg -li '\[\[<name>[#|\]]' <your vault>`, which catches `[[X]]`, `[[X|display text]]`, `[[X#heading]]`, `![[X]]` and frontmatter `related:` entries alike, since the filename is always the left side of the link.
- That single call is exhaustive: frontmatter `aliases:` only feed the autocomplete, which inserts `[[Real Name|alias]]`, so no resolvable link ever hides the filename.
- A hand-typed `[[alias]]` therefore does not resolve and spawns an empty stub note when clicked; rewrite it to `[[Real Name|alias]]` on sight.
- Vault-wide, `VAULT_DIR=<your vault> uv run <skill-dir>/vault_links.py unresolved` reports every broken link and `... fix-aliases` rewrites the alias ones (dry run until `--apply`, ambiguous aliases left for a human), `... orphans` lists notes nothing links to, `... dead-ends --max N --folder meetings` lists notes that link out to too few others.
- Outgoing links: `rg -o '\[\[[^]|#]+' <file> | sed 's/..//' | sort -u`.
- Outline: `rg -n '^#{1,6} ' <file>`.
- Alias check: `rg -U -l '(?m)^aliases:\n(?:[ \t]*-.*\n)*[ \t]*-[^\n]*<term>' -g '*.md' <your vault>`.
- `.base` views are Obsidian-only queries; reproduce the filter with `rg` instead of trying to run one.

Try the most specific note first; fall back to content search only on miss. Follow `[[wikilinks]]` to traverse. Index notes map topic clusters before broad searches.

## Writing

### Before any write

1. Read the vault's `AGENTS.md` and its structure note (folders, type vocabulary, naming).
2. Search before creating. Run the `fd` filename hit and the alias check above on the candidate name and its abbreviations and language variants.
3. Consolidate first. If an existing note covers the topic, append or extend it, never create a parallel note.

### Every note

- Say what changed. Tell the user in one line what was captured and where. Silent persistence is forbidden: an edit they don't know about is useless.
- Make it discoverable. A fresh note is only findable through links from notes the user already visits, all the more when the agent named it. Link it back from its natural parents, not just outward, then name the parents you linked from in one line so the user can redirect them.

### Capture discipline

The vault is a curated knowledge graph, not a dumping ground.

- Pass at least one of the four Building a Second Brain criteria: inspirational, useful, personal, surprising. Drop the rest.
- Keep it sharp (3-10 lines + links). No walls of text.
- Fix on touch, without asking. When a note you read for a task is stale or contradicted by current reality, correct it in the same pass, even when the staleness predates your task, and report the fix in one line afterwards. The same applies to renames that follow from the fix, including updating the inbound wikilinks and leaving the old name as an alias.

Default for new notes: discuss first, write at the end. Small updates to existing notes (~1-2 lines) are persisted directly, always with a one-line mention.

Per-type refinements of that rule:

- `concept`, `paper`: discuss first for anything non-trivial; write at the end. Workflows: `concept-notes.md`, `paper-digests.md`.
- `howto`: auto-persist + one-line mention; append to an existing howto when the topic matches.
- `index`: lightweight, write directly; create only when a cluster passes 3+ related notes.

### Conventions

- Match the language of the surrounding note. Default English; academic always English.
- Wikilinks are the taxonomy: every note must be cross-linked, including a link back from a parent it can be discovered through.
- Frontmatter uses the vault's type vocabulary. Empty `type:` is a misfiling; use `type: note` as the explicit catch-all.
- Never overwrite. Append or branch.
- Tasks do not live in the vault: a task tracker holds them (`productivity` skill).
