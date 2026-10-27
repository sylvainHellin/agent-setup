/**
 * Final assistant answers on a session branch, for the annotate extension.
 *
 * An "answer" is the text of an assistant message that ends a turn
 * (stopReason other than "toolUse"), or of one that hands off to
 * `smart_compact`, which ends the turn without a closing message. Mid-turn
 * narration ("Let me check X") is left out.
 *
 * Each answer records what triggered its turn: the user's own message, a
 * subagent notification, a compaction, and so on. Messages smart-compact
 * injects with a user role are recognized by prefix, so they never count as
 * something the user typed.
 */

import { SMART_COMPACT_INJECTED_PREFIXES } from "../smart-compact/src/prompts.js";

export interface Answer {
	text: string;
	/** Short label for what started this turn, e.g. "your message". */
	trigger: string;
	/** Position of the most recent user-typed message before this answer. */
	userTurn: number;
}

type Entry = { type: string; customType?: string; content?: unknown; details?: any; message?: any };

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b: any) => b?.type === "text" && typeof b.text === "string")
		.map((b: any) => b.text as string)
		.join("\n\n");
}

function firstLine(text: string, max = 60): string {
	const line = text.trim().split("\n")[0]?.replace(/[*_`#]/g, "").trim() ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function customLabel(entry: Entry): string {
	const d = entry.details;
	const name = typeof d?.description === "string" ? d.description : typeof d?.agent === "string" ? d.agent : "";
	const kind = (entry.customType ?? "").includes("subagent") ? "subagent" : entry.customType ?? "notice";
	return name ? `${kind} "${firstLine(name)}"` : firstLine(textOf(entry.content)) || kind;
}

function endsTurn(msg: any): boolean {
	if (msg.stopReason !== "toolUse") return true;
	return ((msg.content ?? []) as any[]).some((b) => b?.type === "toolCall" && b.name === "smart_compact");
}

export function collectAnswers(entries: Entry[]): Answer[] {
	const answers: Answer[] = [];
	let trigger = "your message";
	let userTurn = 0;

	for (const entry of entries) {
		if (entry.type === "compaction") {
			trigger = "compaction";
			continue;
		}
		if (entry.type === "custom_message") {
			trigger = customLabel(entry);
			continue;
		}
		if (entry.type !== "message" || !entry.message) continue;
		const msg = entry.message;

		if (msg.role === "user") {
			const text = textOf(msg.content).trimStart();
			if (SMART_COMPACT_INJECTED_PREFIXES.some((p) => text.startsWith(p))) {
				trigger = "compaction";
			} else {
				trigger = "your message";
				userTurn++;
			}
			continue;
		}
		if (msg.role !== "assistant" || !endsTurn(msg)) continue;

		const text = textOf(msg.content).trim();
		if (text) answers.push({ text, trigger, userTurn });
	}
	return answers;
}
