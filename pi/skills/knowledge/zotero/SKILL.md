# Zotero

Access the user's Zotero library via the `zot` CLI (https://github.com/sylvainHellin/zot, installed with `cargo install --path .` from a clone): hybrid semantic search (BM25 + vector + RRF), live API queries, fulltext retrieval with char-offset navigation, metadata lookup, bibliography export, and library writes (add / edit / attach / trash / collections).

## When to activate

- User asks about papers, references, citations, or literature.
- User mentions a paper title, author, or research topic.
- A task needs to enrich Obsidian notes with Zotero metadata, or check what is in the local library.
- User wants a paper added to Zotero (DOI, arXiv link, ISBN, PubMed ID, or a downloaded PDF), metadata corrected, a file attached, or an item removed.
- A task needs a bibliography for a paper or proposal, or asks how the library is organised into collections.

## Platform split

Every `zot` command reads through the app's local API when it answers, and otherwise falls back to api.zotero.org with the configured web API key, printing one note on stderr.
So all commands work either way; without the app they are a little slower, `zot pdf` downloads files it cannot find under `~/Zotero/storage`, and `zot add` loses the PDF recognizer and tree-view IDs (details in [platforms.md](platforms.md)).
The web library is the synced one, so with a stale or stopped app it is the more current source; `ZOT_BACKEND=web` forces it, `ZOT_BACKEND=local` forces the app.
Index locations and headless use: [platforms.md](platforms.md).
If `zot` itself is missing, [FALLBACK.md](FALLBACK.md) has direct REST access via curl + jq against the local API.

## Which command answers which question

`zot <cmd> --help` is the source of truth for flags; do not guess them from memory.

| Need | Command |
|---|---|
| Find papers by meaning, works offline | `zot search "query"`, with `--rerank` when precision matters |
| Find papers by keyword, guaranteed current | `zot find "query"` |
| Metadata, PDF path, or stored text of a known item | `zot get KEY`, `zot pdf KEY`, `zot fulltext KEY` |
| Valid filter values, before filtering on them | `zot tags`, `zot authors` |
| Add a paper by DOI, arXiv id, ISBN, PMID, or PDF | `zot add` |
| Render a bibliography (BibTeX, RIS, CSL JSON) | `zot export`, by key, `--collection`, or `zot search --export` |
| See how the library is organised, or file items | `zot collections`, `zot unfiled`, `zot edit --add-collection` |
| Decide *which* collection or tag an item gets | [filing.md](filing.md) |
| Add a standard (DIN, ISO, EN) | Not `zot add`; see [standards.md](standards.md) |
| Fix metadata, attach a file, trash an item | `zot edit KEY`, `zot attach KEY FILE`, `zot rm KEY` |
| Create or delete a collection | `zot collections --create NAME`, `zot collections --rm REF` |
| Refresh the index, or find out why an item is missing | `zot index`, `zot index --status`, `zot index issues` |

`--json` works on every command, for piping into `jq`.

## What `--help` will not tell you

- Nothing is added without a collection. `zot add` with no `--collection` drops the item into the library root, where it is invisible to every collection view and every export.
  A filing convention (topical tree plus a per-manuscript collection, tag facets) is in [filing.md](filing.md); adapt it to your library.
- The two write paths use different APIs, which is why they fail differently.
  `zot add` goes through Zotero's *local connector* when the app runs (no key needed) and through the web API when it does not; both refresh the index.
  `zot edit`, `attach`, and `rm` always go through the *web* API: they need the one-time `zot config set-key` and sync back to the app within seconds.
- `zot collections --rm` is permanent: Zotero has no trash for collections, so unlike `zot rm` on an item there is nothing to restore from.
  It prints the blast radius and asks for the collection's name back before deleting a subtree; the items themselves survive and become unfiled.
- `zot export` strips `file`, `annote`, `abstract` and `keywords` from BibTeX by default, since they describe the library rather than the work.
  `--raw` keeps them, and only BibTeX is stripped.
- Anywhere a collection is named, a key, an exact name, or a tree-view ID (`C42`) all work.
  An ambiguous name refuses rather than guessing, so `zot collections --flat` first when two collections may share one.
- `zot search` checks the index against Zotero before searching and prints a note when it is stale.
  `--no-sync-check`, or `ZOT_NO_SYNC_CHECK=1` for a whole session, skips that round trip when offline or in a hot loop.
- Parse stdout only.
  Progress lines go to stderr, so merging them with `2>&1` before `jq` breaks the parse.
- Fulltext is local-only and per item: a PDF attachment, a stored HTML snapshot, or the note body.
  Nothing is fetched from the network, so a URL-only item becomes searchable only once a snapshot is attached in Zotero.
- `zot index` retries every item that failed, was partial, or looked suspicious, on each run.
  A plain re-run therefore fixes more than it appears to, and `--force` is for when that leaves the item unexplained.
- An unsliced `zot fulltext` can be an entire book, so reach for `--start`/`--end` or `--max-chars` by default.
- Cite keys live in Zotero's native `citationKey` field, so an Extra `Citation Key:` line is ignored and fails silently.
  That plus regenerating a stale Better BibTeX `.bib` export: [better-bibtex.md](better-bibtex.md).

Caveats for the write commands (recognition fallback, sync timing): the repo README.

## Leveled search: search, then expand context

The core retrieval pattern: search returns snippets with char offsets into the stored fulltext, so surrounding context is read by offset without loading the whole paper.

```bash
zot --json search "evaluation metrics" --limit 5
# pick a result: key=ABC123, char_start=2340, char_end=2890
zot fulltext ABC123 --start 2000 --end 4000
```

For tasks touching many papers (bulk vault notes, literature sweeps), parallelize per-paper work with subagents, each given its keys and this leveled-search pattern.

## Error handling

| Error | Cause | Fix |
|-------|-------|-----|
| "Could not reach Zotero" | App not running and no web API key to fall back on | `zot config set-key`, or start Zotero |
| "No Zotero API key configured" | `edit`/`attach`/`rm` need the web API | `zot config set-key` (key from zotero.org/settings/keys) |
| "already appears to be in the library" on `add` | Duplicate guard hit | Use the existing key, or `--force` if truly distinct |
| "not found on api.zotero.org" | Item created locally, not yet synced up | Sync Zotero, then retry the `edit`/`attach`/`rm` |
| "api.zotero.org has N subcollection(s) ... but the local library has M" | A collection was created upstream and not synced down; deleting would cascade into collections `--rm` cannot show you | Sync Zotero, then re-run |
| "Index is empty" | Index not built yet | Run `zot index` |
| "No fulltext found for item" | Item not in index, or has no local fulltext source | Run `zot index`; if the item is URL-only, attach a snapshot in Zotero first, then re-index |
| In library but missing from `zot search` | Extraction failed or yielded too little text on ingest | Run `zot index` (it retries such items automatically) and inspect `zot index issues` for the reason; `--force` only if that leaves it unexplained |
| First search slow (~2.5s) | Embedding model load | Normal; cached after first use |
| `--rerank` slow (~4.5s) | Reranker model is 1 GB | Use only when precision matters |

## PDF text encoding issues

Some Zotero PDFs use non-standard font encoding, so extracted text comes back garbled (`ESBXJOHT` instead of `DRAWINGS`).
Diagnosis, the `decode-pdf-text.py` decoder, and recovery steps: [pdf-encoding.md](pdf-encoding.md).

## Coexistence with Zotero MCP

Both hit the same library and do not conflict.
Prefer `zot search` over MCP's keyword-only semantic search; use MCP for features not in `zot` (notes, annotations, batch tag updates).

## Technical details

Binary path, index location, models, and the chunking/search pipeline: [pdf-encoding.md](pdf-encoding.md#zot-technical-details). Consult only when maintaining `zot` or debugging the index.
