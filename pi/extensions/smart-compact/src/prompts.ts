import { HANDOFF_DIR_SEGMENTS } from "./constants.js";

export const HANDOFF_DIR_LABEL = `${HANDOFF_DIR_SEGMENTS.join("/")}/`;

export const SMART_COMPACT_HANDOFF_ITEMS = [
  "Current task / atomic stopping point",
  "Progress completed",
  "Decisions / rationale",
  "Files and artifacts",
  "Validation",
  "Risks / blockers",
  "Next steps",
];

export const SMART_COMPACT_HANDOFF_GUIDANCE = [
  "progress/current task state and where the current atomic task stopped",
  "progress completed",
  "decisions made and important rationale",
  "relevant files and saved artifacts",
  "validation status, including tests or checks run and any not run",
  "remaining risks or blockers",
  "concrete next steps for the continuation",
].join("; ");

/**
 * Markdown headings rather than bare `Label:` lines: in the logged corpus the
 * handoffs written as real headings cited 12 to 13 distinct paths and stayed
 * pointer-shaped, while bare label lines correlated with 3 to 6 paths and
 * paragraph-long commit narration. Headings also survive into the durable
 * `.agents/handoff/` file, which is itself Markdown.
 */
export const SMART_COMPACT_HANDOFF_TEMPLATE = SMART_COMPACT_HANDOFF_ITEMS.map((item) => `## ${item}`).join("\n");

/**
 * SelfCompact-style timing rubric (arXiv 2606.23525): an agent-invoked compaction
 * tool only beats fixed-threshold summarization when the model is told when to
 * fire and when to hold. The evidence requirement is the paper's central
 * ablation: the same tool scores 41.0 without it and 46.4 with it on agentic
 * search, because "a unit just finished" is otherwise asserted, never checked.
 *
 * Delivery point (changed 2026-08-14 for the startup context budget): the rubric
 * and template ride the band-0 boundary advisory and the manual request, not the
 * always-on tool guidelines. The rubric is only actionable once the boundary is
 * near, and the advisory is guaranteed to precede any auto-compaction, so the
 * static copy was pure startup cost (~900 tokens on every first message).
 *
 * Wording constraint (2026-08-31): the previous phrasing ("quote the verbatim
 * evidence", "unsaved state that exists only in this context. Write that state
 * to a file") sat in the kept window of every post-compaction request and
 * tripped Anthropic's `reasoning_extraction` refusal classifier: the request
 * ended with stop_reason "refusal" and zero content, deterministically, on
 * every smart compaction from 2026-08-31 ~15:00 onward. Replay bisection
 * (P1-P5, /tmp/probe-smart-compact.py that day) isolated the trigger to this
 * advisory's text. Keep the rubric free of instructions that read like dumping
 * or duplicating model output: no "quote/verbatim", no "state that exists only
 * in this context".
 *
 * Caveat: probe P6 (this reworded advisory inside the otherwise-original
 * failing request) still refused, so softer wording alone is not a fix; the
 * classifier reacts to the advisory's overall summarize-your-work bulk in the
 * replayed window. The durable fix is structural and lives in
 * ./context-filter.ts (change 17): stale steering messages are neutralized in
 * place on the context event, with this rewording kept as defense in depth.
 */
export const SMART_COMPACT_FIRE_RUBRIC =
  "Fire when a sub-task has just wrapped up cleanly or the trajectory is converging, so the handoff can describe a finished unit rather than a half-formed one. Before firing, name the sub-task that just finished and the concrete result that closed it: a passing test, a commit, an answered question. If nothing has closed yet, you are still mid-unit, so hold off.";

export const SMART_COMPACT_SUPPRESS_RUBRIC =
  "Hold off while you are mid-derivation, mid-debugging, or while recent results are not yet saved anywhere; finish the step or save your working files first, then compact.";

/**
 * Compaction pays for itself only if the reclaimed context is then used. Firing
 * as a session ends spends a summarization round trip on context nobody will
 * spend, and it lands the user on a continuation prompt for work that is done.
 * The fire rubric alone reads as "a unit just finished, so fire", which is
 * exactly the shape of the last unit before wrap-up.
 */
export const SMART_COMPACT_WRAPUP_RUBRIC =
  "Compact only when work will continue in this session. If the task is finished, the deliverable is handed over, or the session is wrapping up, do not compact: the reclaimed context would never be used.";

/** Manual `/smart-compact` is an explicit user request, so it omits the wrap-up rubric. */
const RUBRIC_LINES = [SMART_COMPACT_FIRE_RUBRIC, SMART_COMPACT_SUPPRESS_RUBRIC];

const AUTO_RUBRIC_LINES = [...RUBRIC_LINES, SMART_COMPACT_WRAPUP_RUBRIC];

const ARTIFACT_LINE =
  "Save important files or artifacts before compacting. For substantial analysis, review, or debug work, keep a concise report or notes file in the project and include its path in the handoff.";

const DURABLE_COPY_LINE = `The handoff you pass to \`smart_compact\` is also written to ${HANDOFF_DIR_LABEL} in the project, so the continuation keeps a durable copy outside the compaction summary.`;

/**
 * `hide-declarations.ts` leaves `smart_compact` out of every request's tool
 * list, so this message is the only place the model learns the tool exists.
 * The earlier line here, "If `smart_compact` is unavailable in this toolset,
 * return a handoff-style response instead", read as permission to give up:
 * from 19 to 21 Oct 2026 no fresh session called the hidden tool after an
 * advisory, and two told the user it was missing. A direct call does run
 * (verified 16 Oct 2026), so every rung states that and carries the syntax.
 */
const CALLABLE_LINE =
  "`smart_compact` is active and callable even though the tool list leaves its declaration out to save context: call it directly as `smart_compact({ handoff: \"...\" })` and do not conclude it is unavailable.";

/** A bloated handoff defeats the point of compacting, so say what not to write. */
const HANDOFF_BREVITY_LINE =
  "Pointers over prose: name the files, paths, and artifacts the continuation needs rather than retelling what those files already carry.";

/** The SelfCompact break-even, stated as a number the agent can aim at. */
const HANDOFF_BREAK_EVEN_LINE =
  "Aim for a few hundred words of pointers rather than a thousand words of narration.";

/** Escalations fire in already-tight sessions, so rungs 1+ point back instead of repeating. */
const RUBRIC_POINTER_LINE =
  "The fire/suppress rubric and the handoff template were delivered with the first boundary advisory earlier in this conversation; follow them from there when calling `smart_compact` rather than expecting them repeated here.";

const FINAL_ACTION_LINE =
  "Call `smart_compact` alone as the final action/only tool call for this mini-phase, then wait for continuation after compaction: the tool terminates the turn immediately, so any tool call or text queued after it is lost.";

/**
 * First-line prefixes of every steering message this extension sends on the
 * user's behalf (boundary advisory, escalation rungs, manual request). The
 * context filter uses them to recognize and drop stale copies replayed after a
 * compaction; tests assert the built prompts actually start with one of them.
 */
export const SMART_COMPACT_STEERING_PREFIXES = [
  "Smart compaction advisory:",
  "Smart compaction escalation",
  "Manual smart compaction requested by the user.",
];

/**
 * First-line prefixes of every message this extension injects as a user-role
 * message: the steering prompts above plus the post-compaction wake-ups built
 * here and in index.ts (continuation, fallback, failure). The annotate
 * extension uses them to tell these apart from what the user actually typed.
 */
export const SMART_COMPACT_INJECTED_PREFIXES = [
  ...SMART_COMPACT_STEERING_PREFIXES,
  "The conversation was just compacted",
  "The conversation was compacted, but",
  "Smart compaction failed after",
];

export const SMART_COMPACT_PROMPT_SNIPPET =
  "Call `smart_compact` with an agent-authored handoff when you reach a safe compaction boundary.";

/**
 * Deliberately minimal: the fire/suppress/wrap-up rubric, the handoff template,
 * and the break-even all arrive with the band-0 boundary advisory (and the
 * manual request), the only moments they are actionable. See the delivery-point
 * note on SMART_COMPACT_FIRE_RUBRIC.
 */
export const SMART_COMPACT_PROMPT_GUIDELINES = [
  "Call `smart_compact` only after finishing the current atomic task/current unit and saving important files or artifacts; the boundary advisory delivers the timing rubric and handoff template when they become relevant.",
];

/**
 * The message sent on the agent's behalf once compaction completes.
 *
 * A bare "continue" is ambiguous: after compaction the agent sees a summary it
 * did not just write and an instruction with no subject, and the cheapest
 * reading is to restate the handoff or re-explore what the handoff already
 * records. Naming what happened and pointing at the durable copy makes the next
 * step the obvious one.
 */
export function buildPostCompactionContinuationPrompt(handoffPath?: string): string {
  return joinLines([
    "The conversation was just compacted to reclaim context, and it succeeded. The handoff above records where the work stands.",
    // The single most common failure in the logged corpus: `smart_compact`
    // terminates the turn by design, so it returns no tool result, and the
    // agent on the other side reads that absence as a crash. In 15 of 17
    // firings it announced the tool had failed; twice it "retried" and
    // compacted an already-compacted context seconds later. Naming the missing
    // result as the expected shape of success is what defuses that.
    "Your `smart_compact` call above shows no tool result. That is expected and is what success looks like: the tool ends the turn as it compacts, so it can never return one. Do not treat it as a failure, do not call `smart_compact` again to retry, and do not check whether the handoff file exists.",
    handoffPath ? `The durable copy was written to ${handoffPath}.` : undefined,
    "Pick the work back up from its next steps, and do not announce or explain the compaction to the user. Do not restate the handoff, re-summarize the session, or redo finished work; if a detail is missing, read the files the handoff names rather than reconstructing it from memory.",
  ]);
}

export interface EscalationPromptInput {
  tokens: number;
  boundaryTokens: number;
  band: number;
  intervalTokens?: number;
  /** Estimated context after the `prune` tool (prune/src/estimate.ts); undefined keeps the smart_compact rungs. */
  prunedTokens?: number;
}

/**
 * A prune keeps every message with pointers to the cut tool I/O, which is
 * more exact than any written handoff, so it is the first recommendation
 * whenever it leaves enough headroom: at most this share of the boundary
 * (70% by default, adjustable). A second
 * prune only cuts what came after the first, so once pruning stops paying the
 * estimate stays above the gate and the rungs recommend `smart_compact`.
 */
export const PRUNE_GATE_RATIO = 0.7;

export function shouldRecommendPrune(prunedTokens: number | undefined, boundaryTokens: number): prunedTokens is number {
  return (
    typeof prunedTokens === "number" &&
    Number.isFinite(prunedTokens) &&
    prunedTokens > 0 &&
    Number.isFinite(boundaryTokens) &&
    boundaryTokens > 0 &&
    prunedTokens <= PRUNE_GATE_RATIO * boundaryTokens
  );
}

/**
 * The `prune` tool (prune/index.ts) edits this session's context in place and
 * does not end the turn, so the model calls it and goes on. Its declaration is
 * hidden like `smart_compact`'s, so the line says it is callable.
 */
function buildPruneLine(prunedTokens: number, boundaryTokens: number): string {
  const share = Math.round((prunedTokens / boundaryTokens) * 100);
  return [
    `A prune would bring this context to about ${formatTokens(prunedTokens)} tokens (${share}% of the boundary): it drops thinking, cuts tool calls and results to pointers into this session file and keeps every message, so it keeps more detail than a handoff and is the recommended action here instead of \`smart_compact\`.`,
    "`prune` is active and callable even though it is not in your tool list: at the next clean stopping point, call `prune({})` alone, then keep working on the task; it takes effect from the next request and does not end the turn.",
  ].join(" ");
}

export function buildManualSmartCompactRequestPrompt(): string {
  return [
    "Manual smart compaction requested by the user.",
    "Finish the current atomic task/current unit at a natural stopping point. If a short bounded check or file write will materially improve the handoff, complete it first; avoid major new work and do not start a new unit of work.",
    ...RUBRIC_LINES,
    ARTIFACT_LINE,
    "Write a concise handoff covering progress/current task state, stopping point, decisions, files/artifacts, validation, risks, and next steps.",
    `Soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
    DURABLE_COPY_LINE,
    `When ready, call \`smart_compact\` with that handoff. ${FINAL_ACTION_LINE}`,
    CALLABLE_LINE,
  ].join("\n");
}

/**
 * Four distinct rungs, one per band, mapping to 120k / 160k / 200k / 240k+ at
 * the default boundary and interval:
 *
 *   band 0  advisory marker, keep working, full rubric and handoff template
 *   band 1  offload to files or fresh subagents rather than compact
 *   band 2  compacting is the recommended action now
 *   band 3+ strong urgency, compact at the next safe point
 *
 * Only band 0 carries the full rubric and template. Later rungs fire in
 * already-tight sessions, so they stay deltas and point back at the
 * `smart_compact` tool guidelines instead of re-injecting a few hundred tokens.
 */
export function buildEscalationPrompt({ tokens, boundaryTokens, band, intervalTokens, prunedTokens }: EscalationPromptInput): string {
  const tokenContext = `Current estimated context usage is ${formatTokens(tokens)} tokens; the configured smart boundary is ${formatTokens(boundaryTokens)} tokens.`;
  const nextReminder = buildNextReminderLine(boundaryTokens, band, intervalTokens);
  const prune = shouldRecommendPrune(prunedTokens, boundaryTokens) ? buildPruneLine(prunedTokens, boundaryTokens) : undefined;

  if (band <= 0) {
    // The rubric and template still ride along: later rungs point back at
    // them, and a later rung recommends `smart_compact` once pruning stops paying.
    return joinLines([
      "Smart compaction advisory: the context boundary has been crossed.",
      tokenContext,
      nextReminder,
      prune,
      prune
        ? "The `smart_compact` instructions below apply once a later reminder recommends it."
        : "No action is needed yet. Keep working, but treat each stopping point from here on as a candidate for compaction.",
      ...AUTO_RUBRIC_LINES,
      ARTIFACT_LINE,
      "When you do compact, call `smart_compact({ handoff })` with a concise handoff covering progress, stopping point, decisions, files/artifacts, validation, risks, and next steps.",
      HANDOFF_BREVITY_LINE,
      HANDOFF_BREAK_EVEN_LINE,
      `Soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
      DURABLE_COPY_LINE,
      CALLABLE_LINE,
    ]);
  }

  if (prune) {
    return joinLines([
      band >= 3
        ? `Smart compaction escalation level ${band + 1}: strong urgency, a prune is overdue.`
        : `Smart compaction escalation: a prune is the recommended action${band === 2 ? " now" : ""}.`,
      tokenContext,
      nextReminder,
      prune,
      band >= 2 ? "Call `prune({})` at the next safe point, even mid-task." : "Avoid starting major new work in this context until it is pruned.",
    ]);
  }

  if (band === 1) {
    return joinLines([
      "Smart compaction escalation: context pressure is material, prefer offloading over compacting.",
      tokenContext,
      nextReminder,
      `Move findings, notes, and intermediate results out of the conversation and into files, for example under ${HANDOFF_DIR_LABEL}, and delegate the next self-contained chunk of work to a fresh subagent started from a clean context rather than growing this one.`,
      "Compact only if offloading is not possible, or if the current atomic task/current unit is already finished. Avoid starting major new work in this context.",
      RUBRIC_POINTER_LINE,
      CALLABLE_LINE,
    ]);
  }

  if (band === 2) {
    return joinLines([
      "Smart compaction escalation: compacting is now the recommended action.",
      tokenContext,
      nextReminder,
      "Finish only the current atomic task/current unit, then call `smart_compact({ handoff })`. Do not start major new work, future work, or another substantial step; complete only a short bounded check or file write that materially improves the handoff.",
      RUBRIC_POINTER_LINE,
      CALLABLE_LINE,
    ]);
  }

  return joinLines([
    `Smart compaction escalation level ${band + 1}: strong urgency, compact at the very next safe point.`,
    tokenContext,
    nextReminder,
    "Stop expanding scope entirely. Recall over this much context is measurably degraded, and pi's native auto-compaction will eventually fire on its own with a generic summary, which loses more than compacting deliberately now.",
    "Finish the current atomic task/current unit only, avoid all major new work and next-major-step planning, then write the handoff and call `smart_compact({ handoff })` immediately.",
    RUBRIC_POINTER_LINE,
    CALLABLE_LINE,
  ]);
}

/**
 * Naming the next rung lets the agent weigh finishing the current unit against
 * firing now. Silently dropped when the interval is unknown or unusable.
 */
function buildNextReminderLine(boundaryTokens: number, band: number, intervalTokens?: number): string | undefined {
  if (intervalTokens === undefined || !Number.isFinite(intervalTokens) || intervalTokens <= 0) {
    return undefined;
  }

  if (!Number.isFinite(boundaryTokens) || boundaryTokens <= 0 || !Number.isFinite(band) || band < 0) {
    return undefined;
  }

  return `Next reminder at ~${formatTokens(boundaryTokens + (band + 1) * intervalTokens)} tokens.`;
}

function joinLines(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}
