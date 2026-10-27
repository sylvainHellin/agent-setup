/**
 * tool-call-repair
 * ---------------------------------------------------------------
 * Neutralizes the Anthropic 400:
 *   messages.N: `tool_use` ids were found without `tool_result`
 *   blocks immediately after: <id>. Each `tool_use` block must have
 *   a corresponding `tool_result` block in the next message.
 *
 * Cause: an assistant turn that ended in `error`/`aborted` (interrupt,
 * or a mid-stream tool-argument JSON parse failure) leaves a `tool_use`
 * block with no matching `tool_result`. On the next request the whole
 * history is replayed and Anthropic rejects it.
 *
 * pi's stock providers fix this inside `@earendil-works/pi-ai`
 * `transformMessages()` (drop errored/aborted assistant turns +
 * synthesize tool_results for orphans). Custom providers that don't
 * reuse that pass (e.g. a custom provider extension) skip the
 * repair, so this extension re-applies it provider-agnostically.
 *
 * Two layers:
 *   1. `context` handler  -> automatic, non-destructive. Repairs the
 *      outgoing message copy before every LLM call. History on disk is
 *      untouched; the already-broken session becomes resumable again.
 *   2. `/repair` command  -> manual, DESTRUCTIVE hard-trim. Moves the
 *      session leaf back past any trailing errored/aborted/orphaned
 *      turns via tree navigation, so the broken tail is dropped from
 *      the active branch.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SYNTHETIC_TEXT =
	"Tool result missing (turn was interrupted or failed mid-stream); repaired by tool-call-repair.";

type ContentBlock = { type: string; id?: string; name?: string; text?: string };
type AnyMsg = {
	role: string;
	stopReason?: string;
	content?: ContentBlock[];
	toolCallId?: string;
	toolName?: string;
	[k: string]: unknown;
};

/**
 * Port of pi-ai transformMessages' orphan-repair pass to AgentMessage[].
 * - Drops assistant messages with stopReason "error" | "aborted".
 * - Inserts a synthetic error tool_result for any tool_use whose id was
 *   never answered before the tool-call flow was interrupted.
 */
function repairMessages(messages: AnyMsg[]): AnyMsg[] {
	const out: AnyMsg[] = [];
	let pending: Array<{ id: string; name: string }> = [];
	let satisfied = new Set<string>();

	const flush = () => {
		for (const tc of pending) {
			if (!satisfied.has(tc.id)) {
				out.push({
					role: "toolResult",
					toolCallId: tc.id,
					toolName: tc.name,
					content: [{ type: "text", text: SYNTHETIC_TEXT }],
					isError: true,
					timestamp: Date.now(),
				});
			}
		}
		pending = [];
		satisfied = new Set();
	};

	for (const msg of messages) {
		if (msg.role === "assistant") {
			// Any pending orphans from the previous assistant are now closed.
			flush();
			// Incomplete turns must not be replayed (may carry half-built tool calls).
			if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
			const calls = (msg.content ?? []).filter((b) => b.type === "toolCall") as Array<{
				id: string;
				name: string;
			}>;
			out.push(msg);
			if (calls.length > 0) {
				pending = calls.map((c) => ({ id: c.id, name: c.name }));
				satisfied = new Set();
			}
		} else if (msg.role === "toolResult") {
			if (msg.toolCallId) satisfied.add(msg.toolCallId);
			out.push(msg);
		} else {
			// user / custom / summary message interrupts the tool flow.
			flush();
			out.push(msg);
		}
	}
	flush();
	return out;
}

/** Count what the repair pass would change, for diagnostics. */
function diagnose(messages: AnyMsg[]): { droppedTurns: number; synthesizedResults: number } {
	let droppedTurns = 0;
	let synthesizedResults = 0;
	let pending: Array<{ id: string }> = [];
	let satisfied = new Set<string>();

	const flush = () => {
		for (const tc of pending) if (!satisfied.has(tc.id)) synthesizedResults++;
		pending = [];
		satisfied = new Set();
	};

	for (const msg of messages) {
		if (msg.role === "assistant") {
			flush();
			if (msg.stopReason === "error" || msg.stopReason === "aborted") {
				droppedTurns++;
				continue;
			}
			const calls = (msg.content ?? []).filter((b) => b.type === "toolCall");
			if (calls.length > 0) {
				pending = calls.map((c) => ({ id: c.id as string }));
				satisfied = new Set();
			}
		} else if (msg.role === "toolResult") {
			if (msg.toolCallId) satisfied.add(msg.toolCallId);
		} else {
			flush();
		}
	}
	flush();
	return { droppedTurns, synthesizedResults };
}

export default function (pi: ExtensionAPI) {
	// Layer 1: automatic, non-destructive repair on every outgoing request.
	pi.on("context", async (event) => {
		const repaired = repairMessages(event.messages as unknown as AnyMsg[]);
		return { messages: repaired as unknown as typeof event.messages };
	});

	// Layer 2: manual destructive hard-trim.
	pi.registerCommand("repair", {
		description: "Hard-trim trailing broken tool_use turns from the current branch",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const branch = ctx.sessionManager.getBranch(); // root -> leaf order
			const messageEntries = branch.filter(
				(e: { type: string }) => e.type === "message",
			) as unknown as Array<{ id: string; message: AnyMsg }>;

			if (messageEntries.length === 0) {
				ctx.ui.notify("Nothing to repair: no messages in this branch.", "info");
				return;
			}

			// Diagnostics over the resolved messages.
			const msgs = messageEntries.map((e) => e.message);
			const { droppedTurns, synthesizedResults } = diagnose(msgs);

			// Find the deepest entry index that leaves NO dangling tool_use at the tail.
			// Walk forward, tracking open tool calls; the last index where the flow is
			// "balanced" (no open tool calls) and the entry is not an errored/aborted
			// assistant turn is a safe trim target.
			let open = 0;
			let lastSafeIndex = -1;
			for (let i = 0; i < messageEntries.length; i++) {
				const m = messageEntries[i].message;
				if (m.role === "assistant") {
					if (m.stopReason === "error" || m.stopReason === "aborted") {
						// Incomplete turn: not a safe stopping point.
						const calls = (m.content ?? []).filter((b) => b.type === "toolCall");
						open += calls.length;
						continue;
					}
					const calls = (m.content ?? []).filter((b) => b.type === "toolCall");
					open = calls.length; // a fresh, complete assistant turn resets the expectation
					if (open === 0) lastSafeIndex = i;
				} else if (m.role === "toolResult") {
					if (open > 0) open--;
					if (open === 0) lastSafeIndex = i;
				} else {
					// user / custom / summary
					open = 0;
					lastSafeIndex = i;
				}
			}

			const tail = messageEntries.length - 1;
			if (open === 0 && lastSafeIndex === tail) {
				ctx.ui.notify(
					`Branch is already balanced (no trailing orphans). ` +
						`Auto-repair would drop ${droppedTurns} errored/aborted turn(s) on send.`,
					"info",
				);
				return;
			}

			if (lastSafeIndex < 0) {
				ctx.ui.notify(
					"No safe trim target found (entire branch is unbalanced). Aborting to avoid data loss.",
					"warning",
				);
				return;
			}

			const targetEntry = messageEntries[lastSafeIndex];
			const trimmedCount = tail - lastSafeIndex;

			const ok = await ctx.ui.confirm(
				"Hard-trim broken turns?",
				`Drop the last ${trimmedCount} message entry/entries (errored/aborted/orphaned ` +
					`tool calls) and move the leaf back to a balanced point? This rewrites the ` +
					`active branch (non-destructive to the tree; the trimmed tail stays as a sibling).`,
			);
			if (!ok) {
				ctx.ui.notify("Repair cancelled.", "info");
				return;
			}

			const result = await ctx.navigateTree(targetEntry.id, { summarize: false });
			if (result.cancelled) {
				ctx.ui.notify("Repair cancelled by another extension.", "warning");
				return;
			}

			ctx.ui.notify(
				`Trimmed ${trimmedCount} broken entry/entries. Leaf moved to a balanced point. ` +
					`You can now continue the conversation.`,
				"info",
			);
		},
	});
}
