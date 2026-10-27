# Research paper digests (`type: paper`)

Loaded from the `knowledge` skill when ingesting or digesting an academic paper.

## Mandatory prerequisite

Load `zotero/SKILL.md` before any paper-note operation (create, update, or even "check if it exists"), because Zotero is the authoritative source for metadata and fulltext, and guessing from training knowledge produces wrong digests.
Concretely, before writing any paper digest:

1. Run `zot find "<title or keywords>"` or `zot search` to locate the Zotero entry. Do not start with `fd` / `rg` against the vault's papers folder.
2. Run `zot --json get <KEY>` to pull authoritative metadata (title, year, authors, journal, DOI); this populates the frontmatter, never guess.
3. Run `zot fulltext <KEY>` (or fall back to `zot pdf <KEY>` + `pdftotext`) to read the actual paper before writing a digest. Do not summarise from training knowledge or from a single quoted paragraph.

If `zot` is unavailable, follow `zotero/FALLBACK.md` before proceeding.

## When to create

- The user shares a paper (PDF, URL, or citation).
- They ask to summarize or digest a research paper.
- They ask to add a paper to the vault.

## Workflow

1. Read the vault's paper template (for example `Templates/Research Paper Digest.md`).
2. Create the note at `<your vault>/03-resources/papers/<Paper Title>.md` (Title Case, special characters stripped). Check first whether it already exists with `fd -e md -F '<Title>.md' <papers folder>`, after the `zot` lookup, never before.
3. Fill frontmatter from the `zot get` output: `type: paper`, `status`, `year`, `authors`, `link`, `journal`, `date`, `zotero-key`, `doi`.
4. Write sections: Summary, Key takeaways, Notes. Keep each section tight: a digest, not a transcription.
5. Do not auto-create contact cards for paper authors; only create author contacts when explicitly asked. Use `[[First Last]]` wikilinks in the frontmatter `authors` field regardless: broken links are fine, they signal "person exists in the literature" without cluttering the contacts folder with strangers.
6. Link every relevant concept, method, tool, or dataset mentioned. If an important term is missing from the vault, create a new concept note for it, following `concept-notes.md` (discuss first when the concept is substantial).
7. Link to other papers already in the papers folder when relevant.

## Language

Default to English for all research paper notes, regardless of the paper's original language.

## Capture discipline reminder

Paper digests are reference material, not transcription.
A 200-line summary of a 12-page paper is a sign the digest is doing the wrong job: the user has the PDF if they want the full text.
Capture what is useful, surprising, or worth citing, then link out.

## Related

- `SKILL.md`: the launchpad and capture-discipline rules.
- `concept-notes.md`: when a paper introduces a concept worth its own note.
- `zotero/SKILL.md`: bibliography source of truth; paper digests cross-link to Zotero entries.
