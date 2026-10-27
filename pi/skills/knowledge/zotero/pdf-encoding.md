# PDF text encoding issues and `zot` technical details

Two reference topics that the launchpad points here for: decoding garbled PDF/annotation text, and the internals of the `zot` binary and index.

## PDF text encoding issues

Some PDFs use non-standard font encoding where each character's Unicode codepoint is shifted by a fixed offset. The PDF renders correctly (the font maps glyphs visually), but text extraction (Zotero's annotation export included) produces garbled text.

Symptoms: annotations or highlighted text from Zotero look like `ESBXJOHT` instead of `DRAWINGS`, or `%SBX JOH TFBSDI` instead of `Draw ing search`. Spaces and Unicode characters are usually unaffected.

### Diagnosis

Take a garbled word and its expected counterpart, compare character codes:

```python
# Quick check: is the shift consistent?
[(ord(g), ord(e), ord(e)-ord(g)) for g, e in zip("ESBXJOHT", "DRAWINGS")]
# If all shifts are identical (e.g. -1), it's a simple encoding shift.
```

### Decoding

A reusable decoder script lives in this skill directory. Call it by its path
relative to this file (`<skill-dir>/decode-pdf-text.py`); do not hardcode
`~/.pi/agent/skills/...`, since the skills root differs between machines.

```bash
# Auto-detect shift from a known garbled=expected pair
echo "garbled annotation text" | python3 <skill-dir>/decode-pdf-text.py --probe "ESBXJOHT=DRAWINGS"

# Apply a known shift directly
echo "garbled text" | python3 <skill-dir>/decode-pdf-text.py --shift -1

# Decode a file of annotations
python3 <skill-dir>/decode-pdf-text.py --shift -1 < annotations.txt
```

The most common shift observed is -1 (each ASCII char codepoint is 1 higher than intended).

### When encountering garbled Zotero annotations

1. Spot-check 2-3 characters to confirm a consistent shift.
2. Run the decoder on the full annotation text.
3. If the shift is inconsistent across characters, it is not a simple encoding issue: fall back to re-extracting from the PDF via `zot fulltext KEY` or OCR.

## `zot` technical details

Implementation internals, useful when maintaining the tool or debugging index/search behavior:

- Binary: `~/.cargo/bin/zot` on both macOS and Linux (Rust, installed via `cargo install --path .` from a clone of https://github.com/sylvainHellin/zot)
- Index location (tantivy index + vectors.bin + meta.json): `~/Library/Application Support/zot/` on macOS, `~/.local/share/zot/` on Linux. `zot index --status` reports the live path; see [platforms.md](platforms.md).
- Embedding model: BGE-small-en-v1.5 (384 dim, ONNX via fastembed)
- Reranker: BGE-reranker-base (ONNX via fastembed)
- Chunking: metadata chunk (title+authors+abstract+tags) + fulltext chunks (1500 chars, 200 overlap)
- Search pipeline: BM25 (tantivy) + vector cosine + RRF fusion (+ optional BGE reranker via `--rerank`)
- Incremental sync: compares item key+version with Zotero API, indexing new/changed items plus any item whose recorded extraction status warrants a retry
- PDF text extraction: oxidize-pdf, run in an isolated subprocess per file so a malformed PDF cannot take down the run
