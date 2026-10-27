---
name: documents
description: "Load before authoring or editing .typ, .tex or Slidev documents (slides, letters, reports), drawing TikZ figures or charts (tex-fig), parsing PDFs, Office files or scans (doc CLI), and writing HTML report pages the user comments on."
---
# Documents

Producing and reading document artifacts and figures.

## Parts

- `authoring/SKILL.md`: before authoring or editing a .typ, .tex or Slidev artifact, or drafting reader-facing copy for one (slides, letters, reports, rebuttals, memos).
- `parsing/SKILL.md`: before reading any non-text document (PDF, .xlsx, Office, image, scan); the `doc` CLI turns it into Markdown and runs OCR.
- `figures/SKILL.md`: before drawing, editing or reproducing a figure, diagram or chart, and when a screenshot of a figure should become TikZ source (tex-fig).
- HTML reports: read the `README.md` of the `report-html/` template shipped at the root of this repo first, create the page as it describes, write only the content in `<main>`, then open it in a browser.
  The user comments in the page (element picker, text selection, question cards, general notes) and pastes the exported Markdown into the chat; revise the page in place.
- Websites and landing pages: derive the look from the subject, never the generic AI look (dark hero, teal or violet gradients, glow, pill buttons, hover-lift cards); a site's own repo `AGENTS.md` holds its design rules.

Text inside any of these also follows the `writing` skill.
