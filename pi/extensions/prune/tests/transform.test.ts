import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SMART_COMPACT_INJECTED_PREFIXES } from "../../smart-compact/src/prompts.js";
import {
	type BranchEntry,
	collectCommitHashes,
	NOTICE_TAG,
	NOTICE_TYPE,
	pruneBranch,
	shortenCommand,
	writePruned,
} from "../src/transform.ts";

const PARENT = "/tmp/sessions dir/2026-09-25T10-26-41-631Z_01a0d81a-5d5f.jsonl";
const usage = { input: 5, output: 7, cacheRead: 100, cacheWrite: 3, totalTokens: 115, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 } };
const long = (n: number, c = "x") => c.repeat(n);

function msg(id: string, message: Record<string, unknown>): BranchEntry {
	return { type: "message", id, message: message as BranchEntry["message"] };
}

function assistant(id: string, content: unknown[], ts = 2): BranchEntry {
	return msg(id, { role: "assistant", content, api: "anthropic-messages", provider: "p", model: "m", usage, stopReason: "toolUse", timestamp: ts });
}

const branch: BranchEntry[] = [
	{ type: "model_change", id: "mc" },
	{ type: "thinking_level_change", id: "tl" },
	msg("sys", { role: "system", content: "prompt", timestamp: 0 }),
	msg("u1", {
		role: "user",
		content: [
			{ type: "text", text: "look at this" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		],
		timestamp: 1,
	}),
	assistant("a1", [
		{ type: "thinking", thinking: long(500), thinkingSignature: "sig" },
		{ type: "text", text: "reading" },
		{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "/src/a.ts" } },
		{ type: "toolCall", id: "tc2", name: "edit", arguments: { path: "/src/b.ts", edits: [{ oldText: long(300), newText: "short" }] } },
	]),
	msg("r1", { role: "toolResult", toolCallId: "tc1", toolName: "read", content: [{ type: "text", text: long(1000, "r") }], details: { big: long(5000) }, isError: false, timestamp: 3 }),
	msg("r2", { role: "toolResult", toolCallId: "tc2", toolName: "edit", content: [{ type: "text", text: "ok" }], isError: true, timestamp: 4 }),
	{ type: "compaction", id: "cp", summary: "summary" },
	{ type: "custom", id: "cu", customType: "state" },
	assistant("a2", [{ type: "thinking", thinking: "only thinking" }]),
	assistant("a3", [{ type: "toolCall", id: "tc3", name: "write", arguments: { path: "/src/a.ts", content: long(400) } }]),
	msg("r3", { role: "toolResult", toolCallId: "tc3", toolName: "write", content: [{ type: "text", text: "written" }], isError: false, timestamp: 6 }),
	{ type: "custom_message", id: "cm", customType: "note", content: long(800, "c"), display: true, details: { k: 1 } },
	{ type: "branch_summary", id: "bs", summary: "abandoned path", fromId: "zz" },
	msg("u2", { role: "user", content: "plain string", timestamp: 7 }),
];

describe("pruneBranch", () => {
	const res = pruneBranch(branch, { parentPath: PARENT });
	const messages = res.items.filter((i) => i.kind === "message").map((i) => (i as { message: Record<string, any> }).message);

	it("skips system, model, thinking level, compaction and custom entries", () => {
		assert.deepEqual(
			res.items.map((i) => (i.kind === "message" ? i.message.role : i.kind)),
			["user", "assistant", "toolResult", "toolResult", "assistant", "toolResult", "custom_message", "branch_summary", "user"],
		);
	});

	it("keeps user messages verbatim and replaces images", () => {
		assert.deepEqual(messages[0].content, [
			{ type: "text", text: "look at this" },
			{ type: "text", text: "[image omitted]" },
		]);
		assert.equal(messages.at(-1)!.content, "plain string");
	});

	it("drops thinking, keeps text and metadata, truncates tool arguments", () => {
		const a1 = messages[1];
		assert.deepEqual(a1.content.map((b: any) => b.type), ["text", "toolCall", "toolCall"]);
		assert.equal(a1.api, "anthropic-messages");
		assert.equal(a1.model, "m");
		assert.equal(a1.stopReason, "toolUse");
		assert.equal(a1.usage.totalTokens, 0);
		const edit = a1.content[2].arguments;
		assert.equal(edit.path, "/src/b.ts");
		assert.equal(edit.edits[0].oldText, `${long(120)}… [truncated, entry a1 in 01a0d81a]`);
		assert.equal(edit.edits[0].newText, "short");
		assert.equal(res.stats.assistantDropped, 1);
		assert.equal(res.stats.thinkingBlocksDropped, 2);
	});

	it("cuts tool results to one text block with a pointer to the parent entry", () => {
		const r1 = messages[2];
		assert.deepEqual(Object.keys(r1).sort(), ["content", "isError", "role", "timestamp", "toolCallId", "toolName"]);
		assert.equal(r1.content.length, 1);
		assert.equal(r1.content[0].text, `${long(200, "r")}… [pruned: 800 chars, entry r1 in 01a0d81a]`);
		assert.equal(messages[3].content[0].text, "ok");
		assert.equal(messages[3].isError, true);
	});

	it("truncates custom messages and keeps branch summaries", () => {
		const cm = res.items[6] as { content: string; details: unknown };
		assert.equal(cm.content, `${long(600, "c")}… [pruned: 200 chars, entry cm in 01a0d81a]`);
		assert.deepEqual(cm.details, { k: 1 });
		assert.equal((res.items[7] as { summary: string }).summary, "abandoned path");
	});

	it("lists modified and read files, deduplicated", () => {
		assert.deepEqual(res.notice.details.filesModified, ["/src/b.ts", "/src/a.ts"]);
		assert.deepEqual(res.notice.details.filesRead, []);
		assert.equal(res.notice.customType, NOTICE_TYPE);
		assert.match(res.notice.content, /- 01a0d81a: \/tmp\/sessions dir\/2026-09-25T10-26-41-631Z_01a0d81a-5d5f\.jsonl \(parent\)/);
		assert.ok(res.stats.charsAfter < res.stats.charsBefore);
	});

	it("writes a session pi can rebuild context from", () => {
		const sm = SessionManager.inMemory("/tmp", { parentSession: PARENT });
		writePruned(sm as never, res);
		const ctx = sm.buildSessionContext();
		assert.deepEqual(
			ctx.messages.map((m) => m.role),
			["user", "assistant", "toolResult", "toolResult", "assistant", "toolResult", "custom", "branchSummary", "user", "custom"],
		);
		assert.equal(sm.getHeader()?.parentSession, PARENT);
	});

	it("tags the notice as coming from the extension", () => {
		assert.ok(res.notice.content.startsWith(`${NOTICE_TAG} `));
	});
});

describe("smart-compact notices", () => {
	it("cuts every opening smart-compact injects as a user message", () => {
		const entries = SMART_COMPACT_INJECTED_PREFIXES.map((p, i) =>
			msg(`n${i}`, { role: "user", content: [{ type: "text", text: `${p} ${long(500)}` }], timestamp: i + 1 }),
		);
		const res = pruneBranch(entries, { parentPath: PARENT });
		const texts = res.items
			.slice(0, entries.length)
			.map((i) => (i as { message: { content: { text: string }[] } }).message.content[0].text);
		texts.forEach((text, i) => assert.match(text, new RegExp(`… \\[pruned: \\d+ chars, entry n${i} in 01a0d81a\\]$`)));
	});
});

describe("harness notices, shell commands and commits", () => {
	const advisory = `Smart compaction advisory: the context boundary has been crossed.\n${long(2000)}`;
	const cmd = `cd ~/.pi/agent/sessions/--home-user-code--/ && F=${long(60, "f")}.jsonl; jq -r '.x' $F | tail -1`;
	const side: BranchEntry[] = [
		msg("u1", { role: "user", content: [{ type: "text", text: advisory }], timestamp: 1 }),
		assistant("a1", [
			{ type: "toolCall", id: "b1", name: "bash", arguments: { command: cmd, timeout: 60 } },
			{ type: "toolCall", id: "b2", name: "bash", arguments: { command: "cd ~/project && git add x && git commit -qm msg && git log --oneline -1" } },
			{ type: "toolCall", id: "b3", name: "bash", arguments: { command: "git log --oneline -3" } },
		]),
		msg("r1", { role: "toolResult", toolCallId: "b1", toolName: "bash", content: [{ type: "text", text: "1a2b3c4d" }], timestamp: 2 }),
		msg("r2", { role: "toolResult", toolCallId: "b2", toolName: "bash", content: [{ type: "text", text: "f68578d pi: prune, 1234567 deadbeef" }], timestamp: 3 }),
		msg("r3", { role: "toolResult", toolCallId: "b3", toolName: "bash", content: [{ type: "text", text: "aaaa111 old" }], timestamp: 4 }),
		msg("r4", { role: "toolResult", toolCallId: "x", toolName: "get_subagent_result", content: [{ type: "text", text: "Commit `33d914b` done… [pruned: 9 chars, entry e224bd3a in parent session]" }], timestamp: 5 }),
		assistant("a2", [{ type: "toolCall", id: "b4", name: "bash", arguments: { command: "git commit -m y" } }]),
		msg("r5", { role: "toolResult", toolCallId: "b4", toolName: "bash", content: [{ type: "text", text: "[main (root-commit) abc1234] y\n 1 file changed… [pruned: 9 chars, entry bfdf5c8f in 01a0d81a]" }], timestamp: 6 }),
	];
	const res = pruneBranch(side, { parentPath: PARENT, extraModified: ["/repo/new.md", "/repo/gone.md (deleted)"] });
	const messages = res.items.map((i) => (i as { message: Record<string, any> }).message);

	it("cuts smart-compact notices sent as user messages", () => {
		assert.equal(messages[0].role, "user");
		assert.equal(messages[0].content[0].text, `${advisory.slice(0, 100)}… [pruned: ${advisory.length - 100} chars, entry u1 in 01a0d81a]`);
	});

	it("collapses cd prefixes and keeps both ends of a long command", () => {
		const args = messages[1].content[0].arguments;
		assert.equal(args.timeout, 60);
		assert.ok(args.command.startsWith("cd …/--home-user-code-- && F="));
		const mark = " [truncated, entry a1 in 01a0d81a]";
		assert.ok(args.command.endsWith(`| tail -1${mark}`));
		assert.equal(args.command.length, 120 + mark.length);
		assert.equal(shortenCommand("ls -la", 120, { n: 0 }), "ls -la");
		assert.equal(shortenCommand("cd '/a/b c' && ls", 120, { n: 0 }), "cd …/b c && ls");
		assert.equal(shortenCommand("cd /x/docs; rg y", 120, { n: 0 }), "cd …/docs && rg y");
	});

	it("collects hashes from commit calls and subagent reports only", () => {
		assert.deepEqual(collectCommitHashes(side), ["f68578d", "33d914b", "abc1234"]);
	});

	it("merges commit files into the modified list", () => {
		assert.deepEqual(res.notice.details.filesModified, ["/repo/new.md", "/repo/gone.md (deleted)"]);
		assert.match(res.notice.content, /- \/repo\/gone\.md \(deleted\)/);
	});
});

describe("re-pruning a pruned session", () => {
	const OLD = "/tmp/s/2026-09-23T14-01-52-950Z_01a0ce92-a835.jsonl";
	const kept = `${long(200, "k")}… [pruned: 55 chars, entry e29e829f in parent session]`;
	const named = `${long(150, "n")}… [pruned: 70 chars, entry aa11bb22 in 01a0ce92]`;
	const repruned: BranchEntry[] = [
		{
			type: "custom_message",
			id: "n0",
			customType: NOTICE_TYPE,
			content: `Context was pruned from the parent session ${OLD}.\n${long(900)}`,
			display: true,
			details: { parentSession: OLD, filesModified: ["/a.md", "/gone.md (deleted)"], filesRead: ["/r.md"], charsBefore: 1, charsAfter: 1 },
		},
		assistant("a1", [
			{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
			{ type: "toolCall", id: "t2", name: "edit", arguments: { path: "/gone.md" } },
		]),
		msg("r1", { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: kept }], timestamp: 2 }),
		msg("r2", { role: "toolResult", toolCallId: "t2", toolName: "edit", content: [{ type: "text", text: named }], timestamp: 3 }),
	];
	const res = pruneBranch(repruned, { parentPath: PARENT, sessionChain: [PARENT, OLD] });
	const texts = res.items.map((i) => (i.kind === "message" ? (i.message.content as any)[0].text : (i as any).content));

	it("shortens the earlier notice to one line and keeps its details", () => {
		assert.equal(texts[0], `${NOTICE_TAG} An earlier prune from 01a0ce92; its file lists are merged into the latest notice.`);
		assert.deepEqual((res.items[0] as any).details.filesRead, ["/r.md"]);
	});

	it("merges the earlier file lists, deletions included", () => {
		assert.deepEqual(res.notice.details.filesModified, ["/a.md", "/gone.md (deleted)"]);
		assert.deepEqual(res.notice.details.filesRead, ["/r.md"]);
	});

	it("keeps earlier cuts and names the session a legacy pointer meant", () => {
		assert.equal(texts[2], kept.replace("in parent session", "in 01a0ce92"));
		assert.equal(texts[3], named);
	});

	it("maps every session id of the chain to its file", () => {
		assert.match(res.notice.content, /- 01a0d81a: .*01a0d81a-5d5f\.jsonl \(parent\)\n- 01a0ce92: \/tmp\/s\/2026-09-23T14-01-52-950Z_01a0ce92-a835\.jsonl\n/);
		assert.match(res.notice.content, /\[truncated, entry <entryId> in <sessionId>\]/);
		assert.doesNotMatch(res.notice.content, /toolCallId/);
	});
});

describe("tool-call argument pointers", () => {
	const OLD = "/tmp/s/2026-09-23T14-01-52-950Z_01a0ce92-a835.jsonl";
	const full = { path: "/x.ts", edits: [{ oldText: long(500, "o"), newText: "n" }] };
	const legacy = { path: "/x.ts", edits: [{ oldText: `${long(120, "o")}… [truncated]`, newText: "n" }] };
	const branch: BranchEntry[] = [
		assistant("a9", [
			{ type: "toolCall", id: "old", name: "edit", arguments: legacy },
			{ type: "toolCall", id: "new", name: "bash", arguments: { command: `echo ${long(300)}` } },
		]),
	];
	const origins = new Map([["old", { entryId: "e0", sid: "01a0ce92", args: full }]]);
	const once = pruneBranch(branch, { parentPath: PARENT, sessionChain: [PARENT, OLD], callOrigins: origins });
	const calls = (r: typeof once) => ((r.items[0] as any).message.content as any[]).map((b) => b.arguments);

	it("re-cuts a call from its uncut origin and points there", () => {
		assert.equal(calls(once)[0].edits[0].oldText, `${long(120, "o")}… [truncated, entry e0 in 01a0ce92]`);
	});

	it("points a call without a known origin to its entry in the parent", () => {
		assert.match(calls(once)[1].command, / \[truncated, entry a9 in 01a0d81a\]$/);
	});

	it("leaves marked arguments unchanged on a later prune", () => {
		const again = pruneBranch([assistant("b1", (once.items[0] as any).message.content)], { parentPath: PARENT });
		assert.deepEqual(calls(again), calls(once));
	});
});

const REAL = process.env.PRUNE_SESSION ?? "/tmp/prune-src.jsonl";

describe("real session", { skip: !existsSync(REAL) && `no session copy at ${REAL}` }, () => {
	it("prunes a copy and produces a consistent history", () => {
		const copy = join(mkdtempSync(join(tmpdir(), "prune-test-")), "session.jsonl");
		copyFileSync(REAL, copy);
		const src = SessionManager.open(copy);
		const branch = src.getBranch() as BranchEntry[];
		const res = pruneBranch(branch, { parentPath: REAL });

		const sm = SessionManager.inMemory("/tmp", { parentSession: REAL });
		writePruned(sm as never, res);
		const messages = sm.buildSessionContext().messages as Array<Record<string, any>>;

		const calls = new Set<string>();
		for (const m of messages) {
			if (m.role === "assistant") {
				assert.ok(m.content.length > 0);
				for (const b of m.content) {
					assert.notEqual(b.type, "thinking");
					if (b.type === "toolCall") calls.add(b.id);
				}
			}
			if (m.role === "toolResult") {
				assert.ok(calls.has(m.toolCallId), `orphan result ${m.toolCallId}`);
				assert.ok(m.content[0].text.length <= 200 + 80);
			}
		}
		const s = res.stats;
		console.log(
			`real session: ${branch.length} entries, ${res.items.length} items, ` +
				`chars ${s.charsBefore} -> ${s.charsAfter} (~${Math.ceil(s.charsBefore / 4)} -> ~${Math.ceil(s.charsAfter / 4)} tokens), ` +
				`thinking blocks ${s.thinkingBlocksDropped}, results cut ${s.toolResultsTruncated}, args cut ${s.toolArgsTruncated}, ` +
				`modified ${res.notice.details.filesModified.length}, read ${res.notice.details.filesRead.length}`,
		);
		assert.ok(s.charsAfter < s.charsBefore / 2);
	});
});
