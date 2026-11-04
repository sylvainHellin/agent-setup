<!-- Vendored from https://github.com/sylvainHellin/tex-fig (MIT). The examples/ it names live in that repo; inside the tutor skill, render with render_fig.py instead of build.sh. -->
# texfig

A LaTeX package for the figures in Sylvain's papers and slide decks, so every diagram in every publication shares one look instead of being redrawn in whatever tool was open.
The look comes from the ByteDance Falcon paper: Apple system colours, white cards with rounded corners, pill labels, thin `Latex` arrowheads, light grey panels behind a group of related nodes.
Everything is TikZ code, so a figure is versioned, diffable, searchable and typeset in the document's own fonts, and no PNG or SVG render is ever committed.

## The recipe

Author the picture on a comfortable coordinate canvas, in centimetres, without worrying about the column width.
Wrap it in `\resizebox{\tffigwidth}{!}{...}`, which scales the finished picture to whatever width the including document gives it.
Place the background panels and the group boxes last, fitted around the nodes they contain with `fit=`, so their size follows the content rather than being guessed.
Nodes that a panel must sit behind go on the `background` layer, and the panel itself on the `grouping` layer below it.

## Minimal working example

```latex
\documentclass[border=8pt]{standalone}
\usepackage{texfig}
\renewcommand{\tffigwidth}{12cm}
\begin{document}
\resizebox{\tffigwidth}{!}{%
\begin{tikzpicture}
  \node[tfcardtitlec=tfBlue] (t) at (0,2) {A card};
  \node[tffield] (f) at (0,1.5) {one field line};
  \begin{scope}[on background layer]
    \node[tfcard, fit=(t)(f)] (card) {};
  \end{scope}
  \node[tfpill={tfOrange}{3cm}] (p) at (7,1.75) {a value\\[1pt]{\tiny its type}};
  \draw[tfarrowc=tfOrange] (card.east) -- (p.west)
    node[tfedgelabelc=tfOrange, pos=0.5] {relates to};
\end{tikzpicture}}
\end{document}
```

## Options

```latex
\usepackage[palette=tum, font=times]{texfig}
```

`palette` picks the brand the hues come from: `apple` (the default), `tum` or `hines`.
Figures name colours by hue and never by brand, so the same source renders in any of them; a hue a brand does not have borrows its nearest one, which the palette block of `texfig.sty` records colour by colour.
`font` exists for standalone previews, where no document class sets a face and a render would otherwise come out in Computer Modern: it takes `inherit` (the default), `times`, `helvet`, `palatino` or `libertine`, the same names the TUM article class uses.
Under XeTeX or LuaTeX, which is what tectonic runs, `helvet` loads TeX Gyre Heros through fontspec, since the Type 1 Helvetica of the `helvet` package does not exist in the TU encoding; pdfLaTeX keeps the `helvet` package.
Inside a real document, leave `font` alone and let the class decide.

## Choosing a colour

The palette defines `tfBlue`, `tfGreen`, `tfOrange`, `tfPurple`, `tfRed`, `tfPink`, `tfTeal`, `tfGray`, `tfDarkGray` and `tfDark`, each with a near-white `tfLight...` tint.
Every style that carries a colour takes it as an argument rather than existing once per colour: `tfcardc=tfGreen`, `tfpill={tfPurple}{4.7cm}`, `tfarrowc=tfBlue`, `tfgroup={tfRed}{Title}`.
Text on an accent colour is darkened to `#1!62!black` so it stays legible against the 10 percent fill.
Pick colours by role and keep the mapping constant across the figures of one paper.

## Styles

- `tfpanel`, `tfpanelc={colour}`: solid panel behind one column of a picture, grey or tinted.
- `tfgroup={colour}{title}`: dashed coloured box with its title above the frame.
- `tfcard`, `tfcardc={colour}`: white or tinted card, used with `fit=` around its content.
- `tfcardtitle`, `tfcardtitlec={colour}`, `tfcardsubtitle`: the header of a card and its one-line gloss.
- `tffield`: a monospaced property or value line inside a card.
- `tfprose`: running text inside a card, for an example rather than a property; give it a `text width`.
- `tfpill={colour}{width}`, `tfpilltype`: a value label and the smaller type line under it.
- `tfblock={colour}{width}`: a heavier box for a processing step.
- `tfchip={colour}{size}`, `tfdot={colour}`: a square and a round chip of a fixed size, for a state or a token in a chain.
- `tfop`: a small circle carrying an operator symbol on a path.
- `tfghost`: a dashed outline with no fill, for something produced rather than held.
- `tfformula`, `tfnote={colour}`: a white card for a displayed equation, and the coloured callout that states what it costs.
- `tftitle`: the title of a figure section, set above the panel it names.
- `tfcaption`: grey gloss set underneath a panel.
- `tflabel`, `tflabelc={colour}`: free-standing label in the document tone, for something named but not boxed.
- `tftag={colour}`: small solid chip, for labelling a panel from inside it.
- `tficon={colour}`, `tfglyph={colour}`, `tfrule={colour}`: a tinted canvas for a small icon, and the outlined shapes and rules drawn inside it.
- `tfarrow`, `tfarrowc={colour}`, `tfarrowdashed`, `tfarrowdashedc={colour}`: arrows.
- `tfelbow`: adds the corner radius an orthogonal route needs, used with the `-|` and `|-` path operators.
- `tfedgelabel`, `tfedgelabelc={colour}`: a label riding on an arrow, with a white fill so it stays legible where it crosses an edge.
- `\tfrow{<x>}{<node.anchor>}`, `\tfcol{<node.anchor>}{<y>}`: place a node on the line of another one, so the arrow between them is horizontal or vertical by construction. Declare the node you align to first; a fitted group counts.
- `\tflit{...}`: a literal value inside a field line.
- `\tfcutmark[colour]{(x,y)}`: the two slashes that cut an arrow where a gradient is stopped.
- `\tffigwidth`: the target width, defaulting to `\linewidth`.

Traps that cost a render:

- `tfpilltype` is a style, so it goes in the node options; `\tfpilltype` as a command does not compile.
- The `x` of `\tfrow` and the `y` of `\tfcol` are numbers; an anchor there fails with an opaque PGF Math error.
- A literal coordinate inside `fit=` needs braces, `fit={(a)(5.6,5.2)}`, or its comma breaks key parsing.
- A local style must not shadow a TikZ key: a style named `join` breaks the build.
- `\resizebox` scales the whole picture to the target width, so a canvas wider than about 4:1 shrinks its text below legibility; fold a long chain into two rows instead of setting labels `\tiny`.

## Examples

`examples/ocdi-concept.tex` is the OCDI core-concept figure: cards, pills, panels, and arrows aligned so that the ones that can be horizontal are.
`examples/codeact-loop.tex` is the CodeAct agent loop of the first journal paper, redrawn: dashed group boxes, tinted cards, blocks and orthogonal routing.
`examples/jina-architecture.tex` reproduces figure 1 of arXiv 2609.03181: icons, curved arrows, a tagged panel and a chain of small blocks.
`examples/jina-benchmarks.tex` reproduces its figure 2, and is the one plotted figure: two bar panels and two scatter plots.

`examples/fixed-point-forcing.tex` shows how to fade what a second panel repeats: put the repeated nodes in a `transparency group` scope with an `opacity`, which keeps overlapping strokes from showing through each other.
`examples/linattn-{recurrent,parallel,chunkwise}.tex` are three views of the same operator, and the widest exercise of the kit: chips, chained states, dashed outputs, tall matrix operands with a clipped mask, formula cards and cost callouts.

Build any of them with `examples/build.sh`, which generates the `standalone` wrapper in a scratch directory and leaves a PNG in `~/Documents/tmp`:

```sh
examples/build.sh linattn-parallel      # one figure
examples/build.sh all 200               # all of them, at 200 dpi
OUT=figures examples/build.sh figures/f1.tex   # write the PNG next to its source
```

## Plots

A figure that carries measured numbers loads `texfig-plots` instead of `texfig`; the plot package requires the node package, so everything above stays available.
It adds pgfplots and keeps the same split: the package holds the look of an axis, the document holds the data.

- `tfaxis`: the shared look, a frame-free axis with thin grey rules and light grid lines.
- `tfbaraxis`: horizontal bars against a category axis that carries names rather than a scale. Give the categories with `symbolic y coords` and repeat them in `ytick`, since `ytick=data` only picks up what the first series plots, and print a value at the end of each bar by passing it as `[explicit symbolic]` meta.
- `tfplotaxis`: a value plot, both axes drawn, grid on the measured axis.
- `tfbar={colour}`: one bar series. Plot the highlighted category as a second series so it is drawn over the grey one.
- `tfpoint={colour}`, `tfstar={colour}`: a plain scatter mark and the open five-pointed star for the series the figure argues about.
- `tfline={colour}`, `tftrend`: a line through the points that form the frontier, and the dashed grey trend behind them.
- `tfpointlabel`, `tfpointlabelc={colour}`: the name of a point, set beside it with `at (axis cs:x,y)`.
- `tfpanelletter`: the (a), (b), (c) of a multi-panel figure.

Place several panels by giving each `axis` an explicit `at={(<x>cm,<y>cm)}, anchor=south west` and `scale only axis`, which `tfaxis` sets, so `width` and `height` measure the plot body and the panels line up whatever their labels do.

## Using it in a paper

An Overleaf project compiles from its own tree alone, so the package has to be vendored into it:

```sh
./sync.sh ~/code/tum/ocdi/paper
```

The copy carries the commit it came from in its second line, which makes a stale one visible in a diff, and the script refuses to run from a dirty tree so that stamp cannot lie.
`texfig-plots.sty` follows only into a target that already had it.
In the document, load it with `\usepackage{texfig}` and input a figure inside `figure` or `figure*`.
