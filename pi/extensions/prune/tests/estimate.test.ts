import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	BASELINE_FALLBACK,
	BASELINE_MAX,
	BASELINE_MIN,
	CHARS_PER_TOKEN,
	estimateBaseline,
	estimatePrunedTokens,
	MEASURED_ENTRY,
} from "../src/estimate.ts";
import { type BranchEntry, NOTICE_TYPE, pruneBranch } from "../src/transform.ts";

const PARENT = "/tmp/sessions/2026-10-21T09-00-00-000Z_01a15dce-bbfe-77ff.jsonl";
const usage = (input: number, cacheRead = 0) => ({ input, output: 3, cacheRead, cacheWrite: 0, totalTokens: input + cacheRead });

function msg(id: string, message: Record<string, unknown>): BranchEntry {
	return { type: "message", id, message: message as BranchEntry["message"] };
}

const user = (id: string, text: string) => msg(id, { role: "user", content: text, timestamp: 1 });
const assistant = (id: string, text: string, u: unknown) =>
	msg(id, { role: "assistant", content: [{ type: "thinking", thinking: "t".repeat(9_000) }, { type: "text", text }], usage: u, timestamp: 2 });

describe("estimateBaseline", () => {
	it("takes the first reply's usage minus the messages sent before it", () => {
		const branch = [user("u1", "x".repeat(1_800)), assistant("a1", "ok", usage(2_000, 10_000)), assistant("a2", "ok", usage(50_000))];
		assert.equal(estimateBaseline(branch), 12_000 - 1_000);
	});

	it("skips replies without usage, such as pruned copies with zeroed usage", () => {
		const branch = [user("u1", "hi"), assistant("a1", "ok", usage(0)), assistant("a2", "ok", usage(20_000))];
		assert.equal(estimateBaseline(branch), Math.round(20_000 - (2 + 9_000 + 2) / CHARS_PER_TOKEN));
	});

	it("uses the measured first request of a pruned branch", () => {
		const branch: BranchEntry[] = [
			user("u1", "hi"),
			{ type: "custom_message", id: "n", customType: NOTICE_TYPE, content: "notice", display: true, details: { charsAfter: 36_000 } },
			{ type: "custom", id: "m", customType: MEASURED_ENTRY, data: { tokensAfter: 30_000 } } as BranchEntry,
		];
		assert.equal(estimateBaseline(branch), 10_000);
	});

	it("clamps implausible values and falls back without any usage", () => {
		assert.equal(estimateBaseline([assistant("a1", "ok", usage(500_000))]), BASELINE_MAX);
		assert.equal(estimateBaseline([user("u1", "x".repeat(90_000)), assistant("a1", "ok", usage(10_000))]), BASELINE_MIN);
		assert.equal(estimateBaseline([user("u1", "hi")]), BASELINE_FALLBACK);
	});
});

describe("estimatePrunedTokens", () => {
	it("adds the baseline to the pruned chars at the calibrated ratio", () => {
		const branch = [user("u1", "hi"), assistant("a1", "y".repeat(3_600), usage(12_000))];
		const est = estimatePrunedTokens(branch, { parentPath: PARENT });
		const { charsAfter } = pruneBranch(branch, { parentPath: PARENT, inPlace: true }).stats;
		assert.equal(est.charsAfter, charsAfter);
		assert.equal(est.tokens, Math.round(est.baseline + charsAfter / CHARS_PER_TOKEN));
		assert.ok(charsAfter < 3_600 + 2_000, "thinking must not count toward the pruned size");
	});
});
