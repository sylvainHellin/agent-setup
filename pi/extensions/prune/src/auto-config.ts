/**
 * Tunables and the bus contract of the automatic prune (src/auto.ts), kept
 * free of imports so smart-compact can read them without compiling the
 * transform. Values from the plan of 21 Nov 2026; tune them after the trial.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Context estimate above which the automatic prune is considered (smart-compact's boundary). */
export const AUTO_PRUNE_START_TOKENS = 120_000;
/** At or above this, prune without waiting for a seam; pi's native compaction sits near 184k. */
export const AUTO_PRUNE_CEILING_TOKENS = 160_000;
/** A prune that leaves more than this recovered less than half: smart-compact asks for a handoff. */
export const AUTO_PRUNE_FALLBACK_TOKENS = 60_000;
/** The most recent tokens of the branch that every automatic prune leaves whole. */
export const AUTO_PRUNE_TAIL_TOKENS = 20_000;
/** anthropic-max uses the 5-minute ephemeral cache; past this gap the next request rewrites it all. */
export const AUTO_PRUNE_COLD_MS = 300_000;
/**
 * A prune that saves less than this is skipped (and reported as no gain):
 * it would rewrite the cache from its first change for almost nothing, and it
 * keeps a context whose tail alone sits above the start from re-pruning every step.
 */
export const AUTO_PRUNE_MIN_GAIN_TOKENS = 10_000;
/** "Text without edits" counts as a seam from this many chars of text (signal S3 of the research). */
export const AUTO_PRUNE_SEAM_TEXT_CHARS = 80;
/** Billed tokens per visible thinking char, measured over the logged sessions. */
export const THINKING_TOKENS_PER_CHAR = 0.57;
/** pi.events channel: prune announces itself ("active") and each outcome ("pruned", "no-gain"). */
export const AUTO_PRUNE_EVENT = "prune:auto";

/** `PI_AUTO_PRUNE=0` turns the automatic prune off (the tool, `/prune` and the advisory stay). */
export function autoPruneEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_AUTO_PRUNE !== "0";
}

/** Where each automatic prune appends one JSON line; `PI_AUTO_PRUNE_LOG` overrides it for tests. */
export function autoPruneLogPath(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_AUTO_PRUNE_LOG || join(homedir(), ".pi", "agent", "auto-prune.log.jsonl");
}

export type AutoTrigger = "cold" | "seam" | "ceiling";
export type Seam = "user-message" | "turn-end" | "commit" | "tests" | "text";

/** What smart-compact receives on AUTO_PRUNE_EVENT. */
export type AutoPruneEvent =
	| { type: "active"; sessionId: string }
	| { type: "pruned"; sessionId: string; trigger: AutoTrigger; tokensBefore: number | null; tokensEstimate: number }
	| { type: "no-gain"; sessionId: string; trigger: AutoTrigger; tokensBefore: number | null; reason: string };
