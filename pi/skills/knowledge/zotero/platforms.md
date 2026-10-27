# Platform specifics: desktop vs headless

`zot` reads through the Zotero desktop app's local API when the app answers, and falls back to the web API (api.zotero.org) otherwise, so every command works on a machine without the app as long as `zot config set-key` has been run there once.
On a headless Linux server the desktop app can still run under `xvfb-run` as a user service, if you want the local API there too.

## Binary and paths

- `zot` binary: `~/.cargo/bin/zot` on both macOS and Linux. `which zot` is the portable check.
- Local index (tantivy + vectors): platform-dependent.
  - macOS: `~/Library/Application Support/zot/`
  - Linux: `~/.local/share/zot/` (XDG data dir)
  - Do not hardcode either; `zot index --status` reports the live location.

## What changes without the desktop app

| Capability | App running | App closed (web API key needed) |
| --- | --- | --- |
| `zot search`, `zot fulltext` | Local index | Same; the sync check reads web versions |
| `zot find`, `get`, `tags`, `authors`, `unfiled`, `collections`, `export` | Local API | Same queries on api.zotero.org, slower |
| `zot pdf`, `zot index` | File path from the app | `~/Zotero/storage` copy if its MD5 matches the server, else downloaded to `~/.cache/zot/attachments/` |
| `zot add` by identifier | Connector import | BibTeX converted and created via web API, all collections in one request |
| `zot add --pdf` without identifier | Zotero recognizer | DOI or arXiv ID read off page one; else standalone attachment |
| Collection tree-view IDs (`C42`, `L1`) | Work | Not available; use key or name |
| `zot edit` / `attach` / `rm` | Web API | Web API |
| `FALLBACK.md` curl recipes (localhost:23119) | Work | Do not |

`ZOT_BACKEND=web` or `=local` forces a side.
The web library is the synced one, so a stopped app means the local `~/Zotero` copy may be stale while the web path is current.
Writes made via the web API reach every machine through Zotero sync (seconds with auto-sync on).

## Opening files

`zot pdf KEY` prints a file path on both platforms. To view it:

- macOS: `open "$(zot pdf KEY)"`.
- Headless Linux: there is no GUI viewer. Read the path with the agent's file tools, or extract text with `zot fulltext KEY`. `/usr/bin/open` on Ubuntu is `openvt`, not a document opener; do not rely on `open`.
