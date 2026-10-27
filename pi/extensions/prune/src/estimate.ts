/**
 * Estimate of the context a prune would leave, without running it.
 * Pure like transform.ts, so smart-compact can import it to pick between
 * recommending the `prune` tool and `smart_compact` at its boundary.
 *
 * Pruned content carries no thinking, whose billed length is what makes
 * chars/4 undercount, but it is dense in paths, ids and JSON: six measured
 * prunes (2026-10-08 to 2026-10-21) gave 1.6 to 2.1 chars per token once the
 * fixed part of the request (system prompt, tools, skills) was taken out.
 */

import { type BranchEntry, entryChars, NOTICE_TYPE, type PruneNoticeDetails, pruneBranch } from "./transform.ts";

export const CHARS_PER_TOKEN = 1.8;
/** Records the first real request size of a pruned session (prune/index.ts). */
export const MEASURED_ENTRY = "prune:measured";
export const BASELINE_MIN = 5_000;
export const BASELINE_MAX = 30_000;
export const BASELINE_FALLBACK = 10_000;

export interface PruneEstimate {
	/** Estimated tokens of the first request after pruning. */
	tokens: number;
	charsAfter: number;
	/** Tokens of the request outside the messages, from this branch's first real usage. */
	baseline: number;
}

type Usage = { input?: number; cacheRead?: number; cacheWrite?: number };
type EstimateEntry = BranchEntry & { data?: unknown };

const usageTokens = (u: Usage | undefined) => (u?.input ?? 0) + (u?.cacheRead ?? 0) + (u?.cacheWrite ?? 0);
/** A compaction summary stays in the context; `pruneBranch` skips it, so it is counted here. */
const summaryChars = (e: EstimateEntry) => (e.type === "compaction" ? String(e.summary ?? "").length : 0);
const clamp = (n: number) => Math.round(Math.min(BASELINE_MAX, Math.max(BASELINE_MIN, n)));

/**
 * The fixed part of a request. A pruned branch has measured it already
 * (`prune:measured` against its notice's chars); an unpruned one gets it from
 * its first reply's usage minus the messages sent before it.
 */
export function estimateBaseline(branch: EstimateEntry[]): number {
	const measured = [...branch].reverse().find((e) => e.type === "custom" && e.customType === MEASURED_ENTRY);
	const notice = [...branch].reverse().find((e) => e.type === "custom_message" && e.customType === NOTICE_TYPE);
	const after = (measured?.data as { tokensAfter?: number } | undefined)?.tokensAfter;
	const chars = (notice?.details as PruneNoticeDetails | undefined)?.charsAfter;
	if (typeof after === "number" && after > 0 && typeof chars === "number") return clamp(after - chars / CHARS_PER_TOKEN);

	let before = 0;
	for (const e of branch) {
		const msg = e.type === "message" ? e.message : undefined;
		if (msg?.role === "assistant") {
			const tokens = usageTokens(msg.usage as Usage | undefined);
			if (tokens > 0) return clamp(tokens - before / CHARS_PER_TOKEN);
		}
		before += entryChars(e) + summaryChars(e);
	}
	return BASELINE_FALLBACK;
}

/**
 * Tokens the context would hold once `entries` are pruned to `charsAfter`.
 * `entries` are the source entries of pi's context projection (what the
 * `prune` tool edits), so a compaction summary in them is added.
 */
export function tokensAfterPrune(entries: EstimateEntry[], charsAfter: number): PruneEstimate {
	const chars = charsAfter + entries.reduce((n, e) => n + summaryChars(e), 0);
	const baseline = estimateBaseline(entries);
	return { tokens: Math.round(baseline + chars / CHARS_PER_TOKEN), charsAfter: chars, baseline };
}

/** Tokens the `prune` tool would leave, by the same transform it runs. */
export function estimatePrunedTokens(entries: EstimateEntry[], opts: { parentPath: string }): PruneEstimate {
	return tokensAfterPrune(entries, pruneBranch(entries, { parentPath: opts.parentPath, inPlace: true }).stats.charsAfter);
}
