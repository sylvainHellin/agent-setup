# CDP layer provenance

Vendored from **browser-use/browsercode**
(`packages/bcode-browser/src/cdp/`), MIT licensed.

| Field | Value |
|---|---|
| Upstream repo | https://github.com/browser-use/browsercode |
| Commit | `e63409939d7dbc3e3d053cc3b36bd3fd81b8154e` |
| Commit date | 2026-08-15 |
| Vendored on | 2026-08-29 |
| Licence | MIT, upstream `LICENSE` copied to `cdp/LICENSE` |

| File | Source | Port status |
|---|---|---|
| `generated.ts` | `src/cdp/generated.ts` | Verbatim. Machine-generated typed bindings for all 652 CDP commands (`bindDomains(transport)`). Never hand-edit. |
| `gen.ts` | `src/cdp/gen.ts` | Verbatim. Codegen that produces `generated.ts` from the two protocol JSONs. It is a Bun build tool (uses `Bun.file` / `Bun.write` / `import.meta.dir`); run it with `bun`, not Node, for a protocol refresh. |
| `browser_protocol.json` | `src/cdp/browser_protocol.json` | Verbatim. Mirror of `chromedevtools/devtools-protocol`. |
| `js_protocol.json` | `src/cdp/js_protocol.json` | Verbatim. Mirror of `chromedevtools/devtools-protocol`. |
| `session.ts` | `src/cdp/session.ts` | Near-verbatim. The only changes are the three Bun-only reads ported to Node: `Bun.file(p).text()` to `readFile(p, 'utf8')`, `Bun.sleep(250)` to a `setTimeout` promise, and `Bun.file(p).lastModified` to `stat(p).mtimeMs`. Global `WebSocket` is used unmodified (stable on Node 22). |

## Refreshing the CDP layer

To regenerate `generated.ts` after a protocol JSON refresh, run (with `bun`
installed):

```
bun gen.ts
```

from this directory. Then re-check `session.ts` still transpiles and the
`browser_execute` verification in `../README.md` still passes.
