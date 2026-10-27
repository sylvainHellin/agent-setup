# Documents understanding (the `doc` CLI)

`doc` turns documents into Markdown.
Source: https://github.com/sylvainHellin/doc-cli; install it from a clone with `uv tool install .`, so `doc ...` runs from anywhere.
Cloud engine keys (`mistral`, `gemini`) live in `~/.config/doc/config.json`, written once per machine with `doc config set-key <engine> <key>`, so cloud engines work with nothing exported.

`doc --help` and the repo `README.md` are the source of truth for commands, flags, the engine table, and the routing pipeline.
Read them rather than guessing.

## Commands

- `doc parse <file>`: full pipeline: Office and born-digital PDFs parsed locally, scanned pages and images routed to OCR.
- `doc ocr <file> [--engine ...]`: force the OCR path over a file or image.
- `doc inspect <file.pdf>`: pdf-inspector classification report (page type, `pages_needing_ocr`).

## Engine choice

Engines: `mistral` and `gemini` (cloud), `rapidocr` and `glm` (local), plus the opt-in local `indra` (`[indra]` extra); the README has the benchmark.
Prefer `mistral`.
On a real German administrative scan it was the only engine that kept umlauts/ß and parsed the amount table correctly, with separate Euro and cent columns, at cloud speed.
Gemini is fast but mangles tables; rapidocr is text-only with visible OCR noise; glm is clean but ~25x slower on a laptop.

## The bad-text-layer footgun

`doc parse` and `doc inspect` trust a PDF's embedded text layer and report `confidence 1.000` even when that layer is junk Adobe OCR over a scan.
The tool gives no warning; the only signal is that the output looks wrong: missing umlauts (`MUnchen`, `StraBe`), mojibake, scrambled tokens (`F!Uligkeitstag`, `*1ii*`).

When `doc parse` on a PDF comes back garbled like that, the embedded layer is bad OCR, not born-digital text.
Re-run it through real OCR:

```
doc ocr <file.pdf> --engine mistral
```

The same fix applies when the output reads cleanly but the numbers are missing: on a caterer's offer, `doc parse` dropped every price from the tables without a warning, and `doc ocr --engine mistral` recovered all of them.
