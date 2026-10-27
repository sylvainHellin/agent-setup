---
description: End-of-session wrap-up; clean up, bring the project docs and the task tracker to the current state, capture knowledge, write a handoff
argument-hint: "[notes]"
---
Let's finish up for today.
Before we close this session, clean up after yourself, bring every document that describes the project up to its current state, capture what is worth keeping, and write a handoff so the work resumes next time without losing anything.

## Notes
$@

## 1. Clean up

- Stop the multiplexer tabs, dev servers and watchers this session started, unless they are meant to keep running; name the ones you leave up.
- Remove git worktrees and branches created during this session once their work is merged or abandoned.
- Leave `/tmp` alone.

## 2. Bring the state documents up to date

Cover every file that documents the state of the project: the vault project note (`knowledge` skill), the task tracker (`productivity/tasks` skill for Plane), READMEs, plans, the repo's `AGENTS.md`, and any other file the repo uses to record its state.
In the task tracker, close what is done, update what moved, and create a task for each follow-up this session surfaced.
Documents carry the current state only: rewrite stale passages in place instead of appending a history, since git keeps it.
Fixing a stale fact in an instruction file belongs here; adding a new instruction goes through step 3.

## 3. Capture knowledge

Facts learned about people, organisations, projects, papers or tools go to the vault through the `knowledge` skill, checking for an existing note first.

Then look back over the session for anything that deserves to become durable instruction, so I have to give you less guidance next time.
Each candidate needs a concrete moment of this session as evidence:

- a correction I had to make more than once
- a gotcha found the hard way, where the first attempt failed for a non-obvious reason
- a tool, API or command whose real contract differed from its documentation
- a convention that was implicit and that this session made explicit
- a task where you spent significant time working out how to use the tools or where the information lives

A defect, missing option or misleading output in a tool I maintain myself (`<list your own CLIs here>`) is not an instruction candidate: fix the tool instead of documenting a workaround.
First rule out a stale install by comparing the binary against the repo's latest commit, and reinstall if it lags.
Only a trivial fix (a typo, a one-line help text) is made directly in the tool's repo, tested, committed and reinstalled, since other work is often in progress there.
Every other defect is raised in the report with its evidence and a proposed fix, and I decide between fixing it now and a task.
Documenting a workaround is only for tools I do not control.

Rejection is the normal outcome, since every added line costs context on every future turn.
Drop a candidate when it is a fact the model already knows, a one-off unlikely to recur, too vague to act on, already covered by an existing surface, or a property of the system that a pointer to the code, a `--help` or a vault note covers better than a copy.
For a candidate that survives, load the `agents/authoring` skill and apply its tests before proposing it.

Place each survivor:

| Target | When |
|---|---|
| The global `AGENTS.md` (`~/.pi/agent/AGENTS.md`) | True for every task, on every machine |
| The vault's or the project's own `AGENTS.md` | True only inside that vault or repo |
| An existing skill in your skills directory | Gates on an artifact or task that skill already covers; variant detail goes in a sibling file, not `SKILL.md` |
| A new skill | A recurring workflow with clear triggers, broad enough to grow |
| Nothing | The default |

Propose only: never edit an instruction surface in this command, even when the change looks obvious.
Finding nothing worth capturing is a good result.

## 4. Write the handoff

Take the current date from the `Current date: YYYY-MM-DD` line of your session context.
Write the file to `.agents/handoff/YYYY-MM-DD_description.md` in the working directory, with `description` a short kebab-case summary (`mkdir -p .agents/handoff` first); append `-2`, `-3` if that name already exists.
Use the file-writing tool, not a shell heredoc, so backticks and `$` stay literal.

```markdown
---
date: YYYY-MM-DD
topic: "[Feature/Task Name]"
last_updated: YYYY-MM-DD
---

# Handoff: {very concise description}

## Task(s)
{Each task with its status: completed, in progress, planned. Name the plan phase and the plan or research document if there is one.}

## Critical References
{The 2-3 specs, design docs or decisions that must be followed. Blank if none.}

## Recent Changes
{Changes made this session, as `file:line` references.}

## Decisions
{Each decision with the reason behind it.}

## Learnings
{Patterns, root causes and the pitfalls encountered, with file paths.}

## Open Questions
{What is still undecided or unknown, and who can answer it.}

## Artifacts
{Every file produced or updated, including the project note and tasks from step 2.}

## Action Items & Next Steps
{What the next session does first, in order.}

## Other Notes
{Anything else the next session needs: where relevant code or documents live.}
```

Point to the project note, tasks and files updated in step 2 instead of repeating their content.
Prefer `path/to/file.ext:line` references over code blocks or diffs.
Be concise but complete.

## 5. Commit and report

Commit and push each verified change of this session, in every repo and in the vault; name anything left uncommitted and why.

Close with the reply format of the `writing` skill, and include:

- the handoff path and the `/resume-handoff <path>` line
- the tasks closed, updated or created
- the processes left running
- the trivial tool fixes made in step 3, one line each, and each other tool defect with its evidence and proposed fix, awaiting the choice between fixing now and a task
- each instruction candidate from step 3 with its evidence in one line, the exact target file path, the exact text to insert with enough surrounding context to place it, one line on why that surface and not the next one up, and anything it replaces; then stop and wait for approval
