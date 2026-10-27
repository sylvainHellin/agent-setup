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

Interview me relentlessly about every aspect of this plan until we reach a shared
understanding. Walk down each branch of the design tree, resolving dependencies
between decisions one by one. For each question, provide your recommended answer.
Ask the questions one at a time.

The `web` CLI (`web search`, `web fetch`, `web answer`) handles direct lookups:
single-page docs, API references, quick fact-checks. The `Agent` tool is
available for genuinely heavy multi-source research (`subagent_type: researcher`); do not
dispatch an agent for what a single `web search` answers.

Once aligned (or if the task is straightforward), deliver the plan. If it is short,
answer directly in the response. If it is long, or I will want to comment on it line
by line, author it as a markdown file at `.agents/plans/plan-<slug>.md` (or any
path I name) using the `write` tool and tell me the path. The plan should be tight (no
filler, repetition, or verbose explanation): a short overview of the architecture (what
changes, where, and why), plus system design, interfaces, and the architectural
decisions taken. No need to go deep into implementation details.

Then STOP and wait. I review when I am ready, in my editor; do not open a review
surface yourself.

When review comments come back, do NOT rewrite the whole plan: use the `edit` tool
to change only the affected lines, then tell me it is updated.

When the plan is approved, STOP. Do not start implementing unless I explicitly ask
you to.
