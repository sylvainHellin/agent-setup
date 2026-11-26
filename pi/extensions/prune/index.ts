/**
 * prune: deterministic context reduction without an LLM summary.
 *
 * `/prune` copies the current branch into a new session in reduced form
 * (thinking removed, tool arguments and results truncated, pointers back to the
 * untouched parent session file). See src/transform.ts.
 *
 * The `prune` tool, which smart-compact's reminders tell the model to call,
 * runs the same transform on this session's context and commits it as pi
 * `context_edit` entries at the end of the turn, so the next request of the
 * same run is already pruned. See src/inplace.ts.
 *
 * Above 120k tokens the harness also prunes on its own (src/auto.ts): the
 * `turn_end` handler commits the same in-place edits when the cache is cold,
 * when the step ended on a seam (turn end, queued user message, commit, test
 * run, text without edits; never right after a read-only step), or at the
 * 160k ceiling, leaving the latest step and about the last 20k tokens whole.
 * The model sees the usual prune notice, smart-compact hears the outcome on
 * `pi.events` (it holds its advisory back and falls back to it when a prune
 * leaves over 60k), and each prune appends a line to
 * ~/.pi/agent/auto-prune.log.jsonl. Subagents get it too, except on their
 * final answer. `PI_AUTO_PRUNE=0` turns it off.
 *
 * The `context` handler strips thinking from completed turns in batches, and
 * only when that is free: on a cold cache, or on the request right after a
 * prune, which rewrites the cache anyway. See src/thinking.ts.
 */

import type { ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	AUTO_PRUNE_EVENT,
	AUTO_PRUNE_START_TOKENS,
	type AutoPruneEvent,
	appendAutoPruneLog,
	autoPruneEnabled,
	autoPruneLogLine,
	decideTrigger,
	isCacheCold,
	isReadOnlyStep,
	planAutoPrune,
	stepSeam,
} from "./src/auto.ts";
import { CHARS_PER_TOKEN, estimateBaseline, MEASURED_ENTRY, tokensAfterPrune } from "./src/estimate.ts";
import { buildContextEdits, type ContextEditDraft, entriesBeforeCall, type ProjectedEntry } from "./src/inplace.ts";
import { applyThinkingFrontier, FRONTIER_ENTRY, restoreFrontier, THINKING_BATCH_CHARS } from "./src/thinking.ts";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type BranchEntry,
	type CallOrigin,
	collectCommitHashes,
	NOTICE_TYPE,
	type PruneNoticeDetails,
	pruneBranch,
	sessionShortId,
	writePruned,
} from "./src/transform.ts";

const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** `PI_PRUNE_THINKING_BATCH` overrides the batch size, for live tests. */
const BATCH = Number(process.env.PI_PRUNE_THINKING_BATCH) || THINKING_BATCH_CHARS;

type Usage = { input?: number; cacheRead?: number; cacheWrite?: number };
type Entry = { type: string; customType?: string; details?: unknown };
type StepMessage = { role: string; content?: unknown; timestamp?: number };

/** Tools whose own flow owns the context: `smart_compact` compacts next, `prune` commits its own edits. */
const SELF_MANAGED = new Set(["smart_compact", "prune"]);

/**
 * pi-subagents children carry no env marker. Every child's prompt starts with
 * `<active_agent name="..."/>` (append and replace mode); only append mode adds
 * the `<sub_agent_context>` block, so the tag is what catches reviewer, scout,
 * researcher and recall.
 */
function isSubagentSession(ctx: ExtensionContext): boolean {
	try {
		return /<active_agent name=|<sub_agent_context>|operating as a sub-agent/.test(ctx.getSystemPrompt());
	} catch {
		return false;
	}
}

function sessionId(ctx: ExtensionContext): string | undefined {
	try {
		return ctx.sessionManager.getSessionId() || undefined;
	} catch {
		return undefined;
	}
}

function callNames(message: StepMessage): string[] {
	if (!Array.isArray(message.content)) return [];
	return (message.content as { type?: string; name?: unknown }[]).filter((b) => b.type === "toolCall").map((b) => String(b.name));
}

/** Latest assistant timestamp among messages, the start of the request that wrote it. */
function lastAssistantAt(messages: StepMessage[]): number | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "assistant" && typeof m.timestamp === "number") return m.timestamp;
	}
	return undefined;
}

function latest(...ts: (number | undefined)[]): number | undefined {
	const known = ts.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
	return known.length ? Math.max(...known) : undefined;
}

/**
 * The latest prune notice of this branch, unless a `prune:measured` entry
 * after it already reported its real token count. A re-pruned branch holds
 * earlier notices too, each measured once.
 */
function pendingNotice(branch: Entry[]): PruneNoticeDetails | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e.type === "custom" && e.customType === MEASURED_ENTRY) return undefined;
		if (e.type === "custom_message" && e.customType === NOTICE_TYPE) return e.details as PruneNoticeDetails | undefined;
	}
	return undefined;
}

/** A prune the tool prepared, committed by `turn_end` once its turn is over. */
interface PendingPrune {
	edits: ContextEditDraft[];
	notice: { type: "custom_message"; customType: string; content: string; display: boolean; details: PruneNoticeDetails };
	summary: string;
}

/** The session file, then the parent sessions its header names, oldest last. */
function sessionChain(path: string): string[] {
	const chain = [path];
	while (chain.length < 20) {
		let parent: unknown;
		try {
			const fd = openSync(chain[chain.length - 1], "r");
			const buf = Buffer.alloc(8192);
			const n = readSync(fd, buf, 0, buf.length, 0);
			closeSync(fd);
			parent = JSON.parse(buf.toString("utf8", 0, n).split("\n")[0]).parentSession;
		} catch {
			break;
		}
		if (typeof parent !== "string" || !parent || chain.includes(parent)) break;
		chain.push(parent);
	}
	return chain;
}

/**
 * Where each tool call of the chain was made: the first session (oldest
 * first) holding it, which has its arguments uncut.
 */
function callOrigins(chain: string[]): Map<string, CallOrigin> {
	const origins = new Map<string, CallOrigin>();
	for (const file of [...chain].reverse()) {
		let lines: string[];
		try {
			lines = readFileSync(file, "utf8").split("\n");
		} catch {
			continue;
		}
		const sid = sessionShortId(file);
		for (const line of lines) {
			if (!line.includes('"toolCall"')) continue;
			let e: { type?: string; id?: string; message?: { role?: string; content?: unknown } };
			try {
				e = JSON.parse(line);
			} catch {
				continue;
			}
			if (e.type !== "message" || e.message?.role !== "assistant" || !Array.isArray(e.message.content)) continue;
			for (const b of e.message.content as { type?: string; id?: string; arguments?: unknown }[]) {
				if (b.type === "toolCall" && b.id && !origins.has(b.id))
					origins.set(b.id, { entryId: String(e.id), sid, args: b.arguments });
			}
		}
	}
	return origins;
}

/**
 * Files changed by the given commits, looked up in the git repos holding the
 * session's cwd and touched files. Deletions are marked "(deleted)".
 */
async function commitFiles(pi: ExtensionAPI, hashes: string[], dirs: string[]): Promise<string[]> {
	if (hashes.length === 0) return [];
	const git = (args: string[]) => pi.exec("git", args, { timeout: 5000 }).catch(() => undefined);
	const repos = new Set<string>();
	for (const dir of new Set(dirs)) {
		const r = await git(["-C", dir, "rev-parse", "--show-toplevel"]);
		if (r?.code === 0 && r.stdout.trim()) repos.add(r.stdout.trim());
	}
	const files: string[] = [];
	for (const hash of hashes) {
		for (const repo of repos) {
			const r = await git(["-C", repo, "show", "--no-renames", "--name-status", "--format=", `${hash}^{commit}`]);
			if (r?.code !== 0) continue;
			for (const line of r.stdout.split("\n")) {
				const [status, path] = line.split("\t");
				if (path) files.push(join(repo, path) + (status === "D" ? " (deleted)" : ""));
			}
			break;
		}
	}
	return files;
}

export default function prune(pi: ExtensionAPI) {
	let frontier = 0;
	const pending = new Map<string, PendingPrune>();
	const auto = autoPruneEnabled();
	/** When the latest provider request started or ended, for the cache TTL. */
	let lastRequestAt: number | undefined;
	/** A prune was committed since the last request, so that request rewrites the cache anyway. */
	let prunedSinceRequest = false;
	const emit = (event: AutoPruneEvent) => {
		try {
			pi.events?.emit(AUTO_PRUNE_EVENT, event);
		} catch {
			// smart-compact listening is optional.
		}
	};

	const restore = (ctx: ExtensionContext) => {
		frontier = restoreFrontier(ctx.sessionManager.getBranch() as never);
		lastRequestAt = undefined;
		prunedSinceRequest = false;
		const id = sessionId(ctx);
		if (auto && id) emit({ type: "active", sessionId: id });
	};
	pi.on("session_start", (_event, ctx) => {
		pending.clear();
		restore(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		pending.clear();
		restore(ctx);
	});

	/**
	 * The automatic prune for the step that just ended, as boundary drafts, or
	 * undefined to leave the context alone. Runs where the `prune` tool commits,
	 * so the edits reach the next request the same way.
	 */
	async function autoPrune(
		event: { message?: unknown; messageEntryId?: string; outcome?: string; context?: { pendingMessages?: unknown[] } },
		ctx: ExtensionContext,
	): Promise<SessionBoundaryDraft[] | undefined> {
		const message = event.message as StepMessage | undefined;
		if (message?.role !== "assistant" || (event.outcome !== undefined && event.outcome !== "completed")) return;
		const calls = callNames(message);
		if (calls.some((n) => SELF_MANAGED.has(n))) return;
		let tokens: number | null | undefined;
		try {
			tokens = ctx.getContextUsage()?.tokens;
		} catch {
			return;
		}
		if (typeof tokens !== "number" || tokens < AUTO_PRUNE_START_TOKENS) return;

		const pendingUser = (event.context?.pendingMessages ?? []).some((m) => (m as { role?: string })?.role === "user");
		const subagent = isSubagentSession(ctx);
		// A subagent's last answer is its report: pruning after it only costs.
		if (subagent && calls.length === 0 && !pendingUser) return;
		const now = Date.now();
		const cold = isCacheCold(now, latest(lastRequestAt, message.timestamp));
		const seam = stepSeam(message as never, { pendingUser });
		const trigger = decideTrigger({ tokens, cold, seam, readOnly: isReadOnlyStep(message as never) });
		if (!trigger) return;

		const sessionPath = ctx.sessionManager.getSessionFile();
		const id = sessionId(ctx);
		if (!sessionPath || !id) return;
		const projected = ctx.sessionManager.buildSessionProjection().entries as unknown as ProjectedEntry[];
		const chain = sessionChain(sessionPath);
		const opts = { parentPath: sessionPath, sessionChain: chain, callOrigins: callOrigins(chain), inPlace: true };
		const lastAssistantId = event.messageEntryId ?? "";
		let plan = planAutoPrune(projected, { lastAssistantId, tokensBefore: tokens, trigger, prune: opts });
		if (!plan.ok) {
			emit({ type: "no-gain", sessionId: id, trigger, tokensBefore: tokens, reason: plan.reason });
			return;
		}
		const touched = [...plan.result.notice.details.filesModified, ...plan.result.notice.details.filesRead];
		const dirs = [ctx.cwd, ...touched.map((f) => dirname(f.replace(/ \(deleted\)$/, "")))];
		const extraModified = await commitFiles(pi, collectCommitHashes(ctx.sessionManager.getBranch() as BranchEntry[]), dirs);
		if (extraModified.length) {
			const again = planAutoPrune(projected, { lastAssistantId, tokensBefore: tokens, trigger, prune: { ...opts, extraModified } });
			if (again.ok) plan = again;
		}

		const details: PruneNoticeDetails = {
			...plan.result.notice.details,
			tokensBefore: tokens,
			tokensEstimate: plan.tokensEstimate,
			inPlace: true,
		};
		appendAutoPruneLog(
			autoPruneLogLine({
				now,
				sessionId: id,
				sessionFile: sessionPath,
				trigger,
				seam: trigger === "seam" ? seam : undefined,
				subagent,
				tokensBefore: tokens,
				tokensAfterEstimate: plan.tokensEstimate,
				edits: plan.edits.length,
			}),
		);
		emit({ type: "pruned", sessionId: id, trigger, tokensBefore: tokens, tokensEstimate: plan.tokensEstimate });
		if (ctx.hasUI)
			ctx.ui.notify(
				`prune: automatic (${trigger === "seam" ? `seam: ${seam}` : trigger}), ${fmtTokens(tokens)} → about ${fmtTokens(plan.tokensEstimate)} tokens over ${plan.edits.length} entries`,
				"info",
			);
		const notice = { type: "custom_message" as const, customType: NOTICE_TYPE, content: plan.result.notice.content, display: true, details };
		return [...plan.edits, notice] as SessionBoundaryDraft[];
	}

	// Edits land after the turn's tool results, before pi rebuilds the context
	// for the next request, so the run goes on with the pruned context.
	// Every pending prune was prepared in this turn, since each turn_end clears
	// them; a codemode call (`tools.prune`) carries an id no toolCall block holds.
	pi.on("turn_end", async (event, ctx) => {
		const p = [...pending.values()].at(-1);
		pending.clear();
		if (p) {
			if (ctx.hasUI) ctx.ui.notify(p.summary, "info");
			prunedSinceRequest = true;
			// inplace.ts types the replacement loosely to stay free of pi imports.
			return { entries: [...p.edits, p.notice] as SessionBoundaryDraft[] };
		}
		if (!auto) return;
		const drafts = await autoPrune(event as never, ctx);
		if (!drafts) return;
		prunedSinceRequest = true;
		const proposed = ((event as { entries?: SessionBoundaryDraft[] }).entries ?? []) as SessionBoundaryDraft[];
		return { entries: [...proposed, ...drafts] };
	});

	// The strip breaks the cache from the first stripped message on, so it
	// advances only when the request rewrites the cache anyway: the cache went
	// cold, or a prune was committed since the last request. On a warm cache
	// the stripped prefix stays as it is (batch = Infinity never advances).
	pi.on("context", (event, ctx) => {
		const now = Date.now();
		const cold = isCacheCold(now, latest(lastRequestAt, lastAssistantAt(event.messages as StepMessage[])));
		const free = cold || prunedSinceRequest;
		prunedSinceRequest = false;
		lastRequestAt = now;
		const pass = applyThinkingFrontier(event.messages as never[], frontier, free ? BATCH : Number.POSITIVE_INFINITY);
		if (pass.advanced) {
			frontier = pass.frontier;
			pi.appendEntry(FRONTIER_ENTRY, { ts: frontier });
			if (ctx.hasUI) ctx.ui.notify(`prune: stripped ${fmt(pass.batchChars)} chars of older thinking`, "info");
		}
		return pass.messages === (event.messages as never[]) ? undefined : { messages: pass.messages as never };
	});

	// The first reply in a pruned session carries the real size of the pruned request.
	pi.on("message_end", (event, ctx) => {
		const msg = event.message as { role?: string; usage?: Usage };
		if (msg.role === "assistant") lastRequestAt = Date.now();
		if (msg.role !== "assistant" || !msg.usage) return;
		const after = (msg.usage.input ?? 0) + (msg.usage.cacheRead ?? 0) + (msg.usage.cacheWrite ?? 0);
		if (after === 0) return;
		const notice = pendingNotice(ctx.sessionManager.getBranch() as Entry[]);
		if (!notice) return;
		const estimate = notice.tokensEstimate ?? null;
		pi.appendEntry(MEASURED_ENTRY, { tokensBefore: notice.tokensBefore ?? null, tokensAfter: after, tokensEstimate: estimate });
		const before = notice.tokensBefore ? `${fmtTokens(notice.tokensBefore)} → ` : "";
		const est = estimate ? `, estimated ${fmtTokens(estimate)}` : "";
		if (ctx.hasUI) ctx.ui.notify(`prune: context ${before}${fmtTokens(after)} tokens (first request after pruning${est})`, "info");
	});

	pi.registerMessageRenderer<PruneNoticeDetails>(NOTICE_TYPE, (message, options, theme) => {
		const d = message.details;
		const head = d
			? `✂ pruned ${d.auto ? `automatically (${d.auto})` : d.inPlace ? "in place" : `from ${basename(d.parentSession)}`}${d.tokensBefore ? ` (${fmtTokens(d.tokensBefore)} tokens)` : ""}: ` +
				`${fmt(d.charsBefore)} → ${fmt(d.charsAfter)} chars, ` +
				`${d.filesModified.length} files modified, ${d.filesRead.length} read`
			: "✂ pruned context";
		const body = options.expanded && typeof message.content === "string" ? `\n${theme.fg("dim", message.content)}` : "";
		return new Text(theme.fg("muted", head) + body, options.outputPad, 0);
	});

	// Hidden from the tool list (hide-declarations.ts); smart-compact's reminders name it.
	pi.registerTool({
		name: "prune",
		label: "Prune",
		description: [
			"Prune this session's context in place: thinking is removed and older tool calls and results are cut to pointers into this session file, while every message stays.",
			"It takes effect from the next request; the turn goes on, so keep working on the task right after the call.",
			"Call it alone at a clean stopping point, when a smart-compaction reminder recommends it or the user asks for it.",
		].join("\n"),
		parameters: Type.Object({}, { additionalProperties: false }),
		executionMode: "sequential",
		execute: async (toolCallId, _params, _signal, _onUpdate, ctx) => {
			const fail = (text: string) => ({ content: [{ type: "text" as const, text }], details: {}, isError: true });
			const sessionPath = ctx.sessionManager.getSessionFile();
			if (!sessionPath) return fail("prune: this session has no file for the pointers to name.");
			const covered = entriesBeforeCall(
				ctx.sessionManager.buildSessionProjection().entries as unknown as ProjectedEntry[],
				toolCallId,
			);
			const entries = covered.map((p) => p.sourceEntry);
			const chain = sessionChain(sessionPath);
			const opts = { parentPath: sessionPath, sessionChain: chain, callOrigins: callOrigins(chain), inPlace: true };
			const first = pruneBranch(entries, opts);
			const touched = [...first.notice.details.filesModified, ...first.notice.details.filesRead];
			const dirs = [ctx.cwd, ...touched.map((f) => dirname(f.replace(/ \(deleted\)$/, "")))];
			const branch = ctx.sessionManager.getBranch() as BranchEntry[];
			const extraModified = await commitFiles(pi, collectCommitHashes(branch), dirs);
			const result = extraModified.length ? pruneBranch(entries, { ...opts, extraModified }) : first;
			const edits = buildContextEdits(covered, result);
			if (edits.length === 0) return fail("prune: nothing left to prune; everything before this call is already pruned.");
			if (result.stats.charsAfter >= result.stats.charsBefore) {
				return fail("prune: this context is too small to gain from a prune; the notice would outweigh the cuts. Continue the task.");
			}

			const tokensBefore = ctx.getContextUsage()?.tokens ?? null;
			const estimate = tokensAfterPrune(entries, result.stats.charsAfter).tokens;
			const details: PruneNoticeDetails = { ...result.notice.details, tokensBefore, tokensEstimate: estimate, inPlace: true };
			const { charsBefore, charsAfter } = result.stats;
			pending.set(toolCallId, {
				edits,
				notice: { type: "custom_message", customType: NOTICE_TYPE, content: result.notice.content, display: true, details },
				summary:
					`prune: in place, ${fmt(charsBefore)} → ${fmt(charsAfter)} chars over ${edits.length} entries` +
					(tokensBefore ? `, context was ${fmtTokens(tokensBefore)} tokens` : "") +
					`; the real size shows after the next reply`,
			});
			return {
				content: [
					{
						type: "text" as const,
						text:
							`Pruned ${edits.length} entries (${fmt(charsBefore)} → ${fmt(charsAfter)} chars); the context holds about ${fmtTokens(estimate)} tokens from the next request on. ` +
							"A prune notice follows with the pointer format and the files touched. Continue the task.",
					},
				],
				details: { edits: edits.length, charsBefore, charsAfter, tokensBefore, tokensEstimate: estimate },
			};
		},
	});

	pi.registerCommand("prune", {
		description: "Copy this branch into a new session without thinking and with truncated tool I/O",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("prune: wait until the agent is idle", "warning");
				return;
			}
			const parentPath = ctx.sessionManager.getSessionFile();
			if (!parentPath) {
				ctx.ui.notify("prune: this session has no file to point back to", "warning");
				return;
			}
			const branch = ctx.sessionManager.getBranch() as BranchEntry[];
			const chain = sessionChain(parentPath);
			const origins = callOrigins(chain);
			const first = pruneBranch(branch, { parentPath, sessionChain: chain, callOrigins: origins });
			const touched = [...first.notice.details.filesModified, ...first.notice.details.filesRead];
			const dirs = [ctx.cwd, ...touched.map((f) => dirname(f.replace(/ \(deleted\)$/, "")))];
			const extraModified = await commitFiles(pi, collectCommitHashes(branch), dirs);
			const result = extraModified.length
				? pruneBranch(branch, { parentPath, sessionChain: chain, callOrigins: origins, extraModified })
				: first;
			if (result.items.length === 0) {
				ctx.ui.notify("prune: nothing to prune", "info");
				return;
			}
			const { charsBefore, charsAfter } = result.stats;
			const tokensBefore = ctx.getContextUsage()?.tokens ?? null;
			result.notice.details.tokensBefore = tokensBefore;
			result.notice.details.tokensEstimate = Math.round(estimateBaseline(branch) + charsAfter / CHARS_PER_TOKEN);
			const summary =
				`prune: ${fmt(charsBefore)} → ${fmt(charsAfter)} chars` +
				(tokensBefore ? `, context was ${fmtTokens(tokensBefore)} tokens` : "") +
				`; the real size shows after the next reply. Parent ${basename(parentPath)}`;
			const res = await ctx.newSession({
				parentSession: parentPath,
				setup: async (sm) => writePruned(sm, result),
				withSession: async (next) => {
					next.ui.notify(summary, "info");
				},
			});
			if (res.cancelled) ctx.ui.notify("prune: cancelled", "warning");
		},
	});
}
