# smart-compact

Cooperative, agent-decided context compaction for pi.

The extension watches context usage on `turn_end` and injects escalating steering messages once usage crosses a configurable boundary.
It never forces compaction.
Instead it registers a `smart_compact` tool that the agent calls with its own handoff, writes that handoff to the nearest `.agents/handoff/` at or above the cwd, uses it verbatim as the `session_before_compact` summary, and sends a single `continue` afterwards.
pi's native auto-compaction is deliberately left untouched as the hard failsafe.

## Provenance

Fork of [dasomji/pi-smart-compact](https://github.com/dasomji/pi-smart-compact), published on npm as `@wienerberliner/pi-smart-compact`.

| | |
| --- | --- |
| Upstream version | 0.1.2 (published 2026-07-10) |
| Upstream commit | `2c0a5d3d19cdc06a641f53a023ffb7fdde41c891` |
| Forked | 2026-08-04 |
| Licence | MIT, upstream `LICENSE` retained verbatim |

Upstream is a single-author package with restricted issue creation, so this is a vendored fork rather than a dependency.
## Changes against upstream

1. Escalation state resets after any compaction.
   Upstream returned early from `continueAfterSmartCompaction` when no smart handoff was pending, so a single native auto-compaction left `highestEscalationBandSent` frozen and silenced every later warning in the session.
   `resetEscalationState` now runs before the pending guard.
2. Escalation warnings are suppressed while a compaction is pending.
   Steering a band warning into a conversation whose compaction is already in flight only trains the model to ignore the warnings.
3. New defaults and a configurable escalation interval.
   The boundary default moved from 100,000 to 120,000 tokens and the interval from a hardcoded 20,000 to a configurable 40,000.
   Claude MRCR degradation inflects between 64K and 128K, LangWatch telemetry puts the cost optimum near 220K, and Anthropic's own Opus 5 harness compacts at 200K, so the rungs land at 120K / 160K / 200K / 240K.
4. Durable on-disk handoff.
   Before calling `ctx.compact`, the tool writes the agent-authored handoff to `.agents/handoff/<ISO-timestamp>-<compaction-id>-compaction-handoff.md` and echoes that path into the compaction summary and into the compaction entry `details`.
   The timestamp resolves to whole seconds, so the compaction id keeps two compactions in the same second from overwriting each other.
   The id is a per-process counter, so concurrent pi-subagents children sharing the cwd would still collide on identical names; the file is therefore written with `flag: "wx"` and retried once under a pid-suffixed name, and an unresolvable collision warns instead of overwriting.
   A failed write warns and never blocks compaction.
   This closes the documented failure mode where the compaction summary is the only durable artifact.
5. Distinct escalation rungs with a SelfCompact-style rubric.
   Upstream had three tones where only the printed level number changed past band 1.
   Band 0 carries the full timing rubric (fire when a sub-task has resolved or the trajectory is converging, suppress while mid-derivation or mid-debugging with unsaved state) plus the handoff template.
   Bands 1+ are deltas: current usage against the boundary, their own recommendation, and one pointer back to the rubric and template in the `smart_compact` tool guidelines, because a rung that fires in an already-tight session should not spend a few hundred tokens repeating them.
   Every warning also names the threshold at which the next one will fire, so the agent can weigh finishing the current unit against compacting now.

   | Band | Default tokens | Recommendation |
   | --- | --- | --- |
   | 0 | 120,000 | Advisory marker. Keep working, treat each stopping point as a candidate. |
   | 1 | 160,000 | Offload to files or a fresh subagent rather than compacting. |
   | 2 | 200,000 | Compacting is now the recommended action. |
   | 3+ | 240,000+ | Strong urgency. Compact at the very next safe point. |

6. A late compaction failure reaches the agent, not only the UI.
   `ctx.compact()` is fire-and-forget, so its `onError` callback normally fires after `smart_compact` already returned `terminate: true`.
   Upstream only expired the pending state and posted a UI warning, which an unattended session never sees, so the run stopped dead.
   The callback now also sends the agent a user message naming the failure, the handoff file path, and the choice between retrying `smart_compact` and continuing.
   pi 0.82.1 has no `nextTurn` delivery for user messages, so the notice is sent plain while the session is idle and as `followUp` while it is still streaming.

7. The post-compaction message explains itself.
   Upstream sent a bare `continue`.
   After compaction the agent sees a summary it did not just write and an instruction with no subject, so the cheapest reading is to restate the handoff or re-explore what the handoff already records.
   The continuation now names what just happened, gives the durable handoff path when the write succeeded, and says to resume from the next steps rather than re-summarize.
8. A wrap-up rubric, so compaction is not spent as a session ends.
   Compacting pays for itself only if the reclaimed context is then used, and firing at the end of a session spends a summarization round trip on context nobody will spend, then lands the user on a continuation prompt for finished work.
   The fire rubric alone reads as "a unit just finished, so fire", which is exactly the shape of the last unit before wrap-up.
   A third rubric line makes continuation a precondition.
   It goes in band 0 and the `smart_compact` tool guidelines only: bands 1+ stay short deltas per change 5, and manual `/smart-compact` is an explicit user request that should not be second-guessed.

9. The continuation says the missing tool result is expected.
   `smart_compact` ends the turn as it compacts, so it can never return a tool result, and the agent on the other side reads that absence as a crash.
   Forensics over 17 real firings found the agent announcing that the tool had failed in 15 of them, and twice "retrying" it, which compacted an already-compacted context seconds later.
   The continuation now names the missing result as the expected shape of success, forbids the retry and the handoff-file existence check, and tells the agent not to explain the compaction to the user.
10. No escalation ladder inside a subagent child.
   Children load ambient extensions, and when the ladder fired in them it asked for a compaction they never performed: 45 warnings across 28 child runs, zero compactions, several children climbing to band 3 at ~248k tokens.
   The fix lives in config: every file in `agents/` sets `exclude_extensions: smart-compact`.
   `@tintinweb/pi-subagents` runs children in-process and sets no environment marker, so the extension cannot tell a child from a parent by itself.
   Letting children call `smart_compact` instead was rejected: a short-lived delegated run that needs compaction is a sign the parent handed it too much, and compacting a child does nothing for the parent's context.

11. Three silent-failure fixes found by reviewing against the pi 0.83.0 runtime rather than the extension's own mocks.
   The continuation is now delivered with `followUp` unless the session is known idle: a bare send throws inside pi while the agent is still streaming, and the runtime swallows that rejection, so the old code could lose the continuation with no error, no UI notice and no agent signal.
   A pending compaction that never completes and never errors is swept after ten minutes, because until now `startedAt` was recorded and never read, and a stuck pending silently disabled escalation and every later `smart_compact` for the rest of the session.
   The native-summary fallback now wakes the agent on the next `session_compact` instead of only warning the UI, which left unattended runs stopped dead; this is change 6 applied to the second path.

12. Branch navigation resets the escalation ladder.
   `session_start` covers new, resume, fork and switch, but `navigateTree` emits only `session_before_tree` / `session_tree`, which the extension did not register.
   Rewinding from a 200k branch to a short one left `highestEscalationBandSent` high, so the early rungs never fired again and the first warning on the new branch was band 3.
   A `session_tree` handler now resets the ladder like `session_start` does.

13. The escalation ladder is clamped under pi's native auto-compaction threshold.
   pi auto-compacts once context exceeds `contextWindow - reserveTokens`, and `reserveTokens` defaults to 16,384, so on a 200k-window model the native failsafe fires near 183.6k: below the default 200k and 240k rungs, which could therefore never fire.
   When the configured band 3 rung would land at or above that threshold, the interval is compressed at runtime so band 3 fires at three quarters of the gap between the boundary and the threshold, leaving the last quarter as room to finish a unit and compact.
   On a 200k model the effective rungs become 120k / 135.9k / 151.8k / 167.7k.
   The configured boundary itself never moves, and a gap too narrow to ladder (a clamped interval under 4,000 tokens) is left unchanged rather than spraying rungs into the last sliver of headroom; in both of those cases the native failsafe simply wins.
   `/smart-boundary` names the clamp and the effective rungs when it applies, both on show and right after either set, and warns outright when the configured boundary sits at or above the native threshold, where the ladder can never fire.
   `reserveTokens` is assumed at its default because the setting is not readable from an extension, and a model switch that changes the context window changes the effective schedule, which re-arms the ladder by design.

14. The fire rubric requires concrete evidence before firing.
   SelfCompact's central ablation: the same tool with and without a timing rubric scores 41.0 against 46.4 on agentic search, and the difference is that its rubric requires evidence from the trajectory before a fire condition counts.
   The fire rubric now asks the agent to name the sub-task that just finished and the concrete result that closed it (a passing test, a commit, an answered question), and to hold off when nothing has closed yet, because "a unit just finished" is otherwise asserted rather than checked.
   Worded deliberately without "quote/verbatim" language: on 2026-08-31 the advisory text in the replayed post-compaction window started tripping Anthropic's `reasoning_extraction` refusal classifier (see the wording-constraint note in `src/prompts.ts`); softer wording alone did not clear it, so change 17 neutralizes replayed advisories structurally.
   The paper's numbers come from open-weight models on math and search benchmarks, so the mechanism transfers while the point deltas do not.

15. A Markdown-heading template and an explicit break-even.
   Handoff quality in the logged corpus split sharply by shape: handoffs written as real Markdown headings cited 12 to 13 distinct paths and stayed pointer-shaped, while bare `Label:` lines correlated with 3 to 6 paths and paragraph-long commit narration.
   The soft template is now emitted as `##` headings, which also survive into the durable `.agents/handoff/` file, and the guidance states the SelfCompact break-even as a number the agent can aim at: a handoff earns its cost at roughly a tenth of the context it replaces.

16. The post-compaction continuation is deferred past the in-flight compaction.
   pi keeps `_compactionAbortController` set through the `session_compact` emit and clears it, returning to idle, only once the handler resolves, just before `compaction_end`.
   An inline `sendUserMessage` from that handler therefore reaches pi's `prompt()` guard "Cannot submit a prompt while compaction is in progress" and throws, and because `pi.sendUserMessage` is fire-and-forget with an internal catch the throw is swallowed into the runtime error channel: the agent gets no continuation and sits idle after a successful smart compaction.
   The continuation and the fallback notice are now scheduled onto a macrotask, which runs after pi has settled the compaction and the send succeeds.
   This was a regression against pi 0.84.x; the extension's own mocks never modelled the guard, so the suite stayed green while the live path broke.

17. Stale steering messages are neutralized in the replayed context after a compaction.
   From 2026-08-31 Anthropic's `reasoning_extraction` refusal classifier rejected every post-compaction request that replayed the boundary advisory out of the kept tail: stop_reason "refusal", zero content, deterministic on retry, unrecoverable without rewinding, and surfaced only as "Unknown error" until the provider was made to report `stop_details`.
   Replay bisection against the failing request isolated the advisory as the trigger; rewording it did not clear the classifier, and removing the message outright made the neighboring assistant turns adjacent and still refused.
   A `context`-event handler (`src/context-filter.ts`) therefore replaces the text of stale steering messages (advisory, escalation rungs, manual request; recognized by `SMART_COMPACT_STEERING_PREFIXES`) with a probe-verified one-line placeholder once a compaction summary postdates them, keeping message count and structure intact; steering sent after the compaction survives verbatim.

18. Every steering message says the hidden tool is callable, and none offers a no-tool fallback.
   Since 15 Oct 2026 `hide-declarations.ts` leaves the `smart_compact` declaration out of every request, so the steering messages are the only place the model learns the tool exists.
   Upstream's closing line, "If `smart_compact` is unavailable in this toolset, return a final handoff-style response instead", then read as permission to give up: from 19 to 21 Oct no fresh session called the tool after an advisory (zero calls across eight sessions), and two told the user it was missing.
   The line is replaced, in the advisory, every escalation rung and the manual request, by one stating that the tool is active and callable with `smart_compact({ handoff: "..." })`; a direct call to the hidden tool runs, as the 16 Oct calls showed.

19. The rungs recommend the `prune` tool first when it would leave enough headroom.
   A prune keeps every message with pointers to the cut tool I/O, which is more exact than a written handoff, and the eight prunes on record landed at 24k to 54k tokens.
   When a rung is about to fire, `monitorContextUsage` runs `prune/src/estimate.ts` on what the model sees now (`buildSessionProjection()`, the same transform the tool runs, plus a baseline for the system prompt and tools, at 1.8 chars per token); within 10% on every prune measured.
   At most `PRUNE_GATE_RATIO` (0.7) of the boundary, the rung asks the model to call `prune({})` at the next clean stopping point and keep working, and the UI shows the estimate; band 0 still carries the rubric and template, and level 4 falls back to `smart_compact` once a prune no longer gains enough.
   The tool edits the context in place through pi `context_edit` entries (`prune/index.ts`) and does not end the turn, so no continuation is needed; an estimate failure keeps the plain rungs.
20. The ladder restarts once the context drops back under the boundary.
   Upstream's ladder is one-shot per session, so after a prune the next crossing would skip band 0 and the prune recommendation; `monitorContextUsage` resets the escalation state when usage falls below the boundary.

Unchanged from upstream: the pending-handoff lifecycle with expiry on all three failure paths, the monotonic one-shot band ladder, the summary provenance header, the single automatic continuation after compaction, and the fact that nothing touches `compaction.enabled`, `reserveTokens`, or `keepRecentTokens`.

## Configuration

State lives in `$XDG_CONFIG_HOME/pi-smart-compact/config.json` (`~/.config/pi-smart-compact/config.json` by default), overridable with `PI_SMART_COMPACT_CONFIG_PATH`.
Writes are atomic (temp file plus `rename`).
The setting is global: there is no per-project or per-agent override.

| Command | Effect |
| --- | --- |
| `/smart-boundary` | Show the boundary, the interval, and the resulting rungs |
| `/smart-boundary 120k` or `/smart-boundary 120000` | Set the boundary |
| `/smart-boundary interval 40k` | Set the escalation interval |
| `/smart-boundary interval reset` | Reset only the interval |
| `/smart-boundary reset` | Reset both to the defaults |
| `/smart-compact` | Ask the active agent to stop at the next safe point and call `smart_compact` |

Both values reset the in-memory band ladder when changed, so a reconfigured schedule always starts at its own band 0.

## Operational notes

Subagents only see `smart_compact` if their `tools` allowlist includes it.
The upstream author's audit of 1,121 real sessions found child sessions that received the warning but had no tool to act on, which is the quiet failure mode of this pattern.

Handoff files land in the project's `.agents/handoff/`, so a repository that does not ignore `.agents/` will show them as untracked or dirty after every compaction.

Every message this extension sends through `pi.sendUserMessage` is stored as an ordinary user message, indistinguishable from what the user typed.
`SMART_COMPACT_INJECTED_PREFIXES` in `src/prompts.ts` lists their opening words, and the annotate extension (`../annotate.ts` via `../shared/session-answers.ts`) relies on it to skip them when it groups the answers since the user's last message.
A new injected message, or a reworded opening of an existing one, must be added to that list; the tests only guard the steering prompts and the post-compaction continuation, not the fallback and failure notices in `index.ts`.

Monitoring runs on `turn_end` only, so a single turn with a very long tool loop can cross several bands before the first warning arrives.
That is inherited from upstream and unfixed here.

## Development

```
pnpm install
pnpm test        # vitest, 93 tests against tests/fixtures/mock-pi.mjs
pnpm typecheck   # tsc against the installed pi types (0.85.1)
```

`pnpm typecheck` uses `../tsconfig.json`, which maps `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` and `typebox` through the `../node_modules` link to pi's own install (see `../README.md`).
Tests are mocked end to end; behaviour against a live pi runtime is only covered by manual smoke testing (`/smart-boundary 2000` in a scratch session).
