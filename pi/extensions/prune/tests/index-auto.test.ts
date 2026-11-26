/**
 * The automatic prune as pi drives it: `turn_end` after a step's tools ran,
 * `message_end` and `context` around each provider request. A small mock
 * stands in for pi; the session file path is fake, so the pointer chain is
 * the session alone and no git repo is consulted.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import prune from "../index.ts";
import { AUTO_PRUNE_EVENT } from "../src/auto.ts";
import type { ContextEditDraft, ProjectedEntry } from "../src/inplace.ts";
import { FRONTIER_ENTRY } from "../src/thinking.ts";
import type { BranchEntry } from "../src/transform.ts";

const SESSION = "/nonexistent/2026-11-21T11-13-30-073Z_01a1e2a0-8fd9-773a-b68d-1dbf09aa4cce.jsonl";
const SUBAGENT_PROMPT = "You are a coding agent.\n<sub_agent_context>\nYou are operating as a sub-agent invoked to handle a specific task.\n</sub_agent_context>";

type Block = Record<string, unknown>;
type Handler = (event: unknown, ctx: unknown) => unknown;

const think = (n = 2_000) => ({ type: "thinking", thinking: "t".repeat(n) });
const text = (s: string) => ({ type: "text", text: s });
const bash = (id: string, command: string) => ({ type: "toolCall", id, name: "bash", arguments: { command } });
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({ type: "toolCall", id, name, arguments: args });

function entry(id: string, message: Record<string, unknown>): BranchEntry {
	return { type: "message", id, message: message as never };
}

/** 40 steps of ~4.5k tokens, then the latest step with `last` as its content. */
function session(last: Block[], ts = Date.now()): BranchEntry[] {
	const out: BranchEntry[] = [entry("u0", { role: "user", content: "do the task", timestamp: ts - 60_000 })];
	for (let i = 0; i < 40; i++) {
		out.push(entry(`a${i}`, { role: "assistant", content: [think(), text(`step ${i}`), bash(`c${i}`, `cat f${i}`)], timestamp: ts - 50_000 }));
		out.push(
			entry(`r${i}`, { role: "toolResult", toolCallId: `c${i}`, toolName: "bash", content: [text("x".repeat(6_000))], isError: false }),
		);
	}
	out.push(entry("last", { role: "assistant", content: last, timestamp: ts }));
	const ids = last.filter((b) => b.type === "toolCall").map((b) => String(b.id));
	ids.forEach((id, i) =>
		out.push(entry(`lr${i}`, { role: "toolResult", toolCallId: id, toolName: "bash", content: [text("ok")], isError: false })),
	);
	return out;
}

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
		return { sourceEntry: e, messages: r ? [{ ...base, content: r.content }] : [] };
	});
}

function setup() {
	const handlers = new Map<string, Handler[]>();
	const appended: { customType: string; data: unknown }[] = [];
	const bus: unknown[] = [];
	const replacement: string[] = [];
	const pi = {
		on: (name: string, h: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
		registerTool() {},
		registerCommand() {},
		registerMessageRenderer() {},
		appendEntry: (customType: string, data: unknown) => appended.push({ customType, data }),
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		events: { emit: (channel: string, data: unknown) => channel === AUTO_PRUNE_EVENT && bus.push(data), on() {} },
	};
	prune(pi as never);
	const fire = async (name: string, event: unknown, ctx: unknown) => {
		let out: unknown;
		for (const h of handlers.get(name) ?? []) out = (await h(event, ctx)) ?? out;
		return out as { entries?: { type: string; customType?: string; details?: Record<string, unknown> }[] } | undefined;
	};
	const ctx = (entries: BranchEntry[], tokens: number, systemPrompt = "You are a coding agent.") => ({
		hasUI: false,
		cwd: tmpdir(),
		ui: { notify() {} },
		getContextUsage: () => ({ tokens, contextWindow: 200_000 }),
		getSystemPrompt: () => systemPrompt,
		newSession: async () => replacement.push("newSession"),
		sessionManager: {
			getSessionFile: () => SESSION,
			getSessionId: () => "01a1e2a0-8fd9",
			getBranch: () => entries,
			buildSessionProjection: () => ({ entries: project(entries) }),
		},
	});
	const turnEnd = (entries: BranchEntry[], pendingMessages: unknown[] = []) => {
		const last = entries.findLast((e) => e.type === "message" && e.message?.role === "assistant")!;
		return {
			type: "turn_end",
			turnIndex: 3,
			message: last.message,
			toolResults: [],
			messageEntryId: last.id,
			toolResultEntryIds: [],
			outcome: "completed",
			entries: [],
			continue: false,
			context: { pendingMessages },
		};
	};
	/** A provider reply just ended: the cache is warm. */
	const replied = (c: unknown) => fire("message_end", { message: { role: "assistant", content: [], usage: {} } }, c);
	return { fire, ctx, turnEnd, replied, appended, bus, replacement };
}

let logDir: string;
let previous: { log?: string; auto?: string };
beforeEach(() => {
	logDir = mkdtempSync(join(tmpdir(), "auto-prune-log-"));
	previous = { log: process.env.PI_AUTO_PRUNE_LOG, auto: process.env.PI_AUTO_PRUNE };
	process.env.PI_AUTO_PRUNE_LOG = join(logDir, "auto-prune.log.jsonl");
	delete process.env.PI_AUTO_PRUNE;
});
afterEach(() => {
	for (const [k, v] of [
		["PI_AUTO_PRUNE_LOG", previous.log],
		["PI_AUTO_PRUNE", previous.auto],
	] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});
const logLines = () => {
	try {
		return readFileSync(process.env.PI_AUTO_PRUNE_LOG!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
	} catch {
		return [];
	}
};

describe("automatic prune on turn_end", () => {
	it("announces itself on the event bus at session start", async () => {
		const m = setup();
		await m.fire("session_start", { reason: "startup" }, m.ctx([], 0));
		assert.deepEqual(m.bus, [{ type: "active", sessionId: "01a1e2a0-8fd9" }]);
	});

	it("prunes at a seam above 120k: context edits, an automatic notice, a log line and a bus event", async () => {
		const m = setup();
		const entries = session([text("Committing the parser fix."), bash("k", "git commit -am 'parser: fix dates'")]);
		const c = m.ctx(entries, 130_000);
		await m.replied(c);
		const out = await m.fire("turn_end", m.turnEnd(entries), c);
		assert.ok(out?.entries?.length, "the boundary gets entries");
		assert.ok(out.entries.some((e) => e.type === "context_edit"));
		const notice = out.entries.at(-1)!;
		assert.equal(notice.customType, "prune:notice");
		assert.equal(notice.details?.auto, "seam");
		assert.equal(notice.details?.tokensBefore, 130_000);
		const [line] = logLines();
		assert.equal(line.trigger, "seam");
		assert.equal(line.seam, "commit");
		assert.equal(line.agent, "main");
		assert.equal(line.tokensBefore, 130_000);
		assert.equal(typeof line.tokensAfterEstimate, "number");
		assert.equal(line.sessionId, "01a1e2a0-8fd9");
		assert.ok(m.bus.some((e) => (e as { type: string }).type === "pruned"));
	});

	it("does nothing below 120k", async () => {
		const m = setup();
		const entries = session([bash("k", "git commit -am x")]);
		const c = m.ctx(entries, 110_000);
		await m.replied(c);
		assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries, undefined);
	});

	it("waits after a read-only step on a warm cache", async () => {
		const m = setup();
		const entries = session([call("k", "read", { path: "/a.ts" })]);
		const c = m.ctx(entries, 130_000);
		await m.replied(c);
		assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries, undefined);
		assert.equal(logLines().length, 0);
	});

	it("prunes on a cold cache even after a read-only step", async () => {
		const m = setup();
		const entries = session([call("k", "read", { path: "/a.ts" })], Date.now() - 400_000);
		const out = await m.fire("turn_end", m.turnEnd(entries), m.ctx(entries, 130_000));
		assert.equal(out?.entries?.at(-1)?.details?.auto, "cold");
	});

	it("prunes at the 160k ceiling even after a read-only step", async () => {
		const m = setup();
		const entries = session([call("k", "read", { path: "/a.ts" })]);
		const c = m.ctx(entries, 165_000);
		await m.replied(c);
		assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries?.at(-1)?.details?.auto, "ceiling");
	});

	it("treats a queued user message as a seam", async () => {
		const m = setup();
		const entries = session([call("k", "edit", { path: "/a.ts" })]);
		const c = m.ctx(entries, 130_000);
		await m.replied(c);
		const out = await m.fire("turn_end", m.turnEnd(entries, [{ role: "user", content: "also do y" }]), c);
		assert.equal(out?.entries?.at(-1)?.details?.auto, "seam");
		assert.equal(logLines()[0].seam, "user-message");
	});

	it("leaves a step that calls smart_compact or prune to those tools", async () => {
		const m = setup();
		for (const name of ["smart_compact", "prune"]) {
			const entries = session([call("k", name, {})]);
			const c = m.ctx(entries, 170_000);
			await m.replied(c);
			assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries, undefined, name);
		}
	});

	it("reports no gain instead of pruning when the prune would save too little", async () => {
		const m = setup();
		const entries = session([bash("k", "git commit -am x")]).slice(-12);
		const c = m.ctx(entries, 125_000);
		await m.replied(c);
		assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries, undefined);
		assert.ok(m.bus.some((e) => (e as { type: string }).type === "no-gain"));
	});

	it("is off with PI_AUTO_PRUNE=0", async () => {
		process.env.PI_AUTO_PRUNE = "0";
		const m = setup();
		const entries = session([bash("k", "git commit -am x")]);
		const c = m.ctx(entries, 170_000);
		await m.fire("session_start", { reason: "startup" }, c);
		await m.replied(c);
		assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries, undefined);
		assert.deepEqual(m.bus, []);
	});
});

describe("automatic prune in a subagent", () => {
	it("prunes in place mid-run and logs the session as a subagent", async () => {
		const m = setup();
		const entries = session([bash("k", "pnpm test")]);
		const c = m.ctx(entries, 140_000, SUBAGENT_PROMPT);
		await m.replied(c);
		const out = await m.fire("turn_end", m.turnEnd(entries), c);
		assert.equal(out?.entries?.at(-1)?.details?.auto, "seam");
		assert.equal(logLines()[0].agent, "subagent");
		assert.deepEqual(m.replacement, [], "the prune never replaces the session");
	});

	it("recognises a replace-mode subagent by its active_agent tag", async () => {
		const m = setup();
		const entries = session([bash("k", "pnpm test")]);
		const c = m.ctx(entries, 140_000, '<active_agent name="reviewer"/>\n\nYou are a code reviewer.');
		await m.replied(c);
		await m.fire("turn_end", m.turnEnd(entries), c);
		assert.equal(logLines()[0].agent, "subagent");
	});

	it("leaves the final answer of a subagent alone", async () => {
		const m = setup();
		const entries = session([text("Done. Report follows.")]);
		const c = m.ctx(entries, 170_000, SUBAGENT_PROMPT);
		await m.replied(c);
		assert.equal((await m.fire("turn_end", m.turnEnd(entries), c))?.entries, undefined);
	});
});

describe("batched thinking strip", () => {
	const now = Date.now();
	/** 30k chars of thinking behind the last turn start: past the 24k batch. */
	const messages = (ts: number) => [
		{ role: "user", content: "first", timestamp: ts - 3_000 },
		{ role: "assistant", content: [think(30_000), text("answer")], timestamp: ts - 2_000 },
		{ role: "user", content: "second", timestamp: ts - 1_000 },
	];
	const advanced = (m: ReturnType<typeof setup>) => m.appended.filter((a) => a.customType === FRONTIER_ENTRY).length;

	it("no longer runs on a warm cache below the prune trigger", async () => {
		const m = setup();
		const c = m.ctx([], 50_000);
		await m.replied(c);
		await m.fire("context", { messages: messages(now) }, c);
		assert.equal(advanced(m), 0);
	});

	it("runs on a cold cache", async () => {
		const m = setup();
		const out = (await m.fire("context", { messages: messages(now - 400_000) }, m.ctx([], 50_000))) as { messages: Block[] } | undefined;
		assert.equal(advanced(m), 1);
		assert.ok(!(out?.messages[1].content as Block[]).some((b) => b.type === "thinking"));
	});

	it("runs bundled with a prune, on the request right after it", async () => {
		const m = setup();
		const entries = session([bash("k", "git commit -am x")]);
		const c = m.ctx(entries, 130_000);
		await m.replied(c);
		assert.ok((await m.fire("turn_end", m.turnEnd(entries), c))?.entries?.length);
		await m.fire("context", { messages: messages(Date.now()) }, c);
		assert.equal(advanced(m), 1);
		await m.replied(c);
		await m.fire("context", { messages: [...messages(Date.now()), { role: "assistant", content: [think(30_000)], timestamp: Date.now() }, { role: "user", content: "third", timestamp: Date.now() }] }, c);
		assert.equal(advanced(m), 1, "the next warm request does not strip again");
	});
});
