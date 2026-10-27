# Orchestrator mode

Orchestration runs the main session as a dispatcher: subagents gather information, implement work units and verify results, and the main session touches no files.

## Core principle

Reading a large file, running `rg` across the repo, fetching web docs or editing anything during an orchestration session burns the context window that has to stay clean to hold a faithful overview of the whole task.

The main session's context holds the plan, the running status of each work unit, and the open risks.
File contents, diffs, search results and web pages stay in the subagents and come back as a summary.

## The loop

1. Break the task into work units.
   A unit is small enough that one subagent can carry it out and report back concisely: implement a change, run a search, rephrase a section, write a test, gather docs.
2. Dispatch the next unit.
   Pick the agent (`worker` to implement, `scout` or `researcher` to gather, `reviewer` to check) and give it a contract: the goal, what is in and out of scope, how to validate, what to report.
3. Collect a short status: what was done, what was not, risks and surprises.
   Keep the summary, never the raw output.
4. Decide the next action from that status: a follow-up search, a fix, a fresh-eye review, a test pass.
5. Loop or escalate.
   Blockers get an agent dispatched to fix them; a scope or product decision goes back to the user.

Keep writes single-threaded: one writing agent at a time on the active worktree.
Parallelize only reading, review and validation.

## Rhythm

Blocking is the default, because the loop is a conversation: dispatch a unit, read the summary, decide the next one.
`run_in_background: false` covers a single unit; for independent read-only units, dispatch several background calls and collect each with `get_subagent_result` (`wait: true`).

Leave a run uncollected when the unit is genuinely independent and long enough that blocking on it wastes the session: a slow build, a broad research sweep, a batch nothing downstream needs yet.
Dispatch it, then keep working or hand back to the user.

## Model policy

Every subagent runs on its definition's default model.
Override with `model` only for cause.

## Compacting mid-flight

Compaction replaces the main session's context, while a background subagent keeps working through the boundary and `get_subagent_result` still answers afterwards.
What can slip past is an in-flight completion notification.

Drain any agent whose result the handoff or the next decision depends on with `get_subagent_result` (`wait: true`); this bounded drain at the boundary is not the poll loop the tooling forbids.
A worker that is nearly done is cheaper to wait for than to race.
Skip the wait only for a long, fully-specified fire-and-forget job, and then the handoff carries that agent's id and the one-line check the continuation owes it.

## When the running state outgrows the context window

Have an agent persist it to a tracking file (current state, completed units, open work, risks) and refresh from a concise read of that file rather than holding everything at once.
