import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { detectHarness, isSubagentPrompt, readBaseUrl, resolveBaseUrl, setup } from "../index.ts";

const SESSION = "01a20467-1111-7222-8333-944455556666";
const MD = "# Comments on Test page\n\n- line 3: fix this\n";
const FAST = {
	minBackoffMs: 40,
	maxBackoffMs: 160,
	silenceMs: 400,
	fetchMinBackoffMs: 20,
	fetchBudgetMs: 150,
	claimMinBackoffMs: 20,
	claimMaxBackoffMs: 80,
	startedMinBackoffMs: 20,
	startedMaxBackoffMs: 80,
	shutdownMs: 400,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 3000, what = "condition") {
	const end = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await sleep(10);
	}
}

/** A fake agent-pages server implementing the listen / claim / started / release / DELETE protocol (v2). */
class FakeServer {
	server: Server;
	url = "";
	log: string[] = []; // "<kind> <id>" in arrival order
	listens: URLSearchParams[] = [];
	closedListens = 0;
	claims: string[] = [];
	claimBodies: any[] = [];
	claimed = new Map<string, string>(); // id -> the claimer "pid@host" ("" when the claim named none)
	started: string[] = [];
	releases: string[] = [];
	deletes: string[] = [];
	markdownFetches: string[] = [];
	refuseClaims = new Set<string>();
	heartbeatMs = 0;
	unavailable = 0; // answer the next n listen requests with 503
	markdownFail = 0; // answer the next n markdown requests with 503
	markdownDelayMs = 0;
	claimFail = 0; // answer the next n claims with 503, uncommitted
	claimDrop = 0; // cut the connection on the next n claims, uncommitted
	claimDelayMs = 0; // commit a claim on arrival, answer it this much later
	claimLoseAnswer = 0; // commit the next n claims, then cut the connection before answering
	startedPosts: string[] = []; // every started request, answered or not
	startedFail = 0; // answer the next n started requests with 503, unrecorded
	startedDrop = 0; // cut the connection on the next n started requests, unrecorded
	startedConflict = new Set<string>(); // answer started for these ids with 409
	hang = false; // record release and DELETE requests but never answer them
	live: ServerResponse | undefined;
	private beat: NodeJS.Timeout | undefined;

	constructor() {
		this.server = createServer((req, res) => this.handle(req, res));
	}

	async start() {
		await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
		this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
	}

	handle(req: IncomingMessage, res: ServerResponse) {
		const u = new URL(req.url ?? "/", this.url);
		const p = u.pathname;
		if (req.method === "GET" && p === "/api/agents/listen") {
			if (this.unavailable > 0) {
				this.unavailable--;
				res.writeHead(503).end();
				return;
			}
			this.listens.push(u.searchParams);
			this.live?.end();
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			res.flushHeaders();
			this.live = res;
			clearInterval(this.beat);
			if (this.heartbeatMs) this.beat = setInterval(() => res.write(": hb\n\n"), this.heartbeatMs);
			req.on("close", () => {
				this.closedListens++;
				if (this.live === res) {
					this.live = undefined;
					clearInterval(this.beat);
				}
			});
			return;
		}
		const claim = req.method === "POST" && p.match(/^\/api\/agents\/claim\/(.+)$/);
		if (claim) {
			let raw = "";
			req.on("data", (c) => (raw += c));
			req.on("end", () => this.claim(decodeURIComponent(claim[1]), raw, req, res));
			return;
		}
		const started = req.method === "POST" && p.match(/^\/api\/agents\/started\/(.+)$/);
		if (started) {
			const id = decodeURIComponent(started[1]);
			this.startedPosts.push(id);
			if (this.startedDrop > 0) {
				this.startedDrop--;
				return void req.socket.destroy();
			}
			if (this.startedFail > 0) {
				this.startedFail--;
				return void res.writeHead(503).end();
			}
			if (this.startedConflict.has(id)) return void res.writeHead(409).end("{}");
			if (!this.started.includes(id)) this.started.push(id); // the real server answers a repeat 200 and changes nothing
			return void res.writeHead(200).end("{}");
		}
		const release = req.method === "POST" && p.match(/^\/api\/agents\/release\/(.+)$/);
		if (release) {
			const id = decodeURIComponent(release[1]);
			this.releases.push(id);
			this.claimed.delete(id);
			if (this.hang) return;
			return void res.writeHead(200).end("{}");
		}
		const del = req.method === "DELETE" && p.match(/^\/api\/agents\/(.+)$/);
		if (del) {
			this.deletes.push(decodeURIComponent(del[1]));
			if (this.hang) return;
			return void res.writeHead(200).end("{}");
		}
		const md = req.method === "GET" && p.match(/^\/api\/sends\/(.+)\/markdown$/);
		if (md) {
			const id = decodeURIComponent(md[1]);
			this.markdownFetches.push(id);
			this.log.push(`markdown ${id}`);
			if (this.markdownFail > 0) {
				this.markdownFail--;
				return void res.writeHead(503).end();
			}
			const answer = () => res.writeHead(200, { "content-type": "text/markdown" }).end(MD);
			if (this.markdownDelayMs) return void setTimeout(answer, this.markdownDelayMs);
			return void answer();
		}
		res.writeHead(404).end();
	}

	/** Like the real server: 200 once, and again to the same pid and host retrying; 409 otherwise. */
	claim(id: string, raw: string, req: IncomingMessage, res: ServerResponse) {
		this.claims.push(id);
		this.log.push(`claim ${id}`);
		let body: any = {};
		try {
			body = raw ? JSON.parse(raw) : {};
		} catch {
			return void res.writeHead(400).end("{}");
		}
		this.claimBodies.push(body);
		const who = body.pid !== undefined && body.host !== undefined ? `${body.pid}@${body.host}` : "";
		if (this.claimDrop > 0) {
			this.claimDrop--;
			return void req.socket.destroy();
		}
		if (this.claimFail > 0) {
			this.claimFail--;
			return void res.writeHead(503).end();
		}
		const held = this.claimed.get(id);
		const again = held !== undefined && held !== "" && held === who;
		if (this.refuseClaims.has(id) || (held !== undefined && !again)) return void res.writeHead(409).end("{}");
		this.claimed.set(id, who);
		if (this.claimLoseAnswer > 0) {
			this.claimLoseAnswer--;
			return void req.socket.destroy();
		}
		const answer = () => res.writeHead(200, { "content-type": "application/json" }).end("{}");
		if (this.claimDelayMs) return void setTimeout(answer, this.claimDelayMs);
		return void answer();
	}

	push(id: string, markdownUrl = `api/sends/${id}/markdown`) {
		this.live?.write(`event: send\ndata: ${JSON.stringify({ id, markdown_url: markdownUrl })}\n\n`);
	}

	/** Another pi registered the same session: the server tells this one and closes its stream. */
	supersede() {
		const res = this.live;
		res?.write(`event: superseded\ndata: {}\n\n`);
		setTimeout(() => res?.end(), 20);
	}

	async stop() {
		clearInterval(this.beat);
		this.live?.end();
		this.server.closeAllConnections();
		await new Promise<void>((r) => this.server.close(() => r()));
	}
}

type Handler = (event: any, ctx: any) => unknown;

/** The slice of the pi API the extension uses, recording what it is asked to do. */
function mockPi(systemPrompt = "You are a coding agent.") {
	const handlers = new Map<string, Handler[]>();
	const sent: { content: unknown; options: unknown }[] = [];
	const notes: string[] = [];
	const ctx = {
		hasUI: true,
		sessionManager: { getSessionId: () => SESSION },
		getSystemPrompt: () => systemPrompt,
		ui: { notify: (msg: string) => notes.push(msg) },
	};
	const pi = {
		on(name: string, fn: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), fn]);
		},
		sendUserMessage(content: unknown, options: unknown) {
			sent.push({ content, options });
		},
	};
	const emit = async (name: string, event: any = {}) => {
		for (const fn of handlers.get(name) ?? []) await fn({ type: name, ...event }, ctx);
	};
	return { pi, emit, sent, notes, ctx };
}

let server: FakeServer;
let env: NodeJS.ProcessEnv;
let shutdown: (() => Promise<void>) | undefined;

beforeEach(async () => {
	server = new FakeServer();
	await server.start();
	env = { AGENT_PAGES_CONFIG: "/nonexistent/config.toml", AGENT_PAGES_URL: server.url };
});

afterEach(async () => {
	await shutdown?.();
	shutdown = undefined;
	await server.stop();
});

async function startExtension(systemPrompt?: string, extraEnv: NodeJS.ProcessEnv = {}, reason = "startup", timings = {}) {
	const m = mockPi(systemPrompt);
	setup(m.pi as any, { ...FAST, ...timings, env: { ...env, ...extraEnv }, parentCommand: async () => undefined });
	await m.emit("session_start", { reason });
	shutdown = () => m.emit("session_shutdown", { reason: "quit" });
	return m;
}

test("base url: top-level base_url of the config, else AGENT_PAGES_URL, else nothing", async () => {
	assert.equal(readBaseUrl('# c\nbase_url = "https://pages.example.com:8443/"\n[roots]\nbase_url = "x"\n'), "https://pages.example.com:8443");
	assert.equal(readBaseUrl('[roots]\nbase_url = "https://nested"\n'), undefined);
	assert.equal(readBaseUrl("base_url = 'http://h:1/pages'"), "http://h:1/pages");
	const dir = mkdtempSync(join(tmpdir(), "api-inbox-"));
	const cfg = join(dir, "config.toml");
	writeFileSync(cfg, 'base_url = "https://from-config:1"\n');
	assert.equal(await resolveBaseUrl({ AGENT_PAGES_CONFIG: cfg, AGENT_PAGES_URL: "http://env:2" }), "https://from-config:1");
	assert.equal(await resolveBaseUrl({ AGENT_PAGES_CONFIG: join(dir, "none.toml"), AGENT_PAGES_URL: "http://env:2/" }), "http://env:2");
	assert.equal(await resolveBaseUrl({ AGENT_PAGES_CONFIG: join(dir, "none.toml") }), undefined);
	assert.equal(await resolveBaseUrl({ AGENT_PAGES_CONFIG: join(dir, "none.toml"), AGENT_PAGES_URL: "not a url" }), undefined);
});

test("harness: paseo only when the parent is the paseo daemon, herdr with an hc terminal, else pi", () => {
	assert.deepEqual(detectHarness({ PASEO_AGENT_ID: "a1", HC_TERMINAL_ID: "t4" }, "Paseo Daemon"), { harness: "paseo", where: "a1" });
	assert.deepEqual(detectHarness({ PASEO_AGENT_ID: "a1", HC_TERMINAL_ID: "t4" }, "/usr/bin/fish"), { harness: "herdr", where: "t4" });
	assert.deepEqual(detectHarness({ PASEO_AGENT_ID: "a1" }, "bash"), { harness: "pi", where: "" });
	assert.deepEqual(detectHarness({}, "Paseo Daemon"), { harness: "pi", where: "" });
});

test("subagent sessions are recognised by the pi-subagents prompt markers", () => {
	assert.equal(isSubagentPrompt('<active_agent name="worker"/>\n\nYou are'), true);
	assert.equal(isSubagentPrompt("x <sub_agent_context>\nYou are operating as a sub-agent"), true);
	assert.equal(isSubagentPrompt("You are a coding agent."), false);
});

test("registers on session_start with session, pid, host, harness and where", async () => {
	await startExtension(undefined, { HC_TERMINAL_ID: "t17" });
	await until(() => server.listens.length === 1, 3000, "listen");
	const q = server.listens[0];
	assert.equal(q.get("session"), SESSION);
	assert.equal(q.get("pid"), String(process.pid));
	assert.ok(q.get("host"));
	assert.equal(q.get("harness"), "herdr");
	assert.equal(q.get("where"), "t17");
});

test("retries the first connect until the server answers", async () => {
	server.unavailable = 2;
	await startExtension();
	await until(() => server.listens.length === 1, 3000, "listen after two refusals");
});

test("heartbeats keep the connection; silence makes it reconnect", async () => {
	server.heartbeatMs = 100;
	await startExtension();
	await until(() => server.listens.length === 1);
	await sleep(1000);
	assert.equal(server.listens.length, 1, "heartbeats every 100 ms keep one connection past the 400 ms watchdog");
	server.heartbeatMs = 0;
	server.live?.end(); // drop: the extension reconnects to a server that now stays silent
	await until(() => server.listens.length === 2, 2000, "reconnect after drop");
	await until(() => server.listens.length === 3, 2000, "reconnect after silence");
});

test("event -> claim -> followUp -> started when the message starts", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s1");
	await until(() => m.sent.length === 1, 3000, "injection");
	assert.deepEqual(server.claims, ["s1"]);
	assert.deepEqual(server.markdownFetches, ["s1"]);
	assert.deepEqual(m.sent[0], { content: MD, options: { deliverAs: "followUp" } });
	assert.deepEqual(m.notes, ["Page feedback queued from agent-pages"]);
	assert.deepEqual(server.started, []);
	await m.emit("message_start", { message: { role: "user", content: [{ type: "text", text: "something else" }] } });
	await m.emit("message_start", { message: { role: "user", content: [{ type: "text", text: MD }] } });
	await until(() => server.started.length === 1, 3000, "started");
	assert.deepEqual(server.started, ["s1"]);
	await m.emit("message_start", { message: { role: "user", content: [{ type: "text", text: MD }] } });
	await sleep(100);
	assert.deepEqual(server.started, ["s1"], "started is posted once");
});

test("claim 409 injects nothing", async () => {
	server.heartbeatMs = 100;
	server.refuseClaims.add("s2");
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s2");
	await until(() => server.claims.length === 1);
	await sleep(300);
	assert.equal(m.sent.length, 0);
	assert.deepEqual(server.claims, ["s2"], "409 is final: no retry");
	assert.deepEqual(server.markdownFetches, ["s2"], "the markdown is fetched before the claim");
	assert.deepEqual(m.notes, []);
});

test("the markdown is fetched, with retries, before the send is claimed", async () => {
	server.heartbeatMs = 100;
	server.markdownFail = 3;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s5");
	await until(() => m.sent.length === 1, 3000, "injection after markdown retries");
	assert.deepEqual(server.log, ["markdown s5", "markdown s5", "markdown s5", "markdown s5", "claim s5"]);
	assert.deepEqual(m.sent[0], { content: MD, options: { deliverAs: "followUp" } });
});

test("a markdown that never arrives is never claimed", async () => {
	server.heartbeatMs = 100;
	server.markdownFail = 1000;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s6");
	await sleep(700);
	const tries = server.markdownFetches.length;
	assert.ok(tries >= 3, `retried with backoff (${tries} fetches)`);
	await sleep(300);
	assert.equal(server.markdownFetches.length, tries, "gives up after the retry budget");
	assert.deepEqual(server.claims, []);
	assert.equal(m.sent.length, 0);
});

test("shutdown while the markdown is in flight claims nothing", async () => {
	server.heartbeatMs = 100;
	server.markdownDelayMs = 300;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s7");
	await until(() => server.markdownFetches.length === 1);
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	await sleep(500);
	assert.deepEqual(server.claims, []);
	assert.equal(m.sent.length, 0);
});

for (const end of ["session_compact", "session_compact_failed"]) {
	test(`deliveries wait for a running compaction until ${end}`, async () => {
		server.heartbeatMs = 100;
		const m = await startExtension();
		await until(() => server.listens.length === 1);
		await m.emit("session_before_compact", { reason: "threshold" });
		server.push("s8");
		await until(() => server.markdownFetches.length === 1, 3000, "markdown fetched meanwhile");
		await sleep(200);
		assert.deepEqual(server.claims, [], "not claimed during compaction");
		assert.equal(m.sent.length, 0);
		await m.emit(end, { reason: "threshold" });
		await until(() => m.sent.length === 1, 3000, "injection after compaction");
		assert.deepEqual(server.claims, ["s8"]);
	});
}

test("a claim the server did not commit (5xx, dropped connection) is retried", async () => {
	server.heartbeatMs = 100;
	server.claimFail = 2;
	server.claimDrop = 1;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s10");
	await until(() => m.sent.length === 1, 3000, "injection after claim retries");
	assert.deepEqual(server.claims, ["s10", "s10", "s10", "s10"]);
	assert.deepEqual(server.markdownFetches, ["s10"], "the markdown in hand is reused");
});

test("a claim names this pi, so a retry after a lost answer is answered again and delivered", async () => {
	server.heartbeatMs = 100;
	server.claimLoseAnswer = 1;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s18");
	await until(() => m.sent.length === 1, 3000, "injection after the lost answer");
	assert.deepEqual(server.claims, ["s18", "s18"]);
	assert.deepEqual(server.claimBodies, [
		{ pid: process.pid, host: hostname() },
		{ pid: process.pid, host: hostname() },
	]);
});

test("a failing claim stops retrying once the stream is gone", async () => {
	server.heartbeatMs = 100;
	server.claimFail = 1000;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s11");
	await until(() => server.claims.length >= 2, 3000, "claim retried");
	server.unavailable = 1000;
	server.live?.end();
	await sleep(300);
	const n = server.claims.length;
	await sleep(300);
	assert.equal(server.claims.length, n);
	assert.equal(m.sent.length, 0);
});

test("shutdown between claim and injection releases the claim", async () => {
	server.heartbeatMs = 100;
	server.claimDelayMs = 200;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s12");
	await until(() => server.claims.length === 1);
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	assert.equal(m.sent.length, 0);
	assert.deepEqual(server.releases, ["s12"]);
	assert.deepEqual(server.deletes, [SESSION]);
});

test("each message_start reports one send; shutdown releases the ones still queued", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	for (const [i, id] of ["s13", "s14", "s15"].entries()) {
		server.push(id); // the same markdown for all three
		await until(() => m.sent.length === i + 1, 3000, `injection of ${id}`);
	}
	const start = { message: { role: "user", content: [{ type: "text", text: MD }] } };
	await m.emit("message_start", start);
	await m.emit("message_start", start);
	await until(() => server.started.length === 2, 3000, "two started");
	assert.deepEqual(server.started, ["s13", "s14"]);
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	assert.deepEqual(server.releases, ["s15"]);
	assert.deepEqual(server.deletes, [SESSION]);
});

test("with the stream gone, shutdown sends nothing and does not wait", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s16");
	await until(() => m.sent.length === 1);
	server.unavailable = 1000;
	server.hang = true;
	server.live?.end();
	await until(() => server.closedListens === 1, 2000, "stream closed");
	await sleep(50);
	const t0 = Date.now();
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	assert.ok(Date.now() - t0 < 100, `shutdown took ${Date.now() - t0} ms`);
	assert.deepEqual(server.deletes, []);
	assert.deepEqual(server.releases, []);
});

test("shutdown waits for the server no longer than its deadline", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.hang = true;
	const t0 = Date.now();
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	const took = Date.now() - t0;
	assert.ok(took >= 300 && took < 700, `shutdown took ${took} ms`);
	assert.deepEqual(server.deletes, [SESSION]);
});

test("superseded: closes the stream, never reconnects, never sends DELETE", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s17");
	await until(() => m.sent.length === 1);
	server.supersede();
	await until(() => server.closedListens === 1, 2000, "stream closed");
	await sleep(400);
	assert.equal(server.listens.length, 1, "no reconnect");
	await m.emit("message_start", { message: { role: "user", content: [{ type: "text", text: MD }] } });
	await until(() => server.started.length === 1, 2000, "started still reported");
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	assert.deepEqual(server.deletes, []);
	assert.deepEqual(server.releases, []);
});

const STARTS = { message: { role: "user", content: [{ type: "text", text: MD }] } };

for (const reason of ["quit", "new", "resume", "fork"]) {
	test(`shutdown for ${reason} drops pi's queue, so the queued send is released`, async () => {
		server.heartbeatMs = 100;
		const m = await startExtension();
		await until(() => server.listens.length === 1);
		server.push("s19");
		await until(() => m.sent.length === 1);
		await m.emit("session_shutdown", { reason });
		shutdown = undefined;
		assert.deepEqual(server.releases, ["s19"]);
	});
}

test("reload keeps pi's queue: the send stays claimed and the next instance reports it started", async () => {
	server.heartbeatMs = 100;
	const m1 = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s20");
	await until(() => m1.sent.length === 1);
	await m1.emit("session_shutdown", { reason: "reload" });
	shutdown = undefined;
	assert.deepEqual(server.releases, [], "not released: pi delivers the queued follow-up after the reload");
	// pi builds a new extension instance; the old one gets no further events
	const m2 = await startExtension(undefined, {}, "reload");
	await m2.emit("message_start", STARTS); // before the new stream is even open
	await until(() => server.started.length === 1, 3000, "started from the new instance");
	assert.deepEqual(server.started, ["s20"]);
	await until(() => server.listens.length === 2, 3000, "new instance listens");
	assert.equal(m1.sent.length + m2.sent.length, 1);
	await m2.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	assert.deepEqual(server.releases, [], "started: nothing left to release");
});

test("a lost started report is sent again right after the next listen connect", async () => {
	server.heartbeatMs = 100;
	server.startedDrop = 1;
	const m = await startExtension(undefined, {}, "startup", { startedMinBackoffMs: 30_000, startedMaxBackoffMs: 60_000 });
	await until(() => server.listens.length === 1);
	server.push("s21");
	await until(() => m.sent.length === 1);
	await m.emit("message_start", STARTS);
	await until(() => server.startedPosts.length === 1, 3000, "first started attempt");
	await sleep(100);
	assert.deepEqual(server.started, [], "the first attempt was lost");
	server.live?.end(); // reconnect
	await until(() => server.listens.length === 2, 3000, "reconnect");
	await until(() => server.started.length === 1, 3000, "started resent after the connect");
	assert.deepEqual(server.started, ["s21"]);
});

test("a failing started report is retried with backoff until the server answers", async () => {
	server.heartbeatMs = 100;
	server.startedFail = 3;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s22");
	await until(() => m.sent.length === 1);
	await m.emit("message_start", STARTS);
	await until(() => server.started.length === 1, 3000, "started after retries");
	assert.deepEqual(server.startedPosts, ["s22", "s22", "s22", "s22"]);
	await sleep(300);
	assert.equal(server.startedPosts.length, 4, "no retry after the 200");
});

test("a 409 to a started report is final", async () => {
	server.heartbeatMs = 100;
	server.startedConflict.add("s23");
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s23");
	await until(() => m.sent.length === 1);
	await m.emit("message_start", STARTS);
	await until(() => server.startedPosts.length === 1);
	server.live?.end();
	await until(() => server.listens.length === 2);
	await sleep(300);
	assert.deepEqual(server.startedPosts, ["s23"]);
});

test("an unacknowledged started report survives a reload", async () => {
	server.heartbeatMs = 100;
	server.startedDrop = 1;
	const slow = { startedMinBackoffMs: 30_000, startedMaxBackoffMs: 60_000 };
	const m1 = await startExtension(undefined, {}, "startup", slow);
	await until(() => server.listens.length === 1);
	server.push("s24");
	await until(() => m1.sent.length === 1);
	await m1.emit("message_start", STARTS);
	await until(() => server.startedPosts.length === 1, 3000, "first started attempt");
	await sleep(50);
	await m1.emit("session_shutdown", { reason: "reload" });
	await startExtension(undefined, {}, "reload", slow);
	await until(() => server.listens.length === 2, 3000, "new instance listens");
	await until(() => server.started.length === 1, 3000, "started resent by the new instance");
	assert.deepEqual(server.started, ["s24"]);
	assert.deepEqual(server.releases, []);
});

test("a duplicate or re-pushed event is injected once", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s3");
	server.push("s3");
	await until(() => m.sent.length === 1);
	server.live?.end(); // reconnect; the server re-pushes the record
	await until(() => server.listens.length === 2);
	server.push("s3");
	await sleep(300);
	assert.equal(m.sent.length, 1);
	assert.deepEqual(server.claims, ["s3"]);
});

test("an absolute markdown url is fetched as given", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	server.push("s4", `${server.url}/api/sends/s4/markdown`);
	await until(() => m.sent.length === 1);
	assert.deepEqual(server.markdownFetches, ["s4"]);
});

test("shutdown sends DELETE and closes the stream", async () => {
	server.heartbeatMs = 100;
	const m = await startExtension();
	await until(() => server.listens.length === 1);
	await m.emit("session_shutdown", { reason: "quit" });
	shutdown = undefined;
	assert.deepEqual(server.deletes, [SESSION]);
	await until(() => server.closedListens === 1, 2000, "stream closed");
	await sleep(300);
	assert.equal(server.listens.length, 1, "no reconnect after shutdown");
});

test("a subagent session never registers", async () => {
	await startExtension('<active_agent name="worker"/>\n\nYou are a worker.');
	await sleep(300);
	assert.equal(server.listens.length, 0);
});

test("no base url: does nothing", async () => {
	env = { AGENT_PAGES_CONFIG: "/nonexistent/config.toml" };
	await startExtension();
	await sleep(300);
	assert.equal(server.listens.length, 0);
});
