/**
 * Neutralize stale smart-compact steering messages in the replayed LLM context.
 *
 * Why: after a compaction, the kept tail usually still contains the boundary
 * advisory that preceded the `smart_compact` call. On 2026-08-31 Anthropic's
 * `reasoning_extraction` refusal classifier started rejecting every request
 * whose post-compaction window replayed that advisory: stop_reason "refusal",
 * zero content, deterministic on retry, unrecoverable without rewinding the
 * session. Replay bisection (probes P1-P8 plus a control, see the
 * wording-constraint note in ./prompts.ts) isolated the advisory as the
 * trigger and showed that softer wording alone does not clear it.
 *
 * Replace, do not remove: deleting the advisory user message makes the two
 * neighboring assistant messages adjacent, and that reshaped request still
 * refused (probes P7/P8). Replacing the text in place with one neutral line
 * kept the full original preamble and continuation and passed (probe A), so
 * the placeholder below is the probe-verified wording.
 *
 * Staleness: any steering message at or before the latest compaction summary.
 * Escalation state resets on every compaction, so those messages carry no
 * information the summary/handoff does not. A fresh advisory sent after the
 * compaction still steers the agent and is kept verbatim.
 */

import { SMART_COMPACT_STEERING_PREFIXES } from "./prompts.js";

/** Probe-verified replacement text (probe A, 2026-09-01): keep it one short
 *  line and free of summarize-your-work language. */
export const STALE_STEERING_PLACEHOLDER = "(Context-pressure reminder resolved by the later compaction.)";

type ContextMessage = {
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
};

/**
 * Returns the message list with stale steering texts replaced, or undefined
 * when nothing changed so the caller can leave the context event untouched.
 */
export function neutralizeStaleSteeringMessages<T extends ContextMessage>(messages: T[]): T[] | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  const lastCompactionAt = latestCompactionTimestamp(messages);
  if (lastCompactionAt === undefined) {
    return undefined;
  }

  let changed = false;
  const neutralized = messages.map((message) => {
    if (!isStaleSteeringMessage(message, lastCompactionAt)) {
      return message;
    }
    changed = true;
    return { ...message, content: [{ type: "text", text: STALE_STEERING_PLACEHOLDER }] };
  });
  return changed ? neutralized : undefined;
}

function latestCompactionTimestamp(messages: ContextMessage[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    if (message?.role !== "compactionSummary") {
      continue;
    }
    const ts = typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : 0;
    latest = latest === undefined ? ts : Math.max(latest, ts);
  }
  return latest;
}

function isStaleSteeringMessage(message: ContextMessage, lastCompactionAt: number): boolean {
  if (message?.role !== "user") {
    return false;
  }

  const text = extractText(message.content);
  if (text === undefined || !SMART_COMPACT_STEERING_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return false;
  }

  // A steering message we cannot date counts as stale: replaying it risks the
  // refusal that bricks the session, while neutralizing it costs one reminder
  // that the escalation ladder will re-send at the next band.
  const ts = typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : undefined;
  return ts === undefined || ts <= lastCompactionAt;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  return first?.type === "text" && typeof first.text === "string" ? first.text : undefined;
}
