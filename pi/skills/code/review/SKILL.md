# Code review

Adapted from the PR-AF pipeline (https://github.com/Agent-Field/pr-af).

Left to decide what counts as evidence, a reviewer lets the bar drift down over
a long session.
This skill fixes the bar; the `reviewer` agent (`pi/agents/reviewer.md` in this repo) reads it
first and treats it as authoritative.

Two jobs, kept apart: deciding whether a finding is real, and deciding whether
it blocks.
A reviewer answers the first.
Only the orchestrator answers the second.

## Gates a finding must pass before it is reported

Every finding clears all three, or it is dropped rather than softened.

1. Reachability.
   Name the call path from a real entry point to the code, and check for
   upstream guards, validators or type constraints that already prevent the bad
   state.
   No concrete path means speculation, not a finding.
2. Evidence chain.
   Write the steps: entry point calls X with these arguments, X passes this
   value to Y, Y expects this and receives that, which fails this way.
   A finding whose chain cannot be written is not evidenced enough to report.
3. Confidence.
   State a number. Report at 0.6 and above.
   0.9 means the path was traced and the failure verified, 0.7 means strong
   evidence with assumptions about runtime state, below 0.6 is guessing.

Three proven findings beat ten plausible ones.
When unsure, drop it and say in the summary that it was dropped.

## Verify each claim against the code, not against the diff

The diff shows what changed; the repository shows whether it matters.
Before reporting, open the definition, the caller, or the creation site and
confirm the behaviour being claimed actually exists there.

The productive question for each changed line is what must be true elsewhere for
this line to be correct: the real signature of the function it calls, the key a
value was stored under, how the sibling branch treats the opposite outcome, what
the consumer does with what it produces.
Then go read that other end and check.
Most defects are two locations disagreeing, and only one of them is in the diff.

The most dangerous omissions are outside the diff entirely.
A changed signature obliges every caller, a new enum variant obliges every match.

## Falsification pass

Do not let the agent that found an issue be the only one to judge it.
When findings matter enough to act on, run a second fresh-context reviewer whose
task is to challenge them, given the finding text and the file paths but not the
first reviewer's reasoning.
It returns one verdict per finding:

- confirmed: the code matches the claim and the failure is reachable.
- challenged: the code does not do what the claim says, or a guard prevents it.
- escalated: the real problem is worse than described.

Challenged findings are demoted, not deleted; the challenge can be wrong too.
This pass is cheap and removes the noise that makes agent review easy to ignore.

## The blocking bar (orchestrator only)

Severity is the reviewer's opinion about impact.
Blocking is a separate decision, made against a tight list, and a finding
labelled critical does not clear it automatically.

Blocking only when the finding concretely demonstrates one of these:
it breaks the build, tests or type-checking; it opens a security hole reachable
from a real code path; it loses or corrupts data; it breaks a public
API/CLI/schema contract real callers depend on with no migration; it regresses
behaviour that worked before the change.

Never blocking: style, naming, refactors, missing tests, defensive programming
with no demonstrated reachable path, performance suggestions that preserve
correctness, documentation, architectural critique with no named production
impact, and anything whose reachability the finding itself cannot show.

Reviewers are alarmist by construction. This bar is the calibrating layer.

## Dispatching parallel reviewers

Name each reviewer's angle, and name the other angles running beside it, so the
passes do not converge on the same finding.
Derive the angles from the actual change rather than a standing list.
Correctness and regressions, tests and validation, and simplicity are the usual
three; add security, performance or contract angles when the change calls for it.

The `reviewer` agent reads this file on its own; any other agent doing a review
needs its path in the prompt, since a child cannot see the parent's loaded skills.
