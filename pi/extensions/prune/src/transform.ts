/**
 * Pure transform behind `/prune`: turns the entries of a session branch into
 * a reduced copy for a new session. No pi runtime imports, so tests can run it
 * on real session files; smart-compact's prompts.ts imports only its constants.
 */

import { SMART_COMPACT_INJECTED_PREFIXES } from "../../smart-compact/src/prompts.js";

export const TOOL_ARG_MAX = 120;
export const TOOL_RESULT_MAX = 200;
export const CUSTOM_MAX = 600;
export const NOTICE_TYPE = "prune:notice";
export const NOTICE_TAG = "[prune notice]";

/**
 * Harness notices smart-compact injects as plain user messages
 * (SMART_COMPACT_INJECTED_PREFIXES), cut like tool output: they are stale once
 * pruned and would otherwise stay verbatim.
 */
const HARNESS_MAX = 100;

/** Characters pi's own estimator charges for one image (1200 tokens x 4). */
const IMAGE_CHARS = 4800;
const IMAGE_OMITTED = "[image omitted]";
/** Ends a cut tool-call argument; `sid` names the session holding the uncut call. */
function argMark(entryId: string, sid: string): string {
	return `[truncated, entry ${entryId} in ${sid}]`;
}
const ARG_MARK_END = /\[truncated, entry [\w-]+ in [^\]]+\]$/;

/** Where a tool call was made: its assistant entry, session short id and uncut arguments. */
export interface CallOrigin {
	entryId: string;
	sid: string;
	args: unknown;
}

type Block = { type: string; [k: string]: unknown };
type Msg = { role: string; content?: unknown; timestamp?: number; [k: string]: unknown };

/** The subset of a session entry the transform reads. */
export type BranchEntry = {
	type: string;
	id: string;
	message?: Msg;
	customType?: string;
	content?: unknown;
	display?: boolean;
	details?: unknown;
	summary?: string;
	fromId?: string | null;
	fromHook?: boolean;
};

/** `sourceId` names the branch entry an item was cut from, which the in-place prune edits. */
export type PrunedItem = { sourceId?: string } & (
	| { kind: "message"; message: Msg }
	| { kind: "custom_message"; customType: string; content: string | Block[]; display: boolean; details?: unknown }
	| { kind: "branch_summary"; summary: string; details?: unknown; fromHook?: boolean }
);

export interface PruneOptions {
	parentPath: string;
	toolArgMax?: number;
	toolResultMax?: number;
	customMax?: number;
	/** Uncut tool calls by id, found in the chain's session files; cut args point there. */
	callOrigins?: Map<string, CallOrigin>;
	/** The parent session file first, then its own parent sessions, oldest last. */
	sessionChain?: string[];
	/** Files changed by the session's commits (subagent work, deletions), resolved by the caller. */
	extraModified?: string[];
	/** The model-called prune edits this session's context instead of copying it; changes the notice wording. */
	inPlace?: boolean;
}

export interface PruneResult {
	items: PrunedItem[];
	notice: { customType: string; content: string; display: boolean; details: PruneNoticeDetails };
	stats: PruneStats;
	/** Assistant entries left empty once thinking is gone; the in-place prune omits them. */
	droppedIds: string[];
}

export interface PruneNoticeDetails {
	parentSession: string;
	filesModified: string[];
	filesRead: string[];
	charsBefore: number;
	charsAfter: number;
	/** pi's context size of the parent branch when it was pruned, if known. */
	tokensBefore?: number | null;
	/** What src/estimate.ts predicted for the first request, checked against `prune:measured`. */
	tokensEstimate?: number | null;
	/** Written by the `prune` tool, which edits the context of the session it runs in. */
	inPlace?: boolean;
}

export interface PruneStats {
	charsBefore: number;
	charsAfter: number;
	thinkingBlocksDropped: number;
	toolResultsTruncated: number;
	toolArgsTruncated: number;
	assistantDropped: number;
	entriesSkipped: number;
}

/** Minimal SessionManager surface used to write the pruned copy. */
export interface PrunedSessionWriter {
	appendMessage(message: never): string;
	appendCustomMessageEntry(customType: string, content: never, display: boolean, details?: unknown): string;
	branchWithSummary(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean): string;
	getLeafId(): string | null;
}

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function blocksOf(content: unknown): Block[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? (content as Block[]) : [];
}

function textOf(content: unknown): { text: string; images: number } {
	let text = "";
	let images = 0;
	for (const b of blocksOf(content)) {
		if (b.type === "text" && typeof b.text === "string") text += (text ? "\n" : "") + b.text;
		else if (b.type === "image") images++;
	}
	if (images > 0) text += (text ? "\n" : "") + Array(images).fill(IMAGE_OMITTED).join(" ");
	return { text, images };
}

/** Short id of a session file: the first uuid group after the timestamp. */
export function sessionShortId(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return /_([0-9a-f]{8})-/.exec(name)?.[1] ?? name.replace(/\.jsonl$/, "");
}

/** Which session a new pointer names, and which one a legacy "parent session" pointer meant. */
interface PointerRef {
	sid: string;
	legacySid?: string;
}

/** A pointer ending a cut text; older prunes wrote "in parent session". */
const POINTER_END = /… \[pruned: \d+ chars, entry [\w-]+ in ([^\]]+)\]$/;
const POINTER_ANY = /… \[pruned: \d+ chars, entry [\w-]+ in [^\]]+\]/g;

function pointer(removed: number, entryId: string, sid: string): string {
	return `… [pruned: ${removed} chars, entry ${entryId} in ${sid}]`;
}

/**
 * Cut text to `max` chars plus a pointer to its parent entry. Text an earlier
 * prune already cut within `max` keeps its pointer, so lookups stay one hop.
 */
function cutWithPointer(text: string, max: number, entryId: string, ref: PointerRef): { text: string; cut: boolean } {
	const m = POINTER_END.exec(text);
	if (m && m.index <= max) {
		if (m[1] !== "parent session" || !ref.legacySid) return { text, cut: false };
		return { text: text.slice(0, m.index) + m[0].replace("in parent session", `in ${ref.legacySid}`), cut: false };
	}
	if (text.length <= max) return { text, cut: false };
	return { text: text.slice(0, max) + pointer(text.length - max, entryId, ref.sid), cut: true };
}

/** Whether a string already ends in an argument mark placed within `max`. */
function alreadyMarked(value: string, max: number): boolean {
	const m = ARG_MARK_END.exec(value);
	return m !== null && m.index <= max + 2;
}

function truncateArgs(value: unknown, max: number, hit: { n: number }, mark = ""): unknown {
	if (typeof value === "string") {
		if (value.length <= max || alreadyMarked(value, max)) return value;
		hit.n++;
		return `${value.slice(0, max)}… ${mark || "[truncated]"}`;
	}
	if (Array.isArray(value)) return value.map((v) => truncateArgs(v, max, hit, mark));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = truncateArgs(v, max, hit, mark);
		return out;
	}
	return value;
}

/** `cd <dir> && ` prefixes keep only the directory's last segment. */
const CD_PREFIX = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;

/**
 * Shorten a bash command for the pruned copy: collapse leading `cd` paths, then
 * keep its start and end, where the command that did the work usually sits.
 */
export function shortenCommand(cmd: string, max: number, hit: { n: number }, mark = ""): string {
	if (alreadyMarked(cmd, max)) return cmd;
	const tag = mark ? ` ${mark}` : "";
	let rest = cmd;
	const dirs: string[] = [];
	for (let m = CD_PREFIX.exec(rest); m; m = CD_PREFIX.exec(rest)) {
		const dir = m[1].replace(/^["']|["']$/g, "").replace(/\/+$/, "");
		dirs.push(`cd …/${dir.slice(dir.lastIndexOf("/") + 1)} && `);
		rest = rest.slice(m[0].length);
	}
	const short = dirs.join("") + rest;
	if (short.length <= max) {
		if (short === cmd) return short;
		hit.n++;
		return short + tag;
	}
	hit.n++;
	const gap = " … ";
	const head = Math.ceil((max - gap.length) * 0.6);
	const tail = max - gap.length - head;
	return short.slice(0, head) + gap + short.slice(short.length - tail) + tag;
}

/** A commit hash at the start of a line: `[branch abc1234] msg` (git commit) or `abc1234 msg` (git log --oneline). */
const COMMIT_LINE = /^(?:\[[^\]\n]*?\s)?([0-9a-f]{7,40})\]?\s/gm;

/**
 * Short commit hashes from the output of committing shell commands (line-start
 * hashes only) and from subagent reports. Prune pointers are removed first, so
 * their entry ids never pass for commits.
 */
export function collectCommitHashes(entries: BranchEntry[]): string[] {
	const commands = new Map<string, string>();
	const hashes = new Set<string>();
	for (const entry of entries) {
		const msg = entry.type === "message" ? entry.message : undefined;
		if (msg?.role === "assistant") {
			for (const b of blocksOf(msg.content)) {
				const command = (b.arguments as { command?: unknown } | undefined)?.command;
				if (b.type === "toolCall" && typeof command === "string") commands.set(String(b.id), command);
			}
		} else if (msg?.role === "toolResult") {
			const command = commands.get(String(msg.toolCallId)) ?? "";
			const subagent = msg.toolName === "Agent" || msg.toolName === "get_subagent_result";
			if (!subagent && !/\bgit\b[^|;]*\bcommit\b/.test(command)) continue;
			const text = textOf(msg.content).text.replace(POINTER_ANY, "");
			const found = subagent
				? (text.match(/\b[0-9a-f]{7,40}\b/g) ?? [])
				: [...text.matchAll(COMMIT_LINE)].map((m) => m[1]);
			for (const h of found) {
				if (/[a-f]/.test(h) && /\d/.test(h)) hashes.add(h);
			}
		}
	}
	return [...hashes];
}

/** LLM-visible characters of a message, images charged like pi's estimator. */
export function messageChars(msg: Msg): number {
	switch (msg.role) {
		case "bashExecution":
			return String(msg.command ?? "").length + String(msg.output ?? "").length;
		case "branchSummary":
		case "compactionSummary":
			return String(msg.summary ?? "").length;
		default: {
			let n = 0;
			for (const b of blocksOf(msg.content)) {
				if (b.type === "text") n += String(b.text ?? "").length;
				else if (b.type === "thinking") n += String(b.thinking ?? "").length;
				else if (b.type === "toolCall") n += String(b.name ?? "").length + JSON.stringify(b.arguments ?? {}).length;
				else if (b.type === "image") n += IMAGE_CHARS;
			}
			return n;
		}
	}
}

function itemChars(item: PrunedItem): number {
	if (item.kind === "message") return messageChars(item.message);
	if (item.kind === "branch_summary") return item.summary.length;
	return messageChars({ role: "custom", content: item.content });
}

/** LLM-visible characters of a branch entry; entries the model never sees count 0. */
export function entryChars(entry: BranchEntry): number {
	if (entry.type === "message" && entry.message && entry.message.role !== "system") return messageChars(entry.message);
	if (entry.type === "custom_message") return messageChars({ role: "custom", content: entry.content });
	if (entry.type === "branch_summary") return String(entry.summary ?? "").length;
	return 0;
}

function pruneCustom(content: unknown, max: number, entryId: string, ref: PointerRef): string | Block[] {
	if (typeof content === "string") return cutWithPointer(content, max, entryId, ref).text;
	const { text } = textOf(content);
	return [{ type: "text", text: cutWithPointer(text, max, entryId, ref).text }];
}

/**
 * Reduce a branch (root to leaf, as `getBranch()` returns it) to the items of
 * a new session plus a closing notice. Compaction, system, model and thinking
 * level entries are skipped; the full pre-compaction history is kept.
 */
export function pruneBranch(entries: BranchEntry[], opts: PruneOptions): PruneResult {
	const argMax = opts.toolArgMax ?? TOOL_ARG_MAX;
	const resultMax = opts.toolResultMax ?? TOOL_RESULT_MAX;
	const customMax = opts.customMax ?? CUSTOM_MAX;
	const chain = opts.sessionChain?.length ? opts.sessionChain : [opts.parentPath];
	const ref: PointerRef = {
		sid: sessionShortId(chain[0]),
		legacySid: chain[1] ? sessionShortId(chain[1]) : undefined,
	};
	const items: PrunedItem[] = [];
	const droppedIds: string[] = [];
	const modified: string[] = [];
	const read: string[] = [];
	const inherited: string[] = [];
	const stats: PruneStats = {
		charsBefore: 0,
		charsAfter: 0,
		thinkingBlocksDropped: 0,
		toolResultsTruncated: 0,
		toolArgsTruncated: 0,
		assistantDropped: 0,
		entriesSkipped: 0,
	};

	for (const entry of entries) {
		stats.charsBefore += entryChars(entry);
		const before = items.length;
		takeEntry(entry);
		for (let i = before; i < items.length; i++) items[i].sourceId = entry.id;
	}

	function takeEntry(entry: BranchEntry): void {

		if (entry.type === "custom_message" && entry.customType === NOTICE_TYPE) {
			// An earlier prune's notice: its file lists move into the new notice.
			const d = entry.details as Partial<PruneNoticeDetails> | undefined;
			inherited.push(...(d?.filesModified ?? []));
			read.push(...(d?.filesRead ?? []));
			const from = d?.parentSession ? ` from ${sessionShortId(d.parentSession)}` : "";
			items.push({
				kind: "custom_message",
				customType: NOTICE_TYPE,
				content: `${NOTICE_TAG} An earlier prune${from}; its file lists are merged into the latest notice.`,
				display: entry.display ?? true,
				details: entry.details,
			});
			return;
		}
		if (entry.type === "custom_message") {
			items.push({
				kind: "custom_message",
				customType: String(entry.customType ?? "custom"),
				content: pruneCustom(entry.content, customMax, entry.id, ref),
				display: entry.display ?? true,
				details: entry.details,
			});
			return;
		}
		if (entry.type === "branch_summary") {
			items.push({
				kind: "branch_summary",
				summary: String(entry.summary ?? ""),
				details: { ...(entry.details as object | undefined), prunedFromId: entry.fromId ?? null },
				fromHook: entry.fromHook,
			});
			return;
		}
		const msg = entry.type === "message" ? entry.message : undefined;
		if (!msg) {
			stats.entriesSkipped++;
			return;
		}

		switch (msg.role) {
			case "user": {
				const text = textOf(msg.content).text;
				if (SMART_COMPACT_INJECTED_PREFIXES.some((p) => text.startsWith(p))) {
					const cut = cutWithPointer(text, HARNESS_MAX, entry.id, ref).text;
					items.push({ kind: "message", message: { ...msg, content: [{ type: "text", text: cut }] } });
					break;
				}
				const content =
					typeof msg.content === "string"
						? msg.content
						: blocksOf(msg.content).map((b) => (b.type === "image" ? { type: "text", text: IMAGE_OMITTED } : b));
				items.push({ kind: "message", message: { ...msg, content } });
				break;
			}
			case "assistant": {
				const content: Block[] = [];
				for (const b of blocksOf(msg.content)) {
					if (b.type === "thinking" || b.type === "redacted_thinking") {
						stats.thinkingBlocksDropped++;
					} else if (b.type === "toolCall") {
						const hit = { n: 0 };
						// Cut from the uncut original when an earlier session holds it, and point there.
						const origin = opts.callOrigins?.get(String(b.id)) ?? { entryId: entry.id, sid: ref.sid, args: b.arguments };
						const mark = argMark(origin.entryId, origin.sid);
						const { command, ...rest } = (origin.args ?? {}) as Record<string, unknown>;
						const args = truncateArgs(rest, argMax, hit, mark) as Record<string, unknown>;
						const shell = b.name === "bash" && typeof command === "string";
						if (command !== undefined)
							args.command = shell ? shortenCommand(command, argMax, hit, mark) : truncateArgs(command, argMax, hit, mark);
						content.push({ ...b, arguments: args });
						stats.toolArgsTruncated += hit.n;
						const path = (b.arguments as { path?: unknown } | undefined)?.path;
						if (typeof path === "string" && path) {
							if (b.name === "edit" || b.name === "write") modified.push(path);
							else if (b.name === "read") read.push(path);
						}
					} else {
						content.push(b);
					}
				}
				if (content.length === 0) {
					stats.assistantDropped++;
					droppedIds.push(entry.id);
					break;
				}
				items.push({ kind: "message", message: { ...msg, content, usage: ZERO_USAGE } });
				break;
			}
			case "toolResult": {
				const { text } = textOf(msg.content);
				const cut = cutWithPointer(text, resultMax, entry.id, ref);
				if (cut.cut) stats.toolResultsTruncated++;
				items.push({
					kind: "message",
					message: {
						role: "toolResult",
						toolCallId: msg.toolCallId,
						toolName: msg.toolName,
						content: [{ type: "text", text: cut.text }],
						isError: msg.isError ?? false,
						timestamp: msg.timestamp,
					},
				});
				break;
			}
			case "custom":
				items.push({
					kind: "custom_message",
					customType: String(msg.customType ?? "custom"),
					content: pruneCustom(msg.content, customMax, entry.id, ref),
					display: (msg.display as boolean | undefined) ?? true,
					details: msg.details,
				});
				break;
			case "bashExecution":
				if (msg.excludeFromContext) {
					stats.entriesSkipped++;
					break;
				}
				items.push({
					kind: "message",
					message: { ...msg, output: cutWithPointer(String(msg.output ?? ""), resultMax, entry.id, ref).text },
				});
				break;
			default:
				// system, compactionSummary and branchSummary never reach a new session as messages.
				stats.entriesSkipped++;
		}
	}

	const extra = [...inherited, ...(opts.extraModified ?? [])];
	const deleted = new Set(extra.filter((f) => f.endsWith(" (deleted)")).map((f) => f.slice(0, -10)));
	const filesModified = [...new Set([...modified, ...extra])].filter((f) => !deleted.has(f));
	const modifiedSet = new Set(filesModified.map((f) => f.replace(/ \(deleted\)$/, "")));
	const filesRead = [...new Set(read)].filter((p) => !modifiedSet.has(p));
	const content = buildNoticeText(chain, argMax, resultMax, filesModified, filesRead, opts.inPlace ?? false);

	stats.charsAfter = items.reduce((n, item) => n + itemChars(item), 0) + content.length;
	return {
		items,
		droppedIds,
		notice: {
			customType: NOTICE_TYPE,
			content,
			display: true,
			details: {
				parentSession: opts.parentPath,
				filesModified,
				filesRead,
				charsBefore: stats.charsBefore,
				charsAfter: stats.charsAfter,
			},
		},
		stats,
	};
}

function buildNoticeText(
	chain: string[],
	argMax: number,
	resultMax: number,
	modified: string[],
	read: string[],
	inPlace: boolean,
): string {
	const list = (paths: string[]) => (paths.length ? paths.map((f) => `- ${f}`).join("\n") : "- none");
	const own = inPlace ? " (this session)" : " (parent)";
	const sessions = chain.map((f, i) => `- ${sessionShortId(f)}: ${f}${i === 0 ? own : ""}`);
	return [
		`${NOTICE_TAG} This message comes from the prune extension, not from the user.`,
		inPlace
			? `The context before the prune call was pruned in place; the full entries stay in this session file, ${chain[0]}.`
			: `Context was pruned from the parent session ${chain[0]}.`,
		`Thinking was removed, tool-call string arguments were cut to ${argMax} chars, and tool results to ${resultMax} chars.`,
		`A cut result ends in "[pruned: N chars, entry <entryId> in <sessionId>]", a cut tool-call argument in "[truncated, entry <entryId> in <sessionId>]".`,
		`The session ids map to these files:`,
		...sessions,
		`Print the full entry with:`,
		`jq -c 'select(.id=="<entryId>")' <session file>`,
		"",
		"Files modified (by this session or its commits):",
		list(modified),
		"",
		"Files read:",
		list(read),
	].join("\n");
}

/** Append a prune result to a fresh SessionManager (the `newSession` setup step). */
export function writePruned(sm: PrunedSessionWriter, result: PruneResult): void {
	for (const item of result.items) {
		if (item.kind === "message") sm.appendMessage(item.message as never);
		else if (item.kind === "custom_message")
			sm.appendCustomMessageEntry(item.customType, item.content as never, item.display, item.details);
		else sm.branchWithSummary(sm.getLeafId(), item.summary, item.details, item.fromHook);
	}
	const n = result.notice;
	sm.appendCustomMessageEntry(n.customType, n.content as never, n.display, n.details);
}
