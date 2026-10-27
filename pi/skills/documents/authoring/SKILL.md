# Authoring documents

Typst, LaTeX and Slidev artifacts: slides, letters, reports, rebuttals, memos.

## Templates

Keep your templates in one folder (`<your templates dir>`), one self-contained directory per kind and brand, named `<theme>-<kind>-<engine>/`.
For each new artifact copy the whole directory and edit in place, so the artifact ships its own assets and fonts.
Each template directory carries a `README.md` (and, for a brand, a CI file with palette, typography and slide types); read it before styling anything, and treat it as authoritative.
If no template fits the request, or the theme is ambiguous, ask before improvising a layout.

Cross-cutting slide craft (authoring guidelines, speaker notes, outline convention, visual verification, PPTX export) applies to every deck: [slides.md](slides.md).

An HTML report page (`report-html/` at the root of this repo) is the default for anything beyond a short chat answer: explanations with figures, audits, comparisons, research syntheses, and any batch of questions for the user.
Markdown stays right for short records and for anything another program reads; a Typst report stays right for what leaves the house as a PDF.

## Cross-cutting conventions

- `tectonic` is a self-contained LaTeX engine that fetches packages on demand: `tectonic <file>.tex`.
- `typst` for everything Typst; use `typst compile --root / <file>.typ` when imports use absolute paths, and `--font-path fonts/` when a template bundles its fonts.
- Emit real `= Section` / `== Subsection` headings and restyle them with `#show heading` rules instead of drawing sections purely with styling functions: editor outlines and PDF bookmarks derive only from literal heading markup, so a function-drawn document has an empty outline. Slide-specific wiring is in [slides.md](slides.md).
- In German documents write umlauts and eszett directly (ä ö ü ß, "München", "Straße"); both engines accept UTF-8, so ae/oe/ue/ss transcriptions are wrong.
- Verify visually after every meaningful edit: render the PDF and read the rendered pages before declaring done.
  Render to PNG (`pdftoppm -r 150 -png file.pdf /tmp/out`) and read the image; this works on a headless machine too.

## Reader-facing copy

These apply to any text a reader or participant sees inside an asset (slide, letter, board label, handout, workshop canvas), not only to template-rendered documents.
Load the `writing` skill before drafting this copy and run its review pass after; the rules below are the asset-specific additions to it.

- State what a thing is for before how to use it, so the reader has the purpose before the mechanics: "This board collects and rates AI use cases. It has two areas: ...".
- German reader-facing text stays impersonal: no "Du" address, but not stiffly formal either. Give instructions as infinitives or passively ("einen Zettel in das Feld ziehen") or as plain descriptive statements, rather than addressing the reader directly.
- An asset carries only what must persist. Anything the presenter will say out loud does not belong on the slide or board; leaving it out keeps the asset a reference, not a script.
- German copy has its own failure modes (LLM-typical Denglisch, calques, compound orthography, title conventions): `german-copy.md` in the `writing` skill.
