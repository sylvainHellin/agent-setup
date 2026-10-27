---
description: Create a handoff document to transfer work between sessions
argument-hint: "[goal-description]"
---
# Create Handoff

## Context
$@

You are tasked with writing a handoff document to hand off your work to another agent in a new session. You will create a handoff document that is thorough, but also **concise**. The goal is to compact and summarize your context without losing any of the key details of what you're working on.

## Process

### 1. Filename & Date

Use the current date from your session context (the `Current date: YYYY-MM-DD` line) for both the filename and the frontmatter.

Write the file to `.agents/handoff/YYYY-MM-DD_description.md` at the git repo root (`git rev-parse --show-toplevel`; the cwd outside a repo), where `description` is a brief kebab-case summary, e.g. `.agents/handoff/2025-01-08_fix-auth-flow.md`. If a file with that exact name already exists (a second handoff the same day), append `-2`, `-3`, etc.

Create the directory first if needed:

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && mkdir -p .agents/handoff
```

### 2. Write the Handoff

Write the document with the file-writing tool (not a shell heredoc, so backticks and `$` in the body stay literal). Use this structure, filling `date`/`last_updated` with the current date:

```markdown
---
date: [Current date, YYYY-MM-DD]
topic: "[Feature/Task Name]"
last_updated: [Current date, YYYY-MM-DD]
---

# Handoff: {very concise description}

## Task(s)
{Description of the task(s) you were working on, along with the status of each (completed, work in progress, planned/discussed). If you are working on an implementation plan, make sure to call out which phase you are on. Reference the plan document and/or research document(s) you are working from.}

## Critical References
{List any critical specification documents, architectural decisions, or design docs that must be followed. Include only 2-3 most important file paths. Leave blank if none.}

## Recent Changes
{Describe recent changes made to the codebase in `file:line` syntax}

## Learnings
{Describe important things that you learned - e.g. patterns, root causes of bugs, or other important pieces of information someone that is picking up your work after you should know. Consider listing explicit file paths.}

## Artifacts
{An exhaustive list of artifacts you produced or updated as filepaths and/or `file:line` references - e.g. paths to feature documents, implementation plans, etc that should be read in order to resume your work.}

## Action Items & Next Steps
{A list of action items and next steps for the next agent to accomplish based on your tasks and their statuses}

## Other Notes
{Other notes, references, or useful information - e.g. where relevant sections of the codebase are, where relevant documents are, or other important things you learned that you want to pass on but that don't fall into the above categories}
```

### 3. Confirm

After the file is written, confirm to the user with the real path:

```
Handoff document created at: `.agents/handoff/YYYY-MM-DD_description.md`

To resume this work later, use:
/resume-handoff .agents/handoff/YYYY-MM-DD_description.md
```

## Additional Notes & Instructions

- More information, not less. This defines the minimum of what a handoff should be. Always feel free to include more information if necessary.
- Be thorough and precise. Include both top-level objectives and lower-level details as necessary.
- Avoid excessive code snippets. While a brief snippet to describe some key change is important, avoid large code blocks or diffs. Prefer using `path/to/file.ext:line` references that an agent can follow later, e.g. `src/app/dashboard/page.tsx:12-24`
- Reference existing artifacts. Always mention relevant plans or research documents
