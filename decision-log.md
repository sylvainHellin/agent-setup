# Decision log

## 2026-10-27 - Share the agent setup through a new public repo instead of opening the dotfiles

Why: the private dotfiles carry employer, tax and family procedures in their skills and secrets in their history, so a fresh repo without history is safer than a cleanup of the old one.
Rejected: making `sylvainHellin/dotfiles` public after a secret rotation and a history rewrite.
Source: chat with Sylvain, 2026-10-27.
Status: accepted

## 2026-10-27 - Scope: pi extensions first, then generic skills and the tool list

Why: the extensions are the most reusable part for colleagues on the same harness; skills, AGENTS.md and the tool list are shared as generic versions to adapt.
The HTML report template and the tutor skill come from the agent-pages repo (entry below).
Rejected: a plain copy of the private skills.
Source: chat with Sylvain, 2026-10-27.
Status: accepted

## 2026-11-04 - A tutor skill for students: lesson page with figures, recall questions and the comment round trip

Why: the 5 November guest lecture lets students learn a topic they never quite understood through a lesson page with figures and recall questions, and the comment round trip of the report template is what turns the page into a dialogue.
The skill now lives in agent-pages (entry below); its figures come from matplotlib by default, or from tex-fig with a local `tectonic`.
Rejected: a minimal template with folded answers (no round trip), inline SVG or Mermaid figures (weaker look), a separate course repo (splits the material).
Source: lecture plan report comments, 2026-11-03 and 2026-11-04.
Status: accepted

## 2026-11-18 - Report pages and lessons come from the public agent-pages repo, which this repo points to instead of carrying copies

Why: agent-pages (github.com/sylvainHellin/agent-pages, MIT) is public since 2026-11-12 and holds the maintained template, its TUM theme, the `agent-pages` CLI and the `agent-pages` and `tutor` skills, so two copies would drift.
This repo kept its own `report-html/` template and `pi/skills/tutor/` only while agent-pages was private.
The TUM theme stays available, since most readers of the repo are at TUM.
Rejected: keeping the copies next to the pointer.
Source: chat with Sylvain, 2026-10-27 (TUM theme) and 2026-11-18.
Status: accepted

## 2026-11-26 - Refresh from the private setup: port the generic changes, add four extensions, drop the CDP browser and the herdr TUI bridges

Why: the copy had drifted a month behind the private setup (about 195 commits), and it is now linked to colleagues as the blueprint.
Added: `agent-pages-inbox/` (pairs with the public agent-pages), `narrow/`, `subagents-busy.ts`, `worktrunk.ts`; removed: `browser-execute/` and `web/cdp.md` (superseded by BrowserOS), `herdr-blocked-bridge.ts`, `shared/herdr-bus.ts` and `plan/nvim/` (the Herdr app reports status natively, annotate reviews in a TUI overlay).
Rejected: the private-only extensions (Claude Max provider, plan limits, header, session move between machines, code-sync, mail drafts, AGENTS.md dedupe), the `recall` and `inbox` prompts (they depend on private tools and vault routines), and the private-only skills (machines, runbooks, email, briefing, calendar, digest, minutes).
Source: chat with Sylvain, 2026-11-26.
Status: accepted
