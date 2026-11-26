import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AUTO_PRUNE_CEILING_TOKENS,
	AUTO_PRUNE_COLD_MS,
	AUTO_PRUNE_FALLBACK_TOKENS,
	AUTO_PRUNE_START_TOKENS,
	AUTO_PRUNE_TAIL_TOKENS,
	autoPruneLogLine,
	decideTrigger,
	isCacheCold,
	isReadOnlyStep,
	planAutoPrune,
	stepSeam,
	tailStart,
} from "../src/auto.ts";
import { buildContextEdits, type ContextEditDraft, type ProjectedEntry } from "../src/inplace.ts";
import type { BranchEntry } from "../src/transform.ts";

const SESSION = "/s/2026-11-21T11-13-30-073Z_01a1e2a0-8fd9-773a-b68d-1dbf09aa4cce.jsonl";

type Block = Record<string, unknown>;
const user = (id: string, text: string): BranchEntry => ({ type: "message", id, message: { role: "user", content: text } });
const assistant = (id: string, content: Block[]): BranchEntry => ({
	type: "message",
	id,
	message: { role: "assistant", content, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
});
const result = (id: string, callId: string, text: string, toolName = "bash"): BranchEntry => ({
	type: "message",
	id,
	message: { role: "toolResult", toolCallId: callId, toolName, content: [{ type: "text", text }], isError: false },
});
const think = (n = 2_000) => ({ type: "thinking", thinking: "t".repeat(n) });
const text = (s: string) => ({ type: "text", text: s });
const bash = (id: string, command: string) => ({ type: "toolCall", id, name: "bash", arguments: { command } });
const tool = (id: string, name: string, args: Record<string, unknown> = {}) => ({ type: "toolCall", id, name, arguments: args });
const msg = (content: Block[]) => ({ role: "assistant", content });

/** pi's projection: each entry's message as the model sees it, after `edits`. */
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

/** `steps` tool steps of ~4.5k tokens each (2k thinking chars, 6k chars of output), then the latest one. */
function longSession(steps: number, prefix = "s"): BranchEntry[] {
	const out: BranchEntry[] = [user(`${prefix}u0`, "do the task")];
	for (let i = 0; i < steps; i++) {
		out.push(assistant(`${prefix}a${i}`, [think(), text(`step ${i}`), bash(`${prefix}c${i}`, `cat file${i}.txt`)]));
		out.push(result(`${prefix}r${i}`, `${prefix}c${i}`, "x".repeat(6_000)));
	}
	return out;
}

describe("auto-prune thresholds", () => {
	it("match the plan: start 120k, ceiling 160k, fallback 60k, tail 20k, cold 300 s", () => {
		assert.equal(AUTO_PRUNE_START_TOKENS, 120_000);
		assert.equal(AUTO_PRUNE_CEILING_TOKENS, 160_000);
		assert.equal(AUTO_PRUNE_FALLBACK_TOKENS, 60_000);
		assert.equal(AUTO_PRUNE_TAIL_TOKENS, 20_000);
		assert.equal(AUTO_PRUNE_COLD_MS, 300_000);
	});
});

describe("stepSeam", () => {
	it("a step without tool calls ends the turn", () => {
		assert.equal(stepSeam(msg([think(), text("Done, here is the summary.")])), "turn-end");
	});

	it("a queued user message is a seam", () => {
		assert.equal(stepSeam(msg([bash("c", "rg foo")]), { pendingUser: true }), "user-message");
	});

	it("a git commit in the bash calls is a seam", () => {
		assert.equal(stepSeam(msg([bash("c", "cd /x && git add a.ts && git commit -m 'fix'")])), "commit");
		assert.equal(stepSeam(msg([bash("c", "git -C /repo commit -am wip")])), "commit");
	});

	it("a test run in the bash calls is a seam", () => {
		for (const command of [
			"uv run pytest -q tests/",
			"pnpm test",
			"pnpm run test -- --watch=false",
			"./node_modules/.bin/vitest run",
			"cargo test --workspace",
			"node --import ./tests/ts-resolve.mjs --test tests/*.test.ts",
		]) {
			assert.equal(stepSeam(msg([bash("c", command)])), "tests", command);
		}
	});

	it("text without edits is a seam, text next to an edit is not", () => {
		const long = "I checked the parser and the fixtures; the failure comes from the date format, which I fix next.";
		assert.equal(stepSeam(msg([text(long), tool("c", "read", { path: "/a" })])), "text");
		assert.equal(stepSeam(msg([text(long), tool("c", "edit", { path: "/a" })])), undefined);
		assert.equal(stepSeam(msg([text("ok"), tool("c", "write", { path: "/a" })])), undefined);
	});

	it("a plain edit step is no seam", () => {
		assert.equal(stepSeam(msg([think(), tool("c", "edit", { path: "/a" })])), undefined);
	});
});

describe("isReadOnlyStep", () => {
	it("reads, searches and cat-like bash calls are read-only", () => {
		assert.equal(isReadOnlyStep(msg([tool("c", "read", { path: "/a" })])), true);
		assert.equal(isReadOnlyStep(msg([tool("c", "grep"), tool("d", "find"), tool("e", "ls")])), true);
		assert.equal(isReadOnlyStep(msg([bash("c", "cd /repo && rg -n foo src | head -20")])), true);
		assert.equal(isReadOnlyStep(msg([bash("c", "git status --short && git log --oneline -5")])), true);
	});

	it("any writing or running call makes the step not read-only", () => {
		assert.equal(isReadOnlyStep(msg([tool("c", "read"), tool("d", "edit")])), false);
		assert.equal(isReadOnlyStep(msg([bash("c", "pnpm test")])), false);
		assert.equal(isReadOnlyStep(msg([bash("c", "rg foo && rm -rf /tmp/x")])), false);
		assert.equal(isReadOnlyStep(msg([text("no calls")])), false, "a step without calls is a turn end, not a read");
	});
});

describe("isCacheCold", () => {
	it("is cold after more than 300 s without a provider request", () => {
		assert.equal(isCacheCold(1_000_000, 1_000_000 - AUTO_PRUNE_COLD_MS - 1), true);
		assert.equal(isCacheCold(1_000_000, 1_000_000 - AUTO_PRUNE_COLD_MS + 1_000), false);
		assert.equal(isCacheCold(1_000_000, undefined), true, "no request yet means nothing is cached");
	});
});

describe("decideTrigger", () => {
	const base = { tokens: 130_000, cold: false, seam: undefined, readOnly: false } as const;
	it("does nothing below the start threshold, even on a cold cache", () => {
		assert.equal(decideTrigger({ ...base, tokens: 119_999, cold: true, seam: "commit" }), undefined);
		assert.equal(decideTrigger({ ...base, tokens: undefined }), undefined);
	});

	it("prunes on a cold cache whatever the step was", () => {
		assert.equal(decideTrigger({ ...base, cold: true, readOnly: true }), "cold");
	});

	it("prunes on a warm cache only at a seam", () => {
		assert.equal(decideTrigger({ ...base, seam: "commit" }), "seam");
		assert.equal(decideTrigger(base), undefined, "no seam: wait one request");
	});

	it("never prunes on a warm cache right after a read-only step", () => {
		assert.equal(decideTrigger({ ...base, seam: "text", readOnly: true }), undefined);
	});

	it("prunes at the ceiling regardless of seam", () => {
		assert.equal(decideTrigger({ ...base, tokens: 160_000, readOnly: true }), "ceiling");
	});
});

describe("tailStart", () => {
	it("keeps the latest step and about the last 20k tokens whole, starting on a call, not a result", () => {
		const entries = longSession(20);
		const projected = project(entries);
		const last = entries.at(-2)!.id;
		const from = tailStart(projected, last);
		assert.ok(from > 0 && from < projected.length - 2);
		assert.equal(projected[from].sourceEntry.message?.role, "assistant", "the tail opens on the call, keeping it with its result");
		// ~4.5k tokens per step: a 20k tail is 4 to 6 steps.
		const steps = (projected.length - from) / 2;
		assert.ok(steps >= 4 && steps <= 6, `tail holds ${steps} steps`);
	});

	it("never starts after the latest assistant message", () => {
		const entries = [user("u", "hi"), assistant("a", [text("x")]), result("r", "c", "y".repeat(200_000))];
		assert.equal(tailStart(project(entries), "a"), 1);
	});
});

describe("planAutoPrune", () => {
	const opts = { parentPath: SESSION, inPlace: true };

	it("cuts everything before the tail and leaves the tail untouched", () => {
		const entries = longSession(40);
		const projected = project(entries);
		const plan = planAutoPrune(projected, { lastAssistantId: entries.at(-2)!.id, tokensBefore: 180_000, trigger: "seam", prune: opts });
		assert.ok(plan.ok, plan.ok ? "" : plan.reason);
		const tailIds = new Set(projected.slice(plan.tailFrom).map((p) => p.sourceEntry.id));
		assert.ok(plan.edits.length > 0);
		for (const e of plan.edits) assert.ok(!tailIds.has(e.targetId), `edit ${e.targetId} lands in the tail`);
		assert.ok(tailIds.has(entries.at(-1)!.id) && tailIds.has(entries.at(-2)!.id), "the latest step is in the tail");
		assert.ok(plan.tokensEstimate < 60_000, `estimate ${plan.tokensEstimate}`);
	});

	it("names the automatic prune in the notice and keeps the pointer legend", () => {
		const entries = longSession(40);
		const plan = planAutoPrune(project(entries), { lastAssistantId: entries.at(-2)!.id, tokensBefore: 180_000, trigger: "cold", prune: opts });
		assert.ok(plan.ok);
		const content = plan.result.notice.content;
		assert.match(content, /^\[prune notice\]/);
		assert.match(content, /pruned automatically/);
		assert.match(content, /jq -c 'select\(\.id=="<entryId>"\)' <session file>/);
		assert.match(content, new RegExp(SESSION.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
		assert.equal(plan.result.notice.details.auto, "cold");
	});

	it("skips when the gain is too small to repay the rewrite", () => {
		const entries = longSession(8);
		const plan = planAutoPrune(project(entries), { lastAssistantId: entries.at(-2)!.id, tokensBefore: 30_000, trigger: "seam", prune: opts });
		assert.equal(plan.ok, false);
	});

	it("is byte-stable: a repeat prune leaves every entry the first one covered as it was", () => {
		const first = longSession(40, "a");
		const firstPlan = planAutoPrune(project(first), { lastAssistantId: first.at(-2)!.id, tokensBefore: 180_000, trigger: "seam", prune: opts });
		assert.ok(firstPlan.ok);
		const notice: BranchEntry = {
			type: "custom_message",
			id: "n1",
			customType: firstPlan.result.notice.customType,
			content: firstPlan.result.notice.content,
			display: true,
			details: firstPlan.result.notice.details,
		};
		const grown = [...first, notice, ...longSession(40, "b").slice(1)];
		const before = project(grown, firstPlan.edits);
		const secondPlan = planAutoPrune(before, { lastAssistantId: grown.at(-2)!.id, tokensBefore: 180_000, trigger: "seam", prune: opts });
		assert.ok(secondPlan.ok);
		const firstCovered = new Set(project(first).slice(0, firstPlan.tailFrom).map((p) => p.sourceEntry.id));
		for (const e of secondPlan.edits) assert.ok(!firstCovered.has(e.targetId), `repeat prune rewrites ${e.targetId}`);
		const after = project(grown, [...firstPlan.edits, ...secondPlan.edits]);
		for (let i = 0; i < firstPlan.tailFrom; i++) {
			assert.equal(JSON.stringify(after[i].messages), JSON.stringify(before[i].messages), `bytes of ${after[i].sourceEntry.id} changed`);
		}
		// The repeat prune agrees with a fresh pass over the same projection: nothing left to edit.
		const again = project(grown, [...firstPlan.edits, ...secondPlan.edits]).slice(0, secondPlan.tailFrom);
		assert.deepEqual(buildContextEdits(again, secondPlan.result), []);
	});
});

describe("autoPruneLogLine", () => {
	it("records time, session, trigger, tokens and the kind of agent", () => {
		const line = autoPruneLogLine({
			now: Date.parse("2026-11-21T12:00:00Z"),
			sessionId: "01a1e2a0",
			sessionFile: SESSION,
			trigger: "seam",
			seam: "commit",
			subagent: true,
			tokensBefore: 131_000,
			tokensAfterEstimate: 32_000,
			edits: 57,
		});
		const parsed = JSON.parse(line);
		assert.equal(line.endsWith("\n"), true);
		assert.deepEqual(
			{ ...parsed },
			{
				ts: "2026-11-21T12:00:00.000Z",
				sessionId: "01a1e2a0",
				sessionFile: SESSION,
				trigger: "seam",
				seam: "commit",
				agent: "subagent",
				tokensBefore: 131_000,
				tokensAfterEstimate: 32_000,
				edits: 57,
			},
		);
	});
});
