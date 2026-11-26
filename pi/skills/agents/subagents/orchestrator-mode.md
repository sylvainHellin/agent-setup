# Orchestrator mode

Orchestration runs the main session as a dispatcher: subagents gather information, implement work units and verify results, and the main session touches no files beyond a one-line edit that would cost more to dispatch.

## Core principle

Reading a large file, running `rg` across the repo, fetching web docs or editing anything during an orchestration session burns the context window that has to stay clean to hold a faithful overview of the whole task.

The main session's context holds the plan, the running status of each work unit, and the open risks.
File contents, diffs, search results and web pages stay in the subagents and come back as a summary.

## The loop

1. Break the task into work units, riskiest first.
   A unit is small enough that one subagent can carry it out and report back concisely: implement a change, run a search, rephrase a section, write a test, gather docs.
   Each implementing unit names at most three acceptance criteria, the exact command or read that proves them, and the files it likely touches.
   A unit whose title needs an "and", that needs more criteria or that spans two subsystems is two units.
2. Settle the plan.
   Run the doubt pass first when its triggers (below) hold.
   When any unit cannot be undone (a migration, a deletion, a deploy, a publish or send, a public API change) or the user asked to review the plan first, post it and stop until the user gives an explicit go; a hedged reply is not one, and a go covers the plan it answered, not units added later.
   Any other plan is posted in one message and executed.
3. Dispatch the next unit.
   Pick the agent (`worker` to implement, `scout` or `researcher` to gather, `reviewer` to check) and give it a contract: the goal, what is in and out of scope, the acceptance criteria with their command, what to report.
   Point at the plan, research notes and files by path instead of paraphrasing them, since a paraphrase drops the details the child needs.
   A bug fix runs as two dispatches: a worker writes a test that reproduces the bug without being asked for the fix, a run shows it failing, then a second worker fixes it, verified by that test and the full suite; the test is committed with the fix, never red on its own.
4. Collect a short status: what was done, what was not, risks and surprises.
   Keep the summary, never the raw output.
5. Verify with fresh eyes (`SKILL.md`, "Check with fresh eyes") every unit that changed files.
6. Accept the unit: commit only its paths and push.
   Check `git status` and note the starting `HEAD` before the first worker, so changes that were already there are never staged with the work and the task's whole diff is `<start>..HEAD`.
   Every two or three units, have the full test suite run, not only the unit's own command.
7. Loop or escalate.
   Blockers get an agent dispatched to fix them; a scope or product decision goes back to the user.

Keep writes single-threaded: one writing agent at a time per worktree.
Parallel writers each get their own worktree (`SKILL.md`, Mechanics); reading, review and validation parallelize freely.

## Doubt pass

A plan or a decision that crosses a module or service boundary, asserts a property no test checks (idempotence, ordering, concurrency) or cannot be undone gets an adversarial review before it stands.
Dispatch the reviewer (as a pair when two model families are configured, `SKILL.md`, "Check with fresh eyes"), told to find what is wrong, and give it the plan verbatim or the artifact by path plus its contract, never the reasoning that produced it.
A plan has no code path yet, so the prompt replaces the review skill's reachability gate with the plan line and a concrete failure scenario.
Sort each finding: a misread of the contract (fix the contract, then rerun), actionable (fix it), an accepted trade-off (named in the final report), or noise (drop it).
Stop after three rounds, or after two rounds whose findings were all real yet none actionable, and take what is left to the user.

## Definition of done

The task is done when all of these hold, and the final report lists any that do not as open:

- every unit's acceptance criteria met, each with the command that proved it and its outcome
- the repo's checks green on the final tree, not only per unit
- the bar guard (`code/review/SKILL.md`) clean on `<start>..HEAD`
- the fresh-eyes review passed for every unit that changed files
- prose a person reads through the `writing` skill's fresh reviewer
- the docs the repo requires updated in the same commits (README inventory, `decision-log.md`)
- each unit committed and pushed, with nothing unrelated staged

## Rhythm

Blocking is the default, because the loop is a conversation: dispatch a unit, read the summary, decide the next one.
`run_in_background: false` covers a single unit; for independent read-only units, dispatch several background calls and collect each with `get_subagent_result` (`wait: true`).

Leave a run uncollected when the unit is genuinely independent and long enough that blocking on it wastes the session: a slow build, a broad research sweep, a batch nothing downstream needs yet.
Dispatch it, then keep working or hand back to the user.

## Model policy

Every subagent runs on its definition's default model.
Override with `model` only for cause.
The standing cause is the review pair: with two model families configured, every fresh-eyes review and doubt pass runs on both in parallel, so each catches what the other is blind to (`SKILL.md`, "Check with fresh eyes").

## Compacting mid-flight

Compaction replaces the main session's context, while a background subagent keeps working through the boundary and `get_subagent_result` still answers afterwards.
What can slip past is an in-flight completion notification.

Drain any agent whose result the handoff or the next decision depends on with `get_subagent_result` (`wait: true`); this bounded drain at the boundary is not the poll loop the tooling forbids.
A worker that is nearly done is cheaper to wait for than to race.
Skip the wait only for a long, fully-specified fire-and-forget job, and then the handoff carries that agent's id and the one-line check the continuation owes it.

## When the running state outgrows the context window

Have an agent persist it to a tracking file at `.agents/workflow/<slug>/` (the starting `HEAD`, current state, completed units with the commands that verified them and their outcome, open work, risks, approvals still pending) and refresh from a concise read of that file rather than holding everything at once.
A resumed session rereads the file and `git status` before the next dispatch, and takes no approval from the earlier conversation for granted.
