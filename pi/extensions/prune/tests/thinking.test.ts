import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyThinkingFrontier, FRONTIER_ENTRY, lastTurnStart, restoreFrontier, visibleThinkingChars } from "../src/thinking.ts";

type M = { role: string; content?: any; timestamp: number; [k: string]: unknown };

const user = (ts: number, text = "q"): M => ({ role: "user", content: [{ type: "text", text }], timestamp: ts });
const think = (ts: number, chars: number, extra: any[] = [{ type: "text", text: "a" }]): M => ({
	role: "assistant",
	content: [{ type: "thinking", thinking: "t".repeat(chars), thinkingSignature: "s" }, ...extra],
	timestamp: ts,
});
const call = (ts: number, chars: number, id: string): M => think(ts, chars, [{ type: "toolCall", id, name: "bash", arguments: {} }]);
const result = (ts: number, id: string): M => ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [], isError: false, timestamp: ts });

describe("applyThinkingFrontier", () => {
	it("leaves messages alone below the batch size", () => {
		const msgs = [user(1), think(2, 100), user(3)];
		const pass = applyThinkingFrontier(msgs, 0, 1000);
		assert.equal(pass.advanced, false);
		assert.equal(pass.messages, msgs);
	});

	it("advances to the last turn start and strips everything older", () => {
		const msgs = [user(1), call(2, 600, "c1"), result(3, "c1"), think(4, 600, []), user(5), call(6, 900, "c2"), result(7, "c2")];
		const pass = applyThinkingFrontier(msgs, 0, 1000);
		assert.equal(pass.advanced, true);
		assert.equal(pass.frontier, 5);
		assert.equal(pass.batchChars, 1200);
		assert.deepEqual(pass.messages.map((m) => m.role), ["user", "assistant", "toolResult", "user", "assistant", "toolResult"]);
		assert.deepEqual(pass.messages[1].content.map((b: any) => b.type), ["toolCall"]);
		assert.equal(pass.messages[4], msgs[5], "in-flight turn untouched");
	});

	it("keeps the stripped prefix byte-stable until the next advance", () => {
		const base = [user(1), think(2, 1500), user(3), think(4, 50)];
		const first = applyThinkingFrontier(base, 0, 1000);
		assert.equal(first.frontier, 3);
		const later = [...base, user(5), think(6, 300), user(7)];
		const second = applyThinkingFrontier(later, first.frontier, 1000);
		assert.equal(second.advanced, false);
		const prefix = JSON.stringify(first.messages);
		assert.equal(JSON.stringify(second.messages.slice(0, first.messages.length)), prefix);
		assert.equal(second.messages[5], later[5], "thinking after the frontier stays");
	});

	it("does not treat a steer inside a tool loop as a turn start", () => {
		const msgs = [user(1), call(2, 5000, "c1"), result(3, "c1"), user(4, "steer")];
		assert.equal(lastTurnStart(msgs), 0);
		const pass = applyThinkingFrontier(msgs, 0, 1000);
		assert.equal(pass.advanced, false);
		assert.equal(pass.messages, msgs);
	});

	it("counts only visible thinking but strips redacted blocks too", () => {
		const redacted: M = { role: "assistant", content: [{ type: "thinking", thinking: "", redacted: true, thinkingSignature: "x".repeat(9000) }, { type: "text", text: "a" }], timestamp: 2 };
		assert.equal(visibleThinkingChars(redacted), 0);
		const noAdvance = applyThinkingFrontier([user(1), redacted, user(3)], 0, 1000);
		assert.equal(noAdvance.advanced, false);
		const stripped = applyThinkingFrontier([user(1), redacted, user(3)], 3, 1000);
		assert.deepEqual(stripped.messages[1].content, [{ type: "text", text: "a" }]);
	});

	it("restores the latest frontier from the branch", () => {
		const entries = [
			{ type: "custom", customType: FRONTIER_ENTRY, data: { ts: 10 } },
			{ type: "custom", customType: "other", data: { ts: 99 } },
			{ type: "custom", customType: FRONTIER_ENTRY, data: { ts: 20 } },
			{ type: "message" },
		];
		assert.equal(restoreFrontier(entries), 20);
		assert.equal(restoreFrontier([]), 0);
	});
});
