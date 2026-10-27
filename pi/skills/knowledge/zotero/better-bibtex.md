# Better BibTeX: cite keys and `.bib` export

## Cite keys live in a native field

This library has completed Better BibTeX's migration to Zotero's native `citationKey` field, marked by `~/Zotero/better-bibtex.migrated`.

So the legacy convention of putting `Citation Key: somekey2024` in the item's Extra field does nothing.
BBT ignores it, and the failure is silent: the item exists, the export runs, and no key resolves in the manuscript.

Set the native field directly instead, either as `citationKey` in the JSON when creating an item through the web API, or afterwards:

```bash
zot edit KEY --set citationKey=authorTopicYear2024
```

It propagates to the desktop app in about a minute.
Verify against the local API rather than the web one, since the local copy is what BBT exports from:

```bash
curl -s "http://localhost:23119/api/users/0/items/KEY" | jq -r .data.citationKey
```

## Regenerating a stale export

A `.bib` file kept by BBT auto-export can silently stop refreshing, leaving a manuscript citing keys that are absent from the file.

BBT's JSON-RPC endpoint has no auto-export trigger, so this cannot be fixed by RPC.
It does expose the export itself over HTTP, which produces byte-identical output to what auto-export writes:

```bash
curl -s "http://localhost:23119/better-bibtex/export/collection?/1/COLLKEY.bibtex" -o out.bib
```

The library id is `1` for the personal library, and `0` returns 404, which makes a working endpoint look broken.
The extension after the collection key selects the translator, so match the existing file (`.bibtex` and `.biblatex` differ in field style).

Diff the entry keys against the current file before overwriting, so a regeneration that silently drops entries is visible:

```bash
comm -13 <(grep -o '^@[a-z]*{[^,]*' current.bib | sed 's/.*{//' | sort) \
         <(grep -o '^@[a-z]*{[^,]*' out.bib     | sed 's/.*{//' | sort)
```

A `.bib` under BBT auto-export is Zotero-owned.
Regenerating it from the collection is the sanctioned refresh; hand-editing entries is not, because the next successful auto-export discards the edit.
