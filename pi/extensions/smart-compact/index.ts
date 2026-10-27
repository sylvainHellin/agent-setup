/**
 * smart-compact
 * ---------------------------------------------------------------
 * Cooperative, agent-decided context compaction for pi.
 *
 * Escalating steering warnings from a configurable boundary, an agent-callable
 * `smart_compact` tool that takes an agent-authored handoff, that handoff used
 * verbatim as the `session_before_compact` summary, a durable copy written to
 * the nearest `.agents/handoff/` at or above the cwd, and one automatic continuation message afterwards. pi's native
 * auto-compaction is deliberately left untouched as the hard failsafe.
 *
 * Provenance
 *   Fork of https://github.com/dasomji/pi-smart-compact
 *   npm `@wienerberliner/pi-smart-compact` v0.1.2, MIT
 *   Upstream commit 2c0a5d3d19cdc06a641f53a023ffb7fdde41c891 (2026-07-10)
 *   Forked 2026-08-04. Upstream LICENSE retained verbatim in ./LICENSE.
 *
 * Changes against upstream (see README.md for the rationale)
 *   1. Escalation state resets after ANY compaction, native ones included.
 *   2. Escalation warnings are suppressed while a compaction is already pending.
 *   3. Defaults are 120k boundary / 40k interval, and the interval is
 *      configurable through `/smart-boundary interval <tokens>`.
 *   4. The handoff is written to the nearest `.agents/handoff/` at or above the cwd before compacting and
 *      its path is echoed into the compaction summary. Writes are collision-safe
 *      across concurrent processes (`wx` plus a pid-suffixed retry).
 *   5. Four distinct escalation rungs with a SelfCompact-style timing rubric.
 *   6. A failed compaction reported through the async `onError` callback also
 *      wakes the agent with a user message, not only the human-facing UI.
 *   7. The post-compaction message names what happened and points at the
 *      durable handoff, instead of a bare `continue`.
 *   8. A wrap-up rubric, so compaction is not spent as a session ends.
 *   9. The continuation says the missing tool result is expected, because the
 *      agent read that absence as a crash in 15 of 17 logged firings.
 *  10. No escalation ladder inside a subagent child: every file in `agents/`
 *      excludes this extension (`exclude_extensions: smart-compact`), since
 *      pi-subagents runs children in-process and they carry no env marker.
 *  11. Three silent-failure fixes: the continuation and fallback notices are
 *      queued as `followUp` while the agent streams, a stuck pending
 *      compaction is swept after ten minutes, and the native-summary fallback
 *      wakes the agent on the next `session_compact` instead of only the UI.
 *  12. Branch navigation (`session_tree`) resets the escalation ladder, which
 *      `session_start` alone never covered.
 *  13. The escalation ladder is clamped under pi's native auto-compaction
 *      threshold (`contextWindow - reserveTokens`), so the top rungs cannot
 *      sit above the point where the native failsafe fires first.
 *  14. The fire rubric requires quoted verbatim evidence that a sub-task
 *      resolved before firing, which is the SelfCompact paper's central
 *      ablation.
 *  15. The handoff template is Markdown headings and the guidance names the
 *      break-even (a handoff earns its cost at roughly a tenth of what it
 *      replaces), both from the forensics' quality split.
 *  17. Stale steering messages (boundary advisory, escalation rungs, manual
 *      request) are neutralized in the replayed LLM context once a compaction
 *      summary postdates them. Anthropic's `reasoning_extraction` refusal
 *      classifier (2026-08-31) rejects post-compaction requests that replay
 *      the advisory, deterministically and unrecoverably; rewording alone did
 *      not clear it, and removing the message outright reshaped the request
 *      into one that still refused, so the text is replaced in place with a
 *      probe-verified one-liner. See ./src/context-filter.ts.
 *  16. The post-compaction continuation and the fallback notice are deferred
 *      onto a macrotask instead of sent inline from `session_compact`. pi holds
 *      `_compactionAbortController` set through that emit and only clears it
 *      (returning to idle) right after the handler resolves, so an inline
 *      `sendUserMessage` hits pi's `prompt()` guard "Cannot submit a prompt
 *      while compaction is in progress" and throws. Because `pi.sendUserMessage`
 *      is fire-and-forget with an internal catch, that throw is swallowed into
 *      the runtime error channel, never reaches this extension, and the agent
 *      is left idle with no continuation. Deferring past the emit lets the send
 *      land once compaction has settled.
 */

import type {
  AgentToolResult,
  CompactOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { estimatePrunedTokens } from "../prune/src/estimate.ts";

import { createSmartBoundaryConfig, type SmartBoundaryConfigStore } from "./src/config.js";
import { neutralizeStaleSteeringMessages } from "./src/context-filter.js";
import {
  SMART_BOUNDARY_COMMAND_NAME,
  SMART_COMPACT_COMMAND_NAME,
  SMART_COMPACT_TOOL_NAME,
  NATIVE_COMPACTION_RESERVE_TOKENS,
} from "./src/constants.js";
import { calculateEscalationBand, clampEscalationSchedule, isHigherEscalationBand } from "./src/escalation.js";
import { writeHandoffFile } from "./src/handoff-file.js";
import {
  buildEscalationPrompt,
  buildManualSmartCompactRequestPrompt,
  buildPostCompactionContinuationPrompt,
  shouldRecommendPrune,
  SMART_COMPACT_HANDOFF_GUIDANCE,
  SMART_COMPACT_PROMPT_GUIDELINES,
  SMART_COMPACT_PROMPT_SNIPPET,
} from "./src/prompts.js";
import { parseSmartBoundaryInput } from "./src/smart-boundary-parser.js";
import {
  beginPendingSmartCompaction,
  clearPendingSmartCompaction,
  createSmartCompactRuntimeState,
  expirePendingSmartCompaction,
  findStalePendingSmartCompaction,
  getPendingSmartCompaction,
  markEscalationBandSent,
  markSmartCompactionFallback,
  resetEscalationState,
  setPendingHandoffPath,
  syncEscalationSettings,
  takeSmartCompactionFallback,
  type PendingSmartCompactionState,
  type SmartCompactRuntimeState,
} from "./src/smart-compact-state.js";

type SmartBeforeCompactResult = {
  compaction: {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details: Record<string, unknown>;
  };
};

export default function smartCompactExtension(pi: ExtensionAPI) {
  const config = createSmartBoundaryConfig();
  const runtimeState = createSmartCompactRuntimeState();

  pi.on("session_start", () => {
    resetEscalationState(runtimeState);
  });

  // Branch navigation (rewind, tree jump) emits session_before_tree /
  // session_tree only, not session_start. Without this reset, rewinding from a
  // 200k branch to a short one leaves `highestEscalationBandSent` high, so the
  // early rungs never fire again and the first warning the agent sees on the
  // new branch is band 3.
  pi.on("session_tree", () => {
    resetEscalationState(runtimeState);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await monitorContextUsage(pi, ctx, config, runtimeState);
  });

  // Change 17: never replay stale steering messages verbatim after a compaction.
  pi.on("context", (event) => {
    const messages = neutralizeStaleSteeringMessages(event.messages);
    return messages ? { messages } : undefined;
  });

  registerSmartCompactCommand(pi);
  registerSmartCompactTool(pi, runtimeState);
  registerSmartCompactionHooks(pi, runtimeState);
  registerSmartBoundaryCommand(pi, config, runtimeState);
}

function registerSmartBoundaryCommand(
  pi: ExtensionAPI,
  config: SmartBoundaryConfigStore,
  runtimeState: SmartCompactRuntimeState,
): void {
  pi.registerCommand(SMART_BOUNDARY_COMMAND_NAME, {
    description:
      "Show, set, or reset the smart compaction token boundary and the escalation interval (`interval <tokens>`).",
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const parsed = parseSmartBoundaryInput(args);

      if (!parsed.ok) {
        return notify(ctx, parsed.message, "error") as unknown as void;
      }

      if (parsed.action === "show") {
        const current = await config.read();
        const message = withNativeThresholdNote(ctx, describeCurrentSettings(current), current);
        return notify(ctx, message, current.warning ? "warning" : "info") as unknown as void;
      }

      if (parsed.action === "reset") {
        const current = await config.reset({ target: parsed.target });
        resetEscalationState(runtimeState);
        const label =
          parsed.target === "interval"
            ? `Escalation interval reset to the default ${formatTokens(current.intervalTokens)}.`
            : `Smart boundary reset to the default ${formatTokens(current.boundaryTokens)} and escalation interval to ${formatTokens(current.intervalTokens)}.`;
        const resetFeedback = notify(ctx, label, current.warning ? "warning" : "info");
        const warningFeedback = current.warning ? notify(ctx, current.warning, "warning") : undefined;
        const fallback = [resetFeedback, warningFeedback].filter(Boolean).join("\n") || undefined;
        return fallback as unknown as void;
      }

      if (parsed.target === "interval") {
        const saved = await config.write({ intervalTokens: parsed.tokens });
        resetEscalationState(runtimeState);
        return notify(
          ctx,
          withNativeThresholdNote(ctx, `Escalation interval set to ${formatTokens(saved.intervalTokens)}.`, saved),
        ) as unknown as void;
      }

      const saved = await config.write({ boundaryTokens: parsed.tokens });
      resetEscalationState(runtimeState);
      return notify(
        ctx,
        withNativeThresholdNote(ctx, `Smart boundary set to ${formatTokens(saved.boundaryTokens)}.`, saved),
      ) as unknown as void;
    },
  });
}

function registerSmartCompactCommand(pi: ExtensionAPI): void {
  pi.registerCommand(SMART_COMPACT_COMMAND_NAME, {
    description: "Request cooperative smart compaction with an agent-authored handoff.",
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      if (args.trim()) {
        return notify(
          ctx,
          "Run /smart-compact without handoff text. The active agent must author the handoff from its current context and then call smart_compact.",
          "error",
        ) as unknown as void;
      }

      try {
        await sendManualSmartCompactRequest(pi, ctx);
        return notify(
          ctx,
          "Smart compaction requested. The agent has been asked to stop at the next safe boundary, write a handoff, and call smart_compact.",
        ) as unknown as void;
      } catch (error) {
        return notify(ctx, `Smart compaction request could not be sent: ${errorMessage(error)}`, "error") as unknown as void;
      }
    },
  });
}

async function sendManualSmartCompactRequest(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const message = buildManualSmartCompactRequestPrompt();
  const options = shouldDeliverCommandMessageAsSteer(ctx) ? { deliverAs: "steer" as const } : {};
  await Promise.resolve(pi.sendUserMessage(message, options));
}

function shouldDeliverCommandMessageAsSteer(ctx: ExtensionCommandContext): boolean {
  try {
    return typeof ctx.isIdle === "function" ? !ctx.isIdle() : false;
  } catch {
    return false;
  }
}

function registerSmartCompactTool(pi: ExtensionAPI, runtimeState: SmartCompactRuntimeState): void {
  pi.registerTool({
    name: SMART_COMPACT_TOOL_NAME,
    label: "Smart compact",
    description: [
      "Submit an agent-authored handoff and start same-session smart compaction.",
      "Use this when a smart compaction boundary advisory or the user asks for it; the advisory carries the timing rubric and handoff template.",
      "The handoff is also written to .agents/handoff/ in the project so a durable copy survives the compaction.",
      "Call smart_compact alone as the final action/only tool call for the current mini-phase; the tool terminates the turn immediately, so any tool call or text queued after it is lost.",
    ].join("\n"),
    promptSnippet: SMART_COMPACT_PROMPT_SNIPPET,
    promptGuidelines: SMART_COMPACT_PROMPT_GUIDELINES,
    parameters: Type.Object(
      {
        handoff: Type.String({
          minLength: 1,
          description: `Required non-empty handoff covering ${SMART_COMPACT_HANDOFF_GUIDANCE}.`,
        }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return executeSmartCompact(pi, params as { handoff?: unknown }, ctx, runtimeState);
    },
  });
}

function registerSmartCompactionHooks(pi: ExtensionAPI, runtimeState: SmartCompactRuntimeState): void {
  pi.on("session_before_compact", async (event, ctx) => {
    return prepareSmartCompactionSummary(event, ctx, runtimeState);
  });

  pi.on("session_compact", async (event, ctx) => {
    await continueAfterSmartCompaction(pi, event, ctx, runtimeState);
  });
}

function prepareSmartCompactionSummary(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  runtimeState: SmartCompactRuntimeState,
): SmartBeforeCompactResult | undefined {
  const pending = getPendingSmartCompaction(runtimeState);
  if (!pending) {
    return undefined;
  }

  const preparation = event.preparation;
  if (event.signal?.aborted || !isValidCompactionPreparation(preparation)) {
    expirePendingSmartCompaction(runtimeState, pending.id);
    // The UI warning alone leaves an unattended run asleep: the agent already
    // ended its turn on `terminate: true`, compaction proceeds with pi's own
    // summary, and the later `session_compact` finds no pending and returns
    // without sending a continuation. `notifyIfAvailable` is also a no-op when
    // ctx.hasUI is false. Remember the fallback so `session_compact` can still
    // wake the agent, which is the same fix as change 6 on the other path.
    markSmartCompactionFallback(runtimeState, {
      id: pending.id,
      handoffPath: pending.handoffPath,
      reason: event.signal?.aborted
        ? "the compaction was aborted before the summary could be customized"
        : "the host did not provide a usable compaction preparation",
    });
    notifyIfAvailable(ctx, "Smart compaction could not safely customize the compaction summary; falling back to Pi default compaction.", "warning");
    return undefined;
  }

  return {
    compaction: {
      summary: buildSmartCompactionSummary(pending),
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: buildSmartCompactionDetails(pending),
    },
  };
}

async function continueAfterSmartCompaction(
  pi: ExtensionAPI,
  event: SessionCompactEvent,
  ctx: ExtensionContext,
  runtimeState: SmartCompactRuntimeState,
): Promise<void> {
  // Any compaction, native or smart, drops the context that earned the current
  // escalation band. Reset before the pending guard, otherwise a single native
  // auto-compaction silences every later warning in the session.
  resetEscalationState(runtimeState);

  const fallback = takeSmartCompactionFallback(runtimeState);
  if (fallback) {
    notifyAgentOfCompactionFallback(pi, ctx, fallback);
    return;
  }

  const pending = getPendingSmartCompaction(runtimeState);
  if (!pending) {
    return;
  }

  const completedSmartCompactionId = getSmartCompactionIdFromDetails(event.compactionEntry?.details);
  if (completedSmartCompactionId !== pending.id) {
    return;
  }

  clearPendingSmartCompaction(runtimeState, pending.id);
  notifyIfAvailable(ctx, "Smart compaction completed. Continuing the same session.");
  deliverAgentMessageAfterCompaction(pi, ctx, buildPostCompactionContinuationPrompt(pending.handoffPath));
}

/**
 * Wake the agent after a compaction, deferred past pi's in-flight compaction.
 *
 * `session_compact` fires while pi still holds `_compactionAbortController`;
 * pi clears it and returns to idle only once this handler resolves, right
 * before `compaction_end`. An inline `pi.sendUserMessage` therefore funnels
 * into `prompt()`, hits `if (this._compactionAbortController !== undefined)
 * throw "Cannot submit a prompt while compaction is in progress"`, and the
 * throw is swallowed by the fire-and-forget wrapper, so the continuation is
 * lost and the agent sits idle. compact() clears the controller synchronously
 * after awaiting this handler, so a macrotask send lands after compaction has
 * settled, when the agent is idle and `prompt()` accepts the message. The
 * timer is unref'd so it never keeps a shutting-down process alive.
 */
function deliverAgentMessageAfterCompaction(pi: ExtensionAPI, ctx: ExtensionContext, message: string): void {
  const timer = setTimeout(() => {
    try {
      const options = isSessionIdle(ctx) ? {} : { deliverAs: "followUp" as const };
      void Promise.resolve(pi.sendUserMessage(message, options)).catch((error) => {
        notifyIfAvailable(ctx, `Smart compaction completed, but automatic continuation could not be sent: ${errorMessage(error)}`, "error");
      });
    } catch (error) {
      notifyIfAvailable(ctx, `Smart compaction completed, but automatic continuation could not be sent: ${errorMessage(error)}`, "error");
    }
  }, 0);
  if (timer && typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

/**
 * The handoff was written but pi's own summary was used instead. The agent has
 * already ended its turn, so without this it simply stops.
 * Keep the opening words in SMART_COMPACT_INJECTED_PREFIXES (src/prompts.ts).
 */
function notifyAgentOfCompactionFallback(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  fallback: { handoffPath?: string; reason: string },
): void {
  const message = [
    `The conversation was compacted, but ${fallback.reason}, so the summary above is Pi's own rather than the handoff you wrote.`,
    fallback.handoffPath
      ? `Your handoff is on disk at ${fallback.handoffPath}. Read it before continuing; it is more precise about the stopping point than the generic summary.`
      : "No durable handoff file was written, so reassess where the work stands from the summary above.",
    "Then pick the work back up. Do not call `smart_compact` again to retry: the compaction already happened.",
  ].join("\n");

  // Same deferral as the normal path: this runs inside session_compact, so an
  // inline send would throw pi's "compaction in progress" guard and be lost.
  deliverAgentMessageAfterCompaction(pi, ctx, message);
}

async function executeSmartCompact(
  pi: ExtensionAPI,
  params: { handoff?: unknown },
  ctx: ExtensionContext,
  runtimeState: SmartCompactRuntimeState,
): Promise<AgentToolResult<unknown>> {
  const rawHandoff = params?.handoff;
  const handoff = typeof rawHandoff === "string" ? rawHandoff.trim() : "";

  if (!handoff) {
    return toolResult("smart_compact requires a non-empty handoff. Write the handoff text before retrying.", false, true);
  }

  const existingPending = getPendingSmartCompaction(runtimeState);
  if (existingPending) {
    return toolResult(
      "Smart compaction is already pending/in progress. Do not overwrite the handoff; wait for compaction or retry only after it fails.",
      true,
    );
  }

  const pending = beginPendingSmartCompaction(runtimeState, handoff);
  if (!pending) {
    return toolResult(
      "Smart compaction is already pending/in progress. Do not overwrite the handoff; wait for compaction or retry only after it fails.",
      true,
    );
  }

  // Durable copy first: if compaction later drops or mangles the summary, the
  // handoff still exists on disk. A failed write is a warning, never a blocker.
  const handoffFile = await writeHandoffFile({ cwd: ctx.cwd, handoff, smartCompactionId: pending.id });
  if (handoffFile.path) {
    setPendingHandoffPath(runtimeState, pending.id, handoffFile.path);
  } else if (handoffFile.warning) {
    notifyIfAvailable(ctx, handoffFile.warning, "warning");
  }

  let callbackError: Error | undefined;
  let toolResultDelivered = false;
  const compactOptions: CompactOptions = {
    onError: (error) => {
      callbackError = error;
      expirePendingSmartCompaction(runtimeState, pending.id);
      notifyIfAvailable(ctx, `Smart compaction failed: ${errorMessage(error)}`, "error");

      // ctx.compact() is fire-and-forget, so onError normally lands after this
      // tool already returned `terminate: true`. The UI warning above reaches a
      // human, never the agent, so an unattended session would stop here for
      // good. Wake the agent itself once the tool result is out.
      if (toolResultDelivered) {
        notifyAgentOfFailedCompaction(pi, ctx, error, handoffFile.path);
      }
    },
  };

  try {
    ctx.compact(compactOptions);
  } catch (error) {
    expirePendingSmartCompaction(runtimeState, pending.id);
    notifyIfAvailable(ctx, `Smart compaction could not start: ${errorMessage(error)}`, "error");
    return toolResult(`Smart compaction could not start: ${errorMessage(error)}. The pending handoff was cleared so you can retry.`, false, true);
  }

  if (callbackError) {
    return toolResult(
      `Smart compaction failed: ${errorMessage(callbackError)}. The pending handoff was cleared so you can retry.`,
      false,
      true,
    );
  }

  notifyIfAvailable(ctx, "Smart compaction started. The pending handoff has been saved.");
  toolResultDelivered = true;
  return toolResult(
    [
      "Smart compaction has started. No further action is needed until the continuation after compaction.",
      handoffFile.path
        ? `A durable copy of the handoff was written to ${handoffFile.path}.`
        : `No durable handoff file was written: ${handoffFile.warning ?? "unknown reason"}`,
    ].join("\n"),
    true,
  );
}

/**
 * Tell the agent, not just the UI, that an already-returned smart compaction
 * failed. pi 0.82.1 has no `nextTurn` delivery for user messages: while idle a
 * plain send starts the recovery turn, and `followUp` is the only safe queueing
 * mode while the agent is still streaming.
 * Keep the opening words in SMART_COMPACT_INJECTED_PREFIXES (src/prompts.ts).
 */
function notifyAgentOfFailedCompaction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  error: unknown,
  handoffPath: string | undefined,
): void {
  const message = [
    `Smart compaction failed after smart_compact returned: ${errorMessage(error)}.`,
    handoffPath
      ? `The handoff written before compaction is still on disk at ${handoffPath}.`
      : "No durable handoff file was written.",
    "The pending handoff was cleared. Reassess where the work stands, then either retry smart_compact or continue without compacting.",
  ].join("\n");

  try {
    const options = isSessionIdle(ctx) ? {} : { deliverAs: "followUp" as const };
    void Promise.resolve(pi.sendUserMessage(message, options)).catch(() => undefined);
  } catch {
    // Waking the agent is best effort: a throwing sendUserMessage must never
    // break the callback that just expired the pending state.
  }
}

function isSessionIdle(ctx: ExtensionContext): boolean {
  try {
    return typeof ctx.isIdle === "function" ? ctx.isIdle() : false;
  } catch {
    return false;
  }
}

function toolResult(text: string, terminate: boolean, isError = false): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    isError,
    terminate,
  } as unknown as AgentToolResult<unknown>;
}

function buildSmartCompactionSummary(pending: PendingSmartCompactionState): string {
  return [
    "Smart compaction summary from the smart-compact extension (`smart_compact`).",
    "The following handoff was authored by the agent at a cooperative same-session compaction boundary.",
    ...(pending.handoffPath ? [`A durable copy of this handoff is on disk at ${pending.handoffPath}.`] : []),
    "",
    pending.handoff,
  ].join("\n");
}

function buildSmartCompactionDetails(pending: PendingSmartCompactionState): Record<string, unknown> {
  return {
    source: "pi-smart-compact",
    tool: SMART_COMPACT_TOOL_NAME,
    smartCompactionId: pending.id,
    smart_compact: {
      id: pending.id,
      startedAt: pending.startedAt,
      ...(pending.handoffPath ? { handoffPath: pending.handoffPath } : {}),
    },
  };
}

function isValidCompactionPreparation(preparation: SessionBeforeCompactEvent["preparation"] | undefined): preparation is SessionBeforeCompactEvent["preparation"] {
  return (
    typeof preparation?.firstKeptEntryId === "string" &&
    preparation.firstKeptEntryId.length > 0 &&
    typeof preparation.tokensBefore === "number" &&
    Number.isFinite(preparation.tokensBefore)
  );
}

function getSmartCompactionIdFromDetails(details: unknown): string | undefined {
  if (!isRecord(details)) {
    return undefined;
  }

  if (typeof details.smartCompactionId === "string") {
    return details.smartCompactionId;
  }

  const nested = details.smart_compact;
  if (isRecord(nested) && typeof nested.id === "string") {
    return nested.id;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function monitorContextUsage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: SmartBoundaryConfigStore,
  runtimeState: SmartCompactRuntimeState,
): Promise<void> {
  // A pending compaction that never completed and never errored would otherwise
  // wedge the extension for the rest of the session: escalation returns early
  // on every turn and every later smart_compact refuses. Sweep it first, so the
  // guard below only ever holds for a compaction that is genuinely in flight.
  const stale = findStalePendingSmartCompaction(runtimeState);
  if (stale) {
    expirePendingSmartCompaction(runtimeState, stale.id);
    resetEscalationState(runtimeState);
    notifyIfAvailable(ctx, "Smart compaction never completed and was cleared; escalation warnings are active again.", "warning");
  }

  // Nagging the agent while its own compaction is in flight only trains it to
  // ignore the warnings.
  if (getPendingSmartCompaction(runtimeState)) {
    return;
  }

  let usage;

  try {
    usage = ctx.getContextUsage();
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compact monitoring could not read context usage: ${errorMessage(error)}`, "warning");
    return;
  }

  const tokens = usage?.tokens;
  if (tokens === null || tokens === undefined) {
    return;
  }

  let boundaryTokens: number;
  let intervalTokens: number;
  try {
    const current = await config.read();
    boundaryTokens = current.boundaryTokens;
    intervalTokens = current.intervalTokens;
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compact monitoring could not read boundary config: ${errorMessage(error)}`, "warning");
    return;
  }

  // pi's native failsafe fires at contextWindow - reserveTokens, which on a
  // 200k-window model is about 183.6k: below the default 200k and 240k rungs,
  // so those bands could never fire. Compress the ladder to fit under it.
  const schedule = clampEscalationSchedule({ boundaryTokens, intervalTokens, contextWindow: usage?.contextWindow });

  syncEscalationSettings(runtimeState, schedule.boundaryTokens, schedule.intervalTokens);
  const band = calculateEscalationBand({
    tokens,
    boundaryTokens: schedule.boundaryTokens,
    intervalTokens: schedule.intervalTokens,
  });
  // Back under the boundary, as after a `prune`, the ladder starts over; a
  // compaction resets it on its own event, a prune emits none.
  if (band === undefined) {
    runtimeState.highestEscalationBandSent = -1;
    return;
  }
  if (!isHigherEscalationBand(band, runtimeState.highestEscalationBandSent)) {
    return;
  }

  const prunedTokens = estimatePrunedContext(ctx);
  const message = buildEscalationPrompt({
    tokens,
    boundaryTokens: schedule.boundaryTokens,
    band,
    intervalTokens: schedule.intervalTokens,
    prunedTokens,
  });

  try {
    await Promise.resolve(pi.sendUserMessage(message, { deliverAs: "steer" }));
    markEscalationBandSent(runtimeState, band);
    if (shouldRecommendPrune(prunedTokens, schedule.boundaryTokens)) {
      notifyIfAvailable(ctx, `Context at ${formatTokens(tokens)} tokens: a prune would leave about ${formatTokens(prunedTokens)}.`, "info");
    }
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compact monitoring could not deliver steering warning: ${errorMessage(error)}`, "warning");
  }
}

/**
 * What the `prune` tool would leave, run only when a rung is about to be sent.
 * It prunes what the model sees now (the context projection), not the history
 * before a compaction. Undefined on any failure (or a context without a
 * session file, as in the test mocks), which keeps the plain smart_compact rungs.
 */
function estimatePrunedContext(ctx: ExtensionContext): number | undefined {
  try {
    const parentPath = ctx.sessionManager.getSessionFile();
    if (!parentPath) return undefined;
    const entries = ctx.sessionManager.buildSessionProjection().entries.map((p) => p.sourceEntry);
    return estimatePrunedTokens(entries as never, { parentPath }).tokens;
  } catch {
    return undefined;
  }
}

function notifyIfAvailable(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI === false) {
    return;
  }

  try {
    ctx.ui?.notify?.(message, level);
  } catch {
    // Monitoring must never break future turns because notification delivery failed.
  }
}

/**
 * Surface the native-threshold interaction in `/smart-boundary`, on show and
 * right after either set, which is the moment a misleading confirmation would
 * otherwise be sent. Covers both the runtime clamp and the harder case of a
 * boundary at or above the threshold, which the clamp deliberately leaves
 * alone.
 */
function withNativeThresholdNote(
  ctx: ExtensionCommandContext,
  message: string,
  current: { boundaryTokens: number; intervalTokens: number },
): string {
  const note = describeNativeThresholdNote(ctx, current);
  return note ? `${message}\n${note}` : message;
}

function describeNativeThresholdNote(
  ctx: ExtensionCommandContext,
  current: { boundaryTokens: number; intervalTokens: number },
): string | undefined {
  let contextWindow: number | null | undefined;
  try {
    contextWindow = ctx.getContextUsage()?.contextWindow;
  } catch {
    return undefined;
  }

  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined;
  }

  const nativeThreshold = contextWindow - NATIVE_COMPACTION_RESERVE_TOKENS;
  if (nativeThreshold <= current.boundaryTokens) {
    return [
      `Warning: on this model (context window ${formatTokens(contextWindow)}) pi's native auto-compaction fires near ${formatTokens(nativeThreshold)}, at or below the configured boundary.`,
      "The escalation ladder will never fire here; the native failsafe compacts first with a generic summary. Lower the boundary to get cooperative compaction back.",
    ].join("\n");
  }

  const schedule = clampEscalationSchedule({
    boundaryTokens: current.boundaryTokens,
    intervalTokens: current.intervalTokens,
    contextWindow,
  });
  if (!schedule.clamped) {
    return undefined;
  }

  return [
    `Note: on this model (context window ${formatTokens(contextWindow)}) pi's native auto-compaction fires near ${formatTokens(nativeThreshold)}, below the configured top rungs.`,
    `The escalation interval is clamped to ${formatTokens(schedule.intervalTokens)} at runtime; effective rungs: ${describeRungs(schedule.boundaryTokens, schedule.intervalTokens)}.`,
  ].join("\n");
}

function describeCurrentSettings(current: {
  boundaryTokens: number;
  intervalTokens: number;
  source: "default" | "custom";
  intervalSource: "default" | "custom";
  warning?: string;
}): string {
  const boundaryPrefix = current.source === "default" ? "the default" : "";
  const intervalPrefix = current.intervalSource === "default" ? "the default" : "";
  const lines = [
    `Current smart boundary is ${joinLabel(boundaryPrefix, formatTokens(current.boundaryTokens))}.`,
    `Current escalation interval is ${joinLabel(intervalPrefix, formatTokens(current.intervalTokens))}.`,
    `Escalation rungs: ${describeRungs(current.boundaryTokens, current.intervalTokens)}.`,
  ];

  return current.warning ? [...lines, `Warning: ${current.warning}`].join("\n") : lines.join("\n");
}

function describeRungs(boundaryTokens: number, intervalTokens: number): string {
  return [0, 1, 2, 3].map((band) => formatTokens(boundaryTokens + band * intervalTokens)).join(", ") + ", and beyond";
}

function joinLabel(prefix: string, value: string): string {
  return prefix ? `${prefix} ${value}` : value;
}

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString("en-US")} tokens`;
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): string | undefined {
  if (typeof ctx.ui?.notify === "function") {
    ctx.ui.notify(message, level);
    return undefined;
  }

  return message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
