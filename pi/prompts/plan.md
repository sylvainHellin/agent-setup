---
description: Plan and document decisions for a task (read-only), then hand it over for review
argument-hint: "<task description>"
---
Task: $@

Plan and document the approach for this task. This is read-only exploration plus
plan authoring: do NOT edit the codebase or run git writes. Implementing is a
separate, explicit step I will ask for later, if at all.

Explore the codebase to understand what is relevant.
- Find the files, patterns, and conventions that matter.
- Understand the architecture around the area in question.
- If a question can be answered by exploring the codebase, explore instead of asking.

Gather everything the repo, the notes, the working folder and the web can tell you
before asking anything. Then ask only what the AGENTS.md rule on questions leaves to
me: knowledge only I hold, a trade-off the evidence does not settle, an action others
see or that cannot be undone, or context that is stale or contradictory. Each question
carries its options, their trade-off and your recommendation; ask them together, a
handful at most, and settle everything else yourself. Open the plan with the sources
you relied on and the assumptions you made, one line each, so I can spot a gap.

The `web` CLI (`web search`, `web fetch`, `web answer`) handles direct lookups:
single-page docs, API references, quick fact-checks. The `Agent` tool is
available for genuinely heavy multi-source research (`subagent_type: researcher`); do not
dispatch an agent for what a single `web search` answers.

Once aligned (or if the task is straightforward), deliver the plan. If it is short,
answer directly in the response. If it is long, or I will want to comment on it, build
it as an HTML report page (`agent-pages` skill): `agent-pages new <dir>/<YYYY-MM-DD>_plan-<slug>.html`
in the folder where the repo keeps what I review (AGENTS.md), or any path I name,
write the plan into the page with the questions as question cards, run
`agent-pages open` and tell me the path. The plan should be tight (no
filler, repetition, or verbose explanation): a short overview of the architecture (what
changes, where, and why), plus system design, interfaces, and the architectural
decisions taken. No need to go deep into implementation details.

Then STOP and wait. I comment in the page when I am ready and paste the export back.

When review comments come back, do NOT rewrite the whole plan: use the `edit` tool
to change only the affected parts of the page, remove the answered question cards,
then tell me it is updated.

When the plan is approved, STOP. Do not start implementing unless I explicitly ask
you to.
