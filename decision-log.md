# Decision log

## 2026-10-27 - Share the agent setup through a new public repo instead of opening the dotfiles

Why: the private dotfiles carry employer, tax and family procedures in their skills and secrets in their history, so a fresh repo without history is safer than a cleanup of the old one.
Rejected: making `sylvainHellin/dotfiles` public after a secret rotation and a history rewrite.
Source: chat with Sylvain, 2026-10-27.
Status: accepted

## 2026-10-27 - Scope: pi extensions first, then generic skills, the tool list and the HTML report template

Why: the extensions are the most reusable part for colleagues on the same harness; skills, AGENTS.md and the tool list are shared as generic versions to adapt.
Rejected: a plain copy of the private skills.
Source: chat with Sylvain, 2026-10-27.
Status: accepted

## 2026-10-27 - The HTML report template ships with a TUM theme next to the default one

Why: most readers of the repo are at TUM and want reports in the TUM look.
Rejected: a separate repo for the template.
Source: chat with Sylvain, 2026-10-27.
Status: accepted

## 2026-11-04 - A tutor skill for students: lesson page in the report template, tex-fig figures rendered with an online fallback

Why: the 5 November guest lecture lets students learn a topic they never quite understood through a lesson page with figures and recall questions, and the comment round trip of the report template is what turns the page into a dialogue.
The skill carries copies of the template assets and of `texfig.sty`, so a student copies one folder; `render_fig.py` compiles with a local `tectonic` or `pdflatex` and otherwise with latex.ytotech.com, then converts the PDF to SVG with PyMuPDF.
Rejected: a minimal template with folded answers (no round trip), inline SVG or Mermaid figures (weaker look), a separate course repo (splits the material).
Source: lecture plan report comments, 2026-11-03 and 2026-11-04.
Status: accepted
