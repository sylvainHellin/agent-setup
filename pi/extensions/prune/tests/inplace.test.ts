import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContextEdits, type ContextEditDraft, entriesBeforeCall, type ProjectedEntry } from "../src/inplace.ts";
import { type BranchEntry, NOTICE_TYPE, pruneBranch } from "../src/transform.ts";

const SESSION = "/s/2026-10-21T11-13-30-073Z_01a15e2a-8fd9-773a-b68d-1dbf09aa4cce.jsonl";
const opts = { parentPath: SESSION, inPlace: true };

const user = (id: string, text: string): BranchEntry => ({ type: "message", id, message: { role: "user", content: text } });
const assistant = (id: string, content: unknown[]): BranchEntry => ({ type: "message", id, message: { role: "assistant", content } });
const result = (id: string, callId: string, text: string): BranchEntry => ({
	type: "message",
	id,
	message: { role: "toolResult", toolCallId: callId, toolName: "bash", content: [{ type: "text", text }], isError: false },
});
const think = { type: "thinking", thinking: "t".repeat(500) };
const call = (id: string, command = "ls") => ({ type: "toolCall", id, name: "bash", arguments: { command } });

/** What pi's projection holds: each entry's message as the model sees it, after `edits`. */
function project(entries: BranchEntry[], edits: ContextEditDraft[] = []): ProjectedEntry[] {
	const latest = new Map(edits.map((e) => [e.targetId, e.replacement]));
	return entries.map((e) => {
		const base =
			e.type === "custom_message"
				? { role: "custom", content: e.content }
				: e.type === "message" && e.message
					? { ...e.message }
					: undefined;
		if (!base) return { sourceEntry: e, messages: [] };
		if (!latest.has(e.id)) return { sourceEntry: e, messages: [base] };
		const r = latest.get(e.id);
		return { sourceEntry: e, messages: r === null || r === undefined ? [] : [{ ...base, content: r.content }] };
	});
}

const session = (): BranchEntry[] => [
	user("u1", "start"),
	assistant("a1", [think, { type: "text", text: "looking" }, call("c1")]),
	result("r1", "c1", "x".repeat(1_000)),
	assistant("a2", [think]),
	user("u2", "next"),
	assistant("a3", [think, call("cp")]),
];

describe("entriesBeforeCall", () => {
	it("stops before the assistant message holding the prune call", () => {
		const covered = entriesBeforeCall(project(session()), "cp");
		assert.deepEqual(
			covered.map((p) => p.sourceEntry.id),
			["u1", "a1", "r1", "a2", "u2"],
		);
	});

	it("stops before the last assistant message for a codemode call, whose inner id no message holds", () => {
		assert.deepEqual(
			entriesBeforeCall(project(session()), "codemode-inner").map((p) => p.sourceEntry.id),
			["u1", "a1", "r1", "a2", "u2"],
		);
	});

	it("covers nothing when the projection holds no assistant message", () => {
		assert.equal(entriesBeforeCall(project([user("u1", "hi")]), "x").length, 0);
	});
});

describe("buildContextEdits", () => {
	it("edits changed entries, omits dropped assistants and skips unchanged ones", () => {
		const covered = entriesBeforeCall(project(session()), "cp");
		const edits = buildContextEdits(
			covered,
			pruneBranch(
				covered.map((p) => p.sourceEntry),
				opts,
			),
		);
		const byId = new Map(edits.map((e) => [e.targetId, e]));
		assert.deepEqual([...byId.keys()].sort(), ["a1", "a2", "r1"]);
		assert.equal(byId.get("a2")?.replacement, null, "a thinking-only assistant is omitted");
		const a1 = byId.get("a1")?.replacement?.content as { type: string }[];
		assert.ok(!a1.some((b) => b.type === "thinking"), "thinking is gone from a1");
		const r1 = byId.get("r1")?.replacement?.content as { text: string }[];
		assert.match(r1[0].text, /\[pruned: 800 chars, entry r1 in 01a15e2a\]$/);
		assert.ok(!byId.has("u1") && !byId.has("u2"), "plain user messages stay as they are");
		assert.ok(!byId.has("a3"), "the calling message keeps its thinking");
	});

	it("writes no edits on a second prune of the same entries", () => {
		const entries = session();
		const first = entriesBeforeCall(project(entries), "cp");
		const edits = buildContextEdits(
			first,
			pruneBranch(
				first.map((p) => p.sourceEntry),
				opts,
			),
		);
		const again = entriesBeforeCall(project(entries, edits), "cp");
		const second = buildContextEdits(
			again,
			pruneBranch(
				again.map((p) => p.sourceEntry),
				opts,
			),
		);
		assert.deepEqual(second, []);
	});

	it("shortens an earlier prune notice to one line", () => {
		const notice: BranchEntry = {
			type: "custom_message",
			id: "n1",
			customType: NOTICE_TYPE,
			content: "[prune notice] long text",
			display: true,
			details: { parentSession: SESSION, filesModified: ["/a"], filesRead: [], charsBefore: 1, charsAfter: 1 },
		};
		const covered = project([user("u1", "hi"), notice]);
		const result = pruneBranch(
			covered.map((p) => p.sourceEntry),
			opts,
		);
		const edits = buildContextEdits(covered, result);
		assert.equal(edits.length, 1);
		assert.match(String(edits[0].replacement?.content), /An earlier prune from 01a15e2a/);
		assert.deepEqual(result.notice.details.filesModified, ["/a"], "its file list moves into the new notice");
		assert.match(result.notice.content, /pruned in place/);
	});
});
