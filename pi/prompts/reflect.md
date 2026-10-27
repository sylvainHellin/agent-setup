---
description: Review this session for anything that should become durable agent instruction, and propose it for approval
argument-hint: "[focus area]"
---
Look back over this session and decide whether anything learned in it deserves to become durable instruction.

## Focus
$@

If no focus is given, review the whole session.

Past sessions are in scope too.
They live in the session store, one JSONL file per session under a directory named for its working directory (`~/.pi/agent/sessions/` by default).
Widen to them when a candidate here looks like the second occurrence of something older, or when the focus names a recurring problem rather than a single incident.
A correction that recurs across sessions is the strongest candidate there is; one that appears only here is usually a one-off.
Read enough to confirm or kill the pattern, then stop: re-reading the archive costs more than the instruction it would produce.

Propose only.
Never edit an instruction surface in this command, even when the change looks obvious.
Instruction files are the one surface that has to stay trustworthy, so every change goes through explicit approval.
The goal is to minimize the amount of guidance I need to give you in future interactions.

## 1. Collect candidates

Re-read what actually happened, not what you remember of it.
Look for the moments that produce durable instruction:

- a correction I had to make more than once
- a gotcha found the hard way, where the first attempt failed for a non-obvious reason
- a tool, API, or command whose real contract differed from its documentation
- a convention that was implicit, and that this session made explicit
- a task where you needed to spend significant amount of time to understand how to use the tools and how to locate the information.

Each candidate needs a concrete moment as evidence, in this session or a named earlier one.

## 2. Filter hard

Load the `agents/authoring` skill and apply its tests before proposing anything.

Rejection is the normal outcome.
A reflect pass that always finds something to add inflates the context budget of every future turn, which is exactly the cost these surfaces are supposed to avoid.
Drop a candidate when it is a fact the model already knows, a one-off unlikely to recur, too vague to act on, already covered by an existing surface, or a property of the system that a pointer to the code, a `--help`, or a vault note covers better than a copy.

Durable instruction is the only target here.
Facts about the world, people, or projects belong in the vault via the `knowledge` skill instead.

## 3. Place what survives

| Target | When |
|---|---|
| The global `AGENTS.md` (`~/.pi/agent/AGENTS.md`) | True for every task, on every machine |
| The vault's or the project's own `AGENTS.md` | True only inside that vault or repo |
| An existing skill in your skills directory | Gates on an artifact or task that skill already covers; variant detail goes in a sibling file, not `SKILL.md` |
| A new skill | A recurring workflow with clear triggers, broad enough to grow |
| Nothing | The default |

## 4. Report

For each surviving candidate, give the evidence in one line (name the session if it is not this one), the exact target file path, the exact text to insert with enough surrounding context to place it, one line on why that surface and not the next one up, and anything it replaces or makes redundant.

Don't list or mention rejected candidates.

Then stop and wait for approval.
If I approve, edit the source file; when your config is symlinked from a dotfiles repo, edit the file in that repo rather than through the link target.

Finding nothing worth capturing is a good result.
Say so plainly rather than manufacturing a candidate.
