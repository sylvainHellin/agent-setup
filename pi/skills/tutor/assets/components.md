# Lesson page components

The lesson page is the HTML report template from `report-html` in the agent-setup repo (https://github.com/sylvainHellin/agent-setup); this is its component list.
The stylesheets and the script in `assets/` are copies of that folder's `report.css`, `theme-tum.css` and `report.js`.

## Page conventions

- Start with `p.eyebrow` (topic and "Lesson"), one `h1` that states what the reader will understand, `p.lede`, and `p.meta` holding `<span>` items such as the date and the sources.
- Use `h2` for sections and `h3` for subsections; the outline is built from them.
  Headings inside callouts, cards, figures, key-figure cards, question cards and `details` stay out of the outline, as does any heading with class `bn-notoc`.
- Write plain `<table>` markup.
  A first row of `<th>` becomes a sticky header, rows are zebra-striped, and a table too wide for the column scrolls sideways inside a frame.
  Use `td.num` for right-aligned figures and `td.nowrap` for identifiers.
- Write code blocks as `<pre data-lang="bash"><code>...</code></pre>`; `data-lang` is optional.
- Use `.grid-2` or `.grid-3` for side-by-side columns, `.card` for a plain panel, `dl.fields` for label and value pairs, `details` for collapsible material, `blockquote` with a trailing `span.src` for quoted sources, and `p.src` for a source line under a block.

## Components

- Callouts: `<div class="callout note|warning|decision|success">` with an optional `<p class="callout-title">`.
  `warning` covers deadlines and risks, `decision` covers what the reader has to decide, `note` covers context and caveats, and `success` covers what is done.
  A `decision` callout holding an `<ol>` lists several decisions, each with its recommendation.
- Badges: `<span class="badge ok|info|warn|danger|neutral|accent">label</span>`; add `plain` to drop the dot.
  Use `ok` for done, `info` for in progress or with the agent, `warn` for waiting or at risk, `danger` for blocked or overdue, `neutral` for parked or later, and `accent` for anything that needs the reader.
- Key figures: a `div.kpis` holding `div.kpi` cards, each with `span.kpi-label`, `span.kpi-value` and an optional `span.kpi-note` or `span.kpi-delta up|down`.
  `.kpi.accent` sets one value in the accent colour, for the single figure that needs attention.
- Figures: `<figure class="fig">` around an `<img>` (a `data:` URI keeps the page portable) or an inline `<svg>` with a `viewBox`, plus a `<figcaption>`.
  Figures are numbered automatically and enlarge on click; `fig bare` drops the frame.
  Inline SVG can use the page tokens, for example `fill="currentColor"`, `fill="var(--surface)"` or `stroke="var(--ocean)"`, so it follows the theme and the dark mode.

### Question cards

A question card asks the reader something the agent needs decided; the answer travels with the export.

```html
<div class="question" data-id="queue-choice" data-type="single">
<p class="q-text">Which queue should the import service use?</p>
<ul>
  <li data-value="postgres">Postgres queue table (recommended)</li>
  <li data-value="rq">RQ with Redis</li>
</ul>
</div>
```

`data-type` is `single` (radio buttons), `multi` (checkboxes) or `text` (a free-text box, no list).
`data-id` is the stable key the export reports, and `data-value` on an option is optional.
Choice questions also get an optional note field.
