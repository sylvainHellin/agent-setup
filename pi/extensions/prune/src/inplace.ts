/**
 * The model-called `prune` tool: the same transform as `/prune`, applied as
 * pi `context_edit` entries on this session instead of a copy into a new one.
 * The raw entries stay in the session file; only what the model sees changes.
 * Pure, so tests run it on real session files.
 *
 * Every prune cuts from the raw entries (`sourceEntry`), never from an earlier
 * edit, so a second prune yields the same content for everything the first
 * one covered and writes edits only for what changed since.
 */

import type { BranchEntry, PruneResult } from "./transform.ts";

type Block = { type: string; id?: unknown };

/** One entry of pi's `buildSessionProjection()`: the raw entry and what the model sees of it. */
export interface ProjectedEntry {
	sourceEntry: BranchEntry;
	messages: { role: string; content?: unknown }[];
}

/** pi's `ContextEditEntryDraft`, returned from a `turn_end` handler. */
export interface ContextEditDraft {
	type: "context_edit";
	targetId: string;
	replacement: { content: unknown } | null;
}

/** Message roles whose content a `context_edit` may replace (pi's ContextEditableContent). */
const EDITABLE_ROLES = new Set(["user", "assistant", "toolResult"]);

function holdsCall(entry: BranchEntry, toolCallId: string): boolean {
	const msg = entry.type === "message" ? entry.message : undefined;
	if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return false;
	return (msg.content as Block[]).some((b) => b.type === "toolCall" && b.id === toolCallId);
}

function isAssistant(entry: BranchEntry): boolean {
	return entry.type === "message" && entry.message?.role === "assistant";
}

/**
 * The projection entries a prune called as `toolCallId` covers: everything
 * before the assistant message that holds the call. That message and its tool
 * results stay as they are, since Anthropic needs the latest assistant
 * message's thinking intact.
 * A call made from codemode (`tools.prune`) carries codemode's inner id, which
 * no assistant message holds; the calling message is then the last assistant
 * entry, since pi persists it before running its tools.
 */
export function entriesBeforeCall(projected: ProjectedEntry[], toolCallId: string): ProjectedEntry[] {
	let i = projected.findIndex((p) => holdsCall(p.sourceEntry, toolCallId));
	if (i < 0) i = projected.findLastIndex((p) => isAssistant(p.sourceEntry));
	return i < 0 ? [] : projected.slice(0, i);
}

function editable(entry: BranchEntry): boolean {
	if (entry.type === "custom_message") return true;
	return entry.type === "message" && EDITABLE_ROLES.has(String(entry.message?.role));
}

/**
 * Context edits that turn `covered` into the pruned result: a replacement for
 * every editable entry whose pruned content differs from what the model sees
 * now, and an omission for every assistant entry the prune drops. Entries a
 * context edit cannot reach (bash executions, branch and compaction summaries)
 * stay as they are.
 */
export function buildContextEdits(covered: ProjectedEntry[], result: PruneResult): ContextEditDraft[] {
	const byId = new Map(covered.map((p) => [p.sourceEntry.id, p]));
	const edits: ContextEditDraft[] = [];
	for (const item of result.items) {
		const p = item.sourceId ? byId.get(item.sourceId) : undefined;
		if (!p || p.messages.length === 0 || !editable(p.sourceEntry)) continue;
		const next = item.kind === "message" ? item.message.content : item.kind === "custom_message" ? item.content : undefined;
		if (next === undefined) continue;
		if (JSON.stringify(next) === JSON.stringify(p.messages[0].content)) continue;
		edits.push({ type: "context_edit", targetId: p.sourceEntry.id, replacement: { content: next } });
	}
	for (const id of result.droppedIds) {
		const p = byId.get(id);
		if (p && p.messages.length > 0) edits.push({ type: "context_edit", targetId: id, replacement: null });
	}
	return edits;
}
