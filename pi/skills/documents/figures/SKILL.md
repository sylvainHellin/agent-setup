# LaTeX figures with tex-fig

tex-fig (https://github.com/sylvainHellin/tex-fig) holds `texfig.sty`, `texfig-plots.sty` for pgfplots, and `examples/`.
Clone it once (`<tex-fig clone>` below) and read its `README.md` before drawing anything: it owns the style list, the colour rules, the package options and the pgfplots traps.
A figure is TikZ source, never an imported PNG or SVG, so it stays diffable and is typeset in the document's own font.

## The loop

1. `ls <tex-fig clone>/examples/`, pick the nearest figure and copy its structure; a new figure almost never starts from an empty canvas.
2. Author on a comfortable centimetre canvas and wrap the picture in `\resizebox{\tffigwidth}{!}{...}`, so the including document decides the width.
3. Render with `examples/build.sh <name|path.tex> [dpi]`, which leaves a PNG in `~/Documents/tmp/` by default (`OUT=<dir>` writes it elsewhere); `PALETTE=tum` previews another brand and suffixes the filename with the palette (`f1-tum.png`); `STEPS=<n>` writes one PNG per step of a slide figure that reveals itself with `tffrom` and `\tfshowfrom` (README, `examples/stepped-reveal.tex`).
4. Read the PNG, compare it against what the figure should say, fix, repeat.
5. Vendor the package into the paper with `./sync.sh <paper-dir>` and commit inside the paper repo, which compiles from its own tree alone.

## Rules that are not obvious

- Colour is an argument to a style (`tfarrowc=tfGreen`, `tfpill={tfPurple}{4cm}`), never hard-coded, and hue names are never brand names, so `palette=tum` retargets a whole paper.
- Align with `\tfrow{x}{node.anchor}` and `\tfcol{node.anchor}{y}`: a fitted card's centre is not where its content looks centred, and an arrow drawn to a guessed coordinate runs downhill.
- Panels and group boxes come last, `fit=` around their content; within one layer the later node covers the earlier, so a box sitting inside a panel is declared after it.
- A style needed by two figures belongs in the package, not copied into the second figure.
- A preview render is never committed; move the PNG to wherever the user reads it (the report page's folder, a shared folder) instead.
  The exception is a PNG that a repo's own build embeds (an HTML page inlining its figures): it is committed next to its source with `OUT=<figures dir>`, because a co-author without tex-fig cannot render it.

## Data charts (matplotlib, pgfplots)

- Colours come from the brand palette, never matplotlib defaults or an ad-hoc set; neighbouring stacked segments take contrasting hues.
  For TUM, `tum-chart-style.py` beside this file is a drop-in matplotlib style: `apply_tum_style()`, the palette constants (`TUM_BLUE`, `TUM_ORDINAL` for ordered categories, `TUM_QUALITATIVE` for unrelated ones), a `label_bars()` helper and a `make_sample()` demo (`uv run --with matplotlib --with pillow python <skill-dir>/tum-chart-style.py`).
- No hatching and no shade splits inside a segment (posted versus planned, actual versus estimate): one solid segment per category, and a distinction that matters becomes its own category or a table row.
- Legend outside the plot area, no title inside the image that repeats the caption.

## Reproducing a figure from a screenshot

Read the image first and name the roles: what is a card, a chip, a panel, an arrow, a caption.
Rebuild it from kit styles rather than tracing pixels, keeping the source's structure and labels but not its colours, which the palette replaces.
Render and compare after every pass; the remaining mismatch is almost always alignment.
