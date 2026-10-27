---
name: writing
description: "Must load before drafting or editing any text a person reads (chat replies, notes, emails, letters, posts, slides, reports, READMEs, abstracts, rebuttals) and when reviewing text for style or AI tells."
---
# Writing guidelines

This skill teaches you how to write properly.

## Common AI tells to avoid

Each of these is mechanical and avoidable.

- Em-dash in a title. Wrong: `Journal Paper 2 — The Goal`. Right: `Goal of the 2nd journal paper`
- Two-beat tagline after a colon, in any title, subject line, heading or headline. Wrong: `Survey results: real numbers, finally in production`. Right: `Survey results: the numbers are in the dashboard`. The line states the content; the punchy second beat is the tell (German subtitles: `german-copy.md`). The comma version in a kicker or label is the same tell: `The morning, in German` -> drop the label or state it plainly.
- Meta-comment in a parenthetical. Wrong: `Paper boundary (headline)`. Right: `Paper boundary`. The bracket narrates the layout instead of being the content; delete it.
- Bold label glued to prose. Wrong: `**Summary:** we found three gaps.`. Right: `Three gaps were found` (use a real heading if a section marker is needed).
- Announcing a distinction instead of stating it. Wrong: `A and B answer two different questions. A returns addresses; B returns messages.` Right: `A returns addresses; B returns messages.` The first sentence tells the reader a difference is coming instead of being the difference; same tell as the meta-comment above, outside a parenthetical. A colon-fronted framing clause is the dressed-up version of it: `One point we could not ignore while reading: the papers were AI-generated` -> `The papers were AI-generated`. Length does not make it a different tell.
- Empty negated foil. Wrong: `separate tracks, so attribution is structural, not guessed`. Right: `separate tracks make attribution structural`. Delete a foil that only restates the positive as a negation. Keep one that names a concrete alternative the reader would otherwise assume: `the current state of the art, instead of listing the whole history of the topic` earns its place, because students really do write the history. Never contort a sentence into two to dodge this rule.
- Defining by negation. Wrong: `It is not an ontology for extraction`, or a list of what a paper does not claim. Right: state what the thing is and what it claims; limits go in the limitations section, not in the purpose or positioning.
- Marketing staccato. Wrong: `Faster. Cleaner. Done.` or a closing punchline like `Nothing else.`. Right: plain sentences in the register of the artifact.
- Verbless fronted opening. Wrong: `Venue is the main auditorium. Planned are 25 minutes. Requested is an overview.` Right: `The event takes place in the main auditorium. The slot lasts 25 minutes.` The nominal lead drops the agent and turns prose telegraphic; two in a row already reads as machine.
- Fact packing. Wrong: one sentence carrying the venue, the slot length and the audience profile through a colon and an appositive tail. Right: one fact per sentence, and cut the facts the reader can infer.
- Over-explanation. Wrong: justifying a deadline (`so that I can publish the programme`), naming a constraint twice, profiling a reader who knows the context. Right: state the ask alone; a softener (`I only need the slides three days before`) beats a tightener (`at the latest`).
- Content the reader already has. Give the headline number and let the attachment, table or figure carry the breakdown. Cut your own tooling trail with it: the column you computed, the file you edited, the administrative step you take next. None of it changes the decision you are asking for.
- Uniform paragraph rhythm. Four paragraphs of two sentences at near-equal length is a machine signature. Vary the block length and let a short question stand on its own line.

## Closing reply in a chat session

The user often reads only the latest reply of a session, and judges the work by it.
So it stands alone, and it stays lean: they ask a follow-up when they want the detail.

Sections, in this order, only the ones that carry content: `## Answer`, `## Commits`, `## Implementation summary`, `## Notes`, `## Questions`.
Tests run, files deleted and paths touched belong inside the implementation summary, not in sections of their own.
More than two questions, a figure, a table or a concept to explain go into an HTML report page instead (`documents` skill), and the reply names its path.
Questions asked in such a page live only there; the chat reply says how many wait in the page instead of repeating them.
One line per item, and one sentence per line: semantic line breaks apply to chat replies too, not only to `.md` files.
State the conclusion and the path; drop the reasoning, the verification narrative, and anything the commit message already carries.
Text the user will copy out (a message, an email body, a snippet) goes in a plain fenced code block, never in `> ` blockquotes, which do not copy cleanly from a terminal.

Wrong:

> Done. The repo is clean apart from `settings.json`, which is permanently "modified" because the clean filter strips its machine-local keys; nothing to commit there, ever.

Right:

> Done: the repo is clean.
> Reminder: `settings.json` is always "modified" because we strip the machine-local keys before committing.

The wrong version fails twice: one convoluted sentence carrying three facts at once, and a closing flourish (`nothing to commit there, ever`) that carries none.
Same tell, other form: narrating your own diligence (`I verified why rather than assuming`).
Delete the narration and keep the finding, and keep the finding only when the user needs it.

## Review with fresh eyes after editing

After a draft exists, do not self-review it in the same context that wrote it; dispatch a fresh reviewer agent and name this skill in the dispatch so it loads the checklist below.
Point the reviewer at the artifact file(s).
It reports, per violation: `file:line`, the exact offending text, the rule, and a severity.

### Checklist for the review

#### Mechanical checks

Using `rg`:

| Rule | Command (`rg -n ... <file>`) |
|---|---|
| No em/en dash | `rg -n '[—–]' <file>` |
| No `--` as a dash | `rg -n ' -- ' <file>` |
| No `**Label:**` in prose | `rg -n '\*\*[^*]+:\*\*' <file>` |
| No emoji | `rg -n '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2190}-\x{21FF}\x{2B00}-\x{2BFF}]' <file>` |
| Meta-comment parenthetical | `rg -n '\((headline|title|subtitle|caption|placeholder|draft|note|TODO)\)' <file>` |
| Contrast-scaffold aid (read the hit; many `, not ` are legitimate) | `rg -n ', not ' <file>` |
| Slop vocabulary (read the hit; some fit in context) | `rg -ni '\b(delve\|leverage\|utilize\|showcase\|underscore\|pivotal\|testament\|garner\|foster(ing)?\|intricate\|robust\|boasts\|serves as\|stands as)\b' <file>` |

#### Judgment checks

Read the text and use your own judgment.

- Register matches the artifact: formal academic for co-author-facing prose, plain third person for notes and reports. German reader-facing text stays impersonal (no "Du"), with no Denglisch or calques (`german-copy.md`).
- Not first person as the user unless they commissioned a draft in their name (an email or letter they send); notes, reports, and summaries stay neutral third person.
- Purpose before mechanics: state what a thing is for before how to use it.
- An asset carries only what must persist; anything the presenter says out loud is not on the slide or board.
- Reader-facing elements (titles, subtitles, captions, headers) carry no presenter-thinking or direct audience address; that voice belongs in the speaker notes. Wrong as a subtitle: `Where your steer would help most`. Right: drop it or state the topic (`Open decisions`); the addressed-to-you version goes to the speaker notes.
- Semantic line breaks: one sentence per line, never column-wrapped or split mid-sentence, in `.md` prose, chat replies and email bodies alike.
  A line running well past a full sentence without a break is a smell to inspect.
- Ends on the last substantive item. A closing offer the reader could make themselves (`Happy to go through this in the next meeting.`) is a flourish; delete it. Holds for emails and notes, not only for chat replies.
- Concise for the format: longer answers go to a report page rather than long chat replies, and claims carry sources.
- Cut filler and hedging, prefer active voice: `in order to` -> `to`, `due to the fact that` -> `because`, delete `it is important to note that`; name the actor instead of the passive; drop an adverb propping up a weak verb or replace it with the number.
- Prefer the concrete word over an abstract metaphor noun (`substrate` -> base, `surface` -> the API, `wedge in` -> add), and name the mechanism or a number rather than a feeling: say what a thing does, not how it reads.
- Cold read: reread every edit as a stranger with no memory of the prior version; delete any sentence that only reacts to how it was previously worded.
- No wide tables in a Markdown document meant for review in a terminal editor: use per-item headings or bullet lists instead.
