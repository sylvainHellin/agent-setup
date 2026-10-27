/**
 * Batched thinking strip for the `context` event.
 *
 * Every edit of an older message invalidates the prompt cache from that point
 * on, so thinking is stripped only up to a frontier timestamp that advances in
 * batches. Between advances the stripped prefix is byte-stable.
 */

export const THINKING_BATCH_CHARS = 24_000;
export const FRONTIER_ENTRY = "prune:thinking-frontier";

type Block = { type: string; thinking?: unknown; redacted?: unknown; [k: string]: unknown };
type Msg = { role: string; content?: unknown; timestamp?: number; [k: string]: unknown };

export interface ThinkingPass<M> {
	messages: M[];
	frontier: number;
	advanced: boolean;
	/** Visible thinking chars that triggered the advance (0 when not advanced). */
	batchChars: number;
}

function isThinking(b: Block): boolean {
	return b.type === "thinking" || b.type === "redacted_thinking";
}

/** Visible (non-redacted) thinking characters of an assistant message. */
export function visibleThinkingChars(msg: Msg): number {
	if (msg.role !== "assistant" || !Array.isArray(msg.content)) return 0;
	let n = 0;
	for (const b of msg.content as Block[]) {
		if (b.type === "thinking" && !b.redacted && typeof b.thinking === "string") n += b.thinking.length;
	}
	return n;
}

/**
 * Index of the last user message that opens a turn. A user message right after
 * a tool result is a steer inside a running tool loop, whose thinking Anthropic
 * still requires, so it does not count.
 */
export function lastTurnStart(messages: Msg[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== "user") continue;
		if (i > 0 && messages[i - 1].role === "toolResult") continue;
		return i;
	}
	return -1;
}

/**
 * Advance the frontier when enough thinking has piled up before the last turn
 * start, then strip thinking from assistant messages older than the frontier.
 * Nothing at or after the last turn start is touched. Messages that are not
 * changed keep their identity.
 */
export function applyThinkingFrontier<M extends Msg>(
	messages: M[],
	frontier: number,
	batchChars = THINKING_BATCH_CHARS,
): ThinkingPass<M> {
	const last = lastTurnStart(messages);
	if (last < 0) return { messages, frontier, advanced: false, batchChars: 0 };

	let pending = 0;
	for (let i = 0; i < last; i++) {
		const ts = messages[i].timestamp;
		if (typeof ts === "number" && ts >= frontier) pending += visibleThinkingChars(messages[i]);
	}

	let advanced = false;
	const turnTs = messages[last].timestamp;
	if (pending > batchChars && typeof turnTs === "number" && turnTs > frontier) {
		frontier = turnTs;
		advanced = true;
	}
	if (frontier <= 0) return { messages, frontier, advanced, batchChars: 0 };

	const out: M[] = [];
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		const ts = m.timestamp;
		if (i >= last || m.role !== "assistant" || typeof ts !== "number" || ts >= frontier || !Array.isArray(m.content)) {
			out.push(m);
			continue;
		}
		const blocks = m.content as Block[];
		if (!blocks.some(isThinking)) {
			out.push(m);
			continue;
		}
		const kept = blocks.filter((b) => !isThinking(b));
		if (kept.length > 0) out.push({ ...m, content: kept });
	}
	return { messages: out, frontier, advanced, batchChars: advanced ? pending : 0 };
}

/** Latest persisted frontier on a branch (entries root to leaf), or 0. */
export function restoreFrontier(entries: Array<{ type: string; customType?: string; data?: unknown }>): number {
	let ts = 0;
	for (const e of entries) {
		if (e.type !== "custom" || e.customType !== FRONTIER_ENTRY) continue;
		const v = (e.data as { ts?: unknown } | undefined)?.ts;
		if (typeof v === "number" && Number.isFinite(v)) ts = v;
	}
	return ts;
}
