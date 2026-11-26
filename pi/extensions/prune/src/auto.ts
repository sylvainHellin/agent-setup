/**
 * Seam-gated automatic prune.
 *
 * Above the start threshold the harness prunes on its own, from `turn_end`:
 * the tools of the step have run and pi rebuilds the next request from the
 * projection right after, so the edits reach request n+1 as for the `prune`
 * tool. It prunes at once on a cold cache, at a seam on a warm one (turn end,
 * a queued user message, a commit, a test run, text without edits; never
 * right after a read-only step), and at the ceiling regardless. The latest
 * step and about the last 20k tokens stay whole.
 *
 * Pure apart from the log append, so tests run the policy without pi.
 * The thresholds and the bus contract live in src/auto-config.ts, which
 * smart-compact imports.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	AUTO_PRUNE_COLD_MS,
	AUTO_PRUNE_MIN_GAIN_TOKENS,
	AUTO_PRUNE_SEAM_TEXT_CHARS,
	AUTO_PRUNE_START_TOKENS,
	AUTO_PRUNE_CEILING_TOKENS,
	AUTO_PRUNE_TAIL_TOKENS,
	type AutoTrigger,
	autoPruneLogPath,
	type Seam,
	THINKING_TOKENS_PER_CHAR,
} from "./auto-config.ts";
import { CHARS_PER_TOKEN, tokensAfterPrune } from "./estimate.ts";
import { buildContextEdits, type ContextEditDraft, type ProjectedEntry } from "./inplace.ts";
import { visibleThinkingChars } from "./thinking.ts";
import { messageChars, type PruneOptions, type PruneResult, pruneBranch } from "./transform.ts";

export * from "./auto-config.ts";

type Block = { type: string; name?: unknown; text?: unknown; arguments?: unknown };
type Msg = { role: string; content?: unknown };

function blocks(message: Msg): Block[] {
	return Array.isArray(message.content) ? (message.content as Block[]) : [];
}

function toolCalls(message: Msg): Block[] {
	return blocks(message).filter((b) => b.type === "toolCall");
}

function bashCommand(call: Block): string | undefined {
	const command = (call.arguments as { command?: unknown } | undefined)?.command;
	return call.name === "bash" && typeof command === "string" ? command : undefined;
}

const COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/;
const TESTS =
	/\b(?:pytest|vitest|jest)\b|\bcargo\s+(?:[\w-]+\s+)*?test\b|\bnode\b[^|;&\n]*\s--test\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b|\bgo\s+test\b/;

/** Tools that only read. */
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
/** Shell commands that only read (cat-like); a `git` segment counts only with a reading subcommand. */
const READ_COMMANDS = new Set(["rg", "fd", "ls", "cat", "bat", "head", "tail", "wc", "tree", "stat", "file", "pwd", "grep", "jq", "cd", "echo"]);
const READ_GIT = new Set(["status", "log", "diff", "show", "blame", "branch", "rev-parse"]);

function readOnlyCommand(command: string): boolean {
	const segments = command
		.split(/&&|\|\||[;|\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (segments.length === 0) return false;
	return segments.every((segment) => {
		const words = segment.split(/\s+/);
		const head = words[0].replace(/^.*\//, "");
		if (head === "git") {
			const sub = words.slice(1).find((w, i, all) => !w.startsWith("-") && all[i - 1] !== "-C");
			return sub !== undefined && READ_GIT.has(sub);
		}
		if (head === "sed") return words.includes("-n") && !words.some((w) => w.startsWith("-i"));
		return READ_COMMANDS.has(head);
	});
}

/** Whether every call of the step only read: read, search and cat-like bash. A step without calls is not. */
export function isReadOnlyStep(message: Msg): boolean {
	const calls = toolCalls(message);
	if (calls.length === 0) return false;
	return calls.every((call) => {
		if (READ_TOOLS.has(String(call.name))) return true;
		const command = bashCommand(call);
		return command !== undefined && readOnlyCommand(command);
	});
}

/**
 * The seam the last step ended on, if any: a queued user message, the end of
 * the turn (no tool calls), a git commit or a test run in its bash calls, or
 * text of some length without edit or write calls.
 */
export function stepSeam(message: Msg, opts: { pendingUser?: boolean } = {}): Seam | undefined {
	if (opts.pendingUser) return "user-message";
	const calls = toolCalls(message);
	if (calls.length === 0) return "turn-end";
	const commands = calls.map(bashCommand).filter((c): c is string => c !== undefined);
	if (commands.some((c) => COMMIT.test(c))) return "commit";
	if (commands.some((c) => TESTS.test(c))) return "tests";
	const textChars = blocks(message)
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.reduce((n, b) => n + String(b.text).trim().length, 0);
	const edits = calls.some((c) => c.name === "edit" || c.name === "write");
	if (textChars >= AUTO_PRUNE_SEAM_TEXT_CHARS && !edits) return "text";
	return undefined;
}

/** Whether the prompt cache has expired: no provider request started or ended within the TTL. */
export function isCacheCold(now: number, lastRequestAt: number | undefined, coldMs = AUTO_PRUNE_COLD_MS): boolean {
	return lastRequestAt === undefined || !Number.isFinite(lastRequestAt) || now - lastRequestAt > coldMs;
}

/** The trigger for this request, or undefined to wait one more request. */
export function decideTrigger(input: {
	tokens: number | null | undefined;
	cold: boolean;
	seam: Seam | undefined;
	readOnly: boolean;
}): AutoTrigger | undefined {
	const { tokens } = input;
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < AUTO_PRUNE_START_TOKENS) return undefined;
	if (input.cold) return "cold";
	if (tokens >= AUTO_PRUNE_CEILING_TOKENS) return "ceiling";
	if (input.readOnly) return undefined;
	return input.seam ? "seam" : undefined;
}

/** Estimated tokens of what the model sees of one projected entry. */
export function projectedTokens(p: ProjectedEntry): number {
	let tokens = 0;
	for (const m of p.messages as Msg[]) {
		const thinking = visibleThinkingChars(m as never);
		tokens += (messageChars(m as never) - thinking) / CHARS_PER_TOKEN + thinking * THINKING_TOKENS_PER_CHAR;
	}
	return tokens;
}

function isRole(p: ProjectedEntry, role: string): boolean {
	return p.sourceEntry.type === "message" && p.sourceEntry.message?.role === role;
}

/**
 * Index of the first projected entry the prune leaves whole: never after the
 * latest assistant message, and early enough that the tail holds about
 * `tailTokens`. A tail never opens on a tool result, so a call and its result
 * stay on the same side.
 */
export function tailStart(projected: ProjectedEntry[], lastAssistantId: string, tailTokens = AUTO_PRUNE_TAIL_TOKENS): number {
	let from = projected.findIndex((p) => p.sourceEntry.id === lastAssistantId);
	if (from < 0) from = projected.findLastIndex((p) => isRole(p, "assistant"));
	if (from < 0) return 0;
	let acc = 0;
	for (let i = from; i < projected.length; i++) acc += projectedTokens(projected[i]);
	while (from > 0 && acc < tailTokens) {
		from--;
		acc += projectedTokens(projected[from]);
	}
	while (from > 0 && isRole(projected[from], "toolResult")) from--;
	return from;
}

export type AutoPrunePlan =
	| {
			ok: true;
			edits: ContextEditDraft[];
			result: PruneResult;
			/** Index of the first projected entry left whole. */
			tailFrom: number;
			tokensEstimate: number;
	  }
	| { ok: false; reason: string; tokensEstimate?: number };

/**
 * Run the in-place transform over everything before the tail. Each prune cuts
 * from the raw source entries (src/inplace.ts), so entries an earlier prune
 * covered come out byte-identical and get no edit: a repeat prune only changes
 * what lies after the earlier one's covered range, plus the earlier notice,
 * which shrinks to one line.
 */
export function planAutoPrune(
	projected: ProjectedEntry[],
	input: {
		lastAssistantId: string;
		tokensBefore: number | null | undefined;
		trigger: AutoTrigger;
		prune: PruneOptions;
		tailTokens?: number;
	},
): AutoPrunePlan {
	const tailTokens = input.tailTokens ?? AUTO_PRUNE_TAIL_TOKENS;
	const tailFrom = tailStart(projected, input.lastAssistantId, tailTokens);
	const covered = projected.slice(0, tailFrom);
	if (covered.length === 0) return { ok: false, reason: "nothing before the tail" };
	const entries = covered.map((p) => p.sourceEntry);
	const result = pruneBranch(entries, { ...input.prune, inPlace: true, auto: { trigger: input.trigger, tailTokens } });
	const edits = buildContextEdits(covered, result);
	if (edits.length === 0) return { ok: false, reason: "everything before the tail is already pruned" };
	const tail = projected.slice(tailFrom).reduce((n, p) => n + projectedTokens(p), 0);
	const tokensEstimate = Math.round(tokensAfterPrune(entries, result.stats.charsAfter).tokens + tail);
	const before = input.tokensBefore;
	if (typeof before === "number" && before - tokensEstimate < AUTO_PRUNE_MIN_GAIN_TOKENS) {
		return { ok: false, reason: `a prune would save under ${AUTO_PRUNE_MIN_GAIN_TOKENS / 1000}k tokens`, tokensEstimate };
	}
	return { ok: true, edits, result, tailFrom, tokensEstimate };
}

export interface AutoPruneLogInput {
	now: number;
	sessionId: string;
	sessionFile: string;
	trigger: AutoTrigger;
	seam?: Seam;
	subagent: boolean;
	tokensBefore: number | null;
	tokensAfterEstimate: number;
	edits: number;
}

/**
 * One line of the trial log. The real size after the prune is the session's
 * next `prune:measured` entry, found through `sessionFile`.
 */
export function autoPruneLogLine(e: AutoPruneLogInput): string {
	return `${JSON.stringify({
		ts: new Date(e.now).toISOString(),
		sessionId: e.sessionId,
		sessionFile: e.sessionFile,
		trigger: e.trigger,
		...(e.seam ? { seam: e.seam } : {}),
		agent: e.subagent ? "subagent" : "main",
		tokensBefore: e.tokensBefore,
		tokensAfterEstimate: e.tokensAfterEstimate,
		edits: e.edits,
	})}\n`;
}

/** Append a log line; a failed write never stops the prune. */
export function appendAutoPruneLog(line: string, path = autoPruneLogPath()): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, line);
	} catch {
		// The log is for the trial only.
	}
}
