# Slides: cross-cutting craft

Everything here applies to every Typst deck regardless of theme.
Each theme's template directory points at its CI file for the brand and carries the gotchas the CI file does not.

Templates are self-contained: copy the `.typ` file (or the whole directory) for each new deck, duplicate or delete slides as needed.
Create a deck by copying the template file itself, never by cross-tree `#import` of it: an export tool needs a self-contained deck, and the deck must ship the assets it references alongside it.

## Authoring guidelines

Read one of the user's finished decks before drafting, if they keep a folder of them (`<your presentations folder>`).

- Title names the topic as a noun phrase, subtitle carries the claim: `title: [Context Rot]` with `subtitle: [The fuller the context, the worse the performance.]`. Writing the claim as the title is the most common miss.
- A subtitle or takeaway line appears only when it adds a fact, a claim or a question the body lacks; otherwise leave it out. Filler like `Updates since the last meeting` or `Please: share the posts` gets cut in review.
- Every borrowed number or figure carries a small grey italic source line on the slide itself.
- Open on a concrete artifact and a real question rather than a concept: show the thing, ask what the audience would ask, then show why the obvious approach fails.
- Thread one running example or one phrase through the whole talk.
- Reveal a dense slide one step at a time by duplicating the slide call, one PDF page per click, with `hide()` holding the layout. No animation library.
- Structure: cover, agenda, one numbered `slide-section` divider per section, closing.
- Ask for the time budget before building. Logical slides are what costs time; build pages are free.
- One focal point per slide, no dense text, and never override theme styling inline.
- Build one slide at a time and show it before moving on.

## Speaker notes (`notes:` convention)

Give every slide function in a template a `notes:` parameter.
Notes live inside the `.typ`, attached to the slide, so the deck is the single source of truth with no sidecar markdown.
They are plain strings; use `\n\n` for paragraph breaks.
Write short notes inline, or hoist a long one to a `#let note-6 = "..."` above the slide and pass `notes: note-6`.
A slide without `notes` is unchanged and emits an empty note.

Mechanism: each slide emits a hidden `#metadata(...)<speaker-note>` marker per page, and `typst query <deck>.typ "<speaker-note>"` extracts them in document order, so the Nth note maps to page N.
Add, remove, reorder, or duplicate slides and the notes stay aligned.

## Outline convention (PDF bookmarks + editor outline)

Put this preamble right after the file header comment, before the first `#let`:

```typst
#set heading(outlined: false, numbering: none, bookmarked: false)
#show heading: it => none
= Template
#set heading(bookmarked: true)
```

`= Template` groups every template definition under one outline node so the editor outline can collapse the whole template part and show only the slides; it is not bookmarked in the PDF. Keep it as the first heading of any single-file deck, and the `show heading` rule must come before it, or the heading renders as a stray first page.

For every slide call, add a literal heading line immediately above the call. The heading renders to nothing visually but populates the PDF bookmark tree and the editor outline (tinymist in Neovim or VS Code).

- `=` Level 1: cover, agenda, section dividers, closing, thank-you. Anything that stands on its own.
- `==` Level 2: individual content slides that belong under a section divider.

```typst
= 01 Section Name
#slide-section(number: [01], title: [Section Name], img: "...")

== Slide Title
#slide(title: [Slide Title])[ ... body ... ]
```

Match the visible slide title verbatim so PDF and source outlines stay in sync. Do not rely on a runtime `bookmark()` helper that wraps `heading()`: tinymist's documentSymbol provider only sees literal heading syntax.

## Typst layout gotchas

- `place()` with a positive `dy` moves the element down, whatever the anchor.
- `image(fit: "contain")` does not crop transparent or white margins in the source; pre-crop them (`magick in.png -trim +repage out.png`).
- Wrap an `image` in a `box` of fixed size to enforce a bounding box.
- Use `align: bottom` in a grid for baseline-like alignment of mixed content.
- Escape `$`, `@` and a leading `-` in content (`\$`, `\@`, `\-`), and resize photos to about 1920 px before compiling.

## Verifying slides

After every meaningful edit:

```bash
typst compile presentation.typ
pdftoppm -r 110 -png presentation.pdf /tmp/preview/p
# read /tmp/preview/p-*.png to visually verify
```

For multi-slide decks, build a contact sheet with `magick montage` or read the PNGs in sequence. Fix issues before declaring done.

## Exporting the deck

The PDF is the shareable artifact.
For presenting from PowerPoint or Keynote presenter view (current slide plus notes on the laptop), a PPTX with one full-bleed page image per slide and that slide's `notes:` text in the notes pane works well.
The author's `typst2pptx` script does exactly that (not public yet); until it is, build the same with `python-pptx` from the rendered PNGs and the `typst query` output above.
