/**
 * agent-pages inbox: lets the agent-pages server hand a page's comment export to the pi session
 * that wrote the page ("Send to agent"), queued as a follow-up until the current turn ends.
 *
 * On every session_start (startup, /new, /resume, fork, reload) it opens one SSE stream,
 * `GET <base>/api/agents/listen?session&pid&host&harness&where`, and holds it with no polling:
 * besides the per-send retries below, the only timers are the reconnect backoff (2 s doubling to
 * 60 s, the first connect included) and a 60 s silence watchdog that the server's 20 s heartbeat
 * keeps from firing.
 * A pushed event `{id, markdown_url}` first fetches the markdown (retried 1 s doubling, ~30 s in all),
 * waits out a running compaction, then claims it with `POST /api/agents/claim/<id>` (body `{pid, host}`,
 * so a retry whose first answer was lost is answered 200 again for this pi) and queues it with
 * `pi.sendUserMessage(md, { deliverAs: "followUp" })`; `POST /api/agents/started/<id>` follows when
 * that user message starts, retried 2 s doubling to 60 s until the server answers 2xx or 4xx (409:
 * not claimed), and sent again right after each listen connect.
 * A claim the server did not commit (network error, 5xx) is retried 2 s doubling to 60 s while the
 * stream is live; a 409, a duplicate push and a re-push after reconnecting are ignored (ids in memory).
 * A claimed send that cannot be delivered (shut down between claim and injection, or still queued
 * when the session ends) goes back with `POST /api/agents/release/<id>`.
 * The exception is /reload (session_shutdown reason "reload"): pi keeps its follow-up queue across it,
 * so the queued sends stay claimed (same pid and host) and, with the started reports not yet
 * acknowledged, pass through a `globalThis` map keyed by session id to the next instance of this
 * extension, which reports them started; quit, /new, /resume
 * and fork dispose of the session and its queue, so their queued sends are released.
 * session_shutdown sends those releases and `DELETE /api/agents/<session>` only while the stream is
 * live, with one short deadline, then closes the stream.
 * An SSE event `superseded` (another pi took over this session) closes the stream for good, with no DELETE.
 *
 * The base URL is `base_url` from the agent-pages config (`$AGENT_PAGES_CONFIG`, else
 * `$XDG_CONFIG_HOME/agent-pages/config.toml`, else `~/.config/agent-pages/config.toml`, the same
 * lookup as agent-pages itself), else `$AGENT_PAGES_URL`; with neither the extension does nothing.
 * Subagent sessions (pi-subagents children, recognised by their prompt markers) never register.
 * Nothing here throws into pi or blocks startup, and the one notice is the line shown on injection.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const SILENCE_MS = 60_000;
const FETCH_MIN_BACKOFF_MS = 1_000;
const FETCH_BUDGET_MS = 30_000;
const CLAIM_MIN_BACKOFF_MS = 2_000;
const CLAIM_MAX_BACKOFF_MS = 60_000;
const STARTED_MIN_BACKOFF_MS = 2_000;
const STARTED_MAX_BACKOFF_MS = 60_000;
const SHUTDOWN_MS = 1_500; // Paseo sends SIGKILL 2 s after closing a pi's stdin
const REQUEST_MS = 10_000;
const NOTICE = "Page feedback queued from agent-pages";
/** Where a reloading instance leaves its ledger for the next one: one map per process, keyed by session id. */
const HANDOVER = Symbol.for("agent-pages-inbox.handover");

export interface Options {
	env?: NodeJS.ProcessEnv;
	/** SSE reconnect backoff. */
	minBackoffMs?: number;
	maxBackoffMs?: number;
	silenceMs?: number;
	/** Markdown fetch: first retry delay, doubling until the summed delays reach the budget. */
	fetchMinBackoffMs?: number;
	fetchBudgetMs?: number;
	/** Retry backoff of a claim the server did not commit. */
	claimMinBackoffMs?: number;
	claimMaxBackoffMs?: number;
	/** Retry backoff of a started report the server did not acknowledge. */
	startedMinBackoffMs?: number;
	startedMaxBackoffMs?: number;
	/** One deadline for every request sent on shutdown (releases and DELETE). */
	shutdownMs?: number;
	/** Command line of this pi's parent process; the default reads `/proc` or asks `ps`. */
	parentCommand?: () => Promise<string | undefined>;
}

/** `base_url` from the top level of an agent-pages config (keys under a `[table]` do not count), without a trailing slash. */
export function readBaseUrl(toml: string): string | undefined {
	const top = toml.split(/^\s*\[/m)[0];
	const m = top.match(/^\s*base_url\s*=\s*(["'])(.*?)\1/m);
	return m ? cleanUrl(m[2]) : undefined;
}

function cleanUrl(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const u = new URL(raw.trim());
		if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
		return u.href.replace(/\/+$/, "");
	} catch {
		return undefined;
	}
}

export function configPath(env: NodeJS.ProcessEnv): string {
	if (env.AGENT_PAGES_CONFIG) return env.AGENT_PAGES_CONFIG;
	return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agent-pages", "config.toml");
}

/** The server's base URL: the config's `base_url` when present, else `AGENT_PAGES_URL`, else undefined. */
export async function resolveBaseUrl(env: NodeJS.ProcessEnv): Promise<string | undefined> {
	try {
		const fromConfig = readBaseUrl(await readFile(configPath(env), "utf-8"));
		if (fromConfig) return fromConfig;
	} catch {
		// no config on this machine
	}
	return cleanUrl(env.AGENT_PAGES_URL);
}

/**
 * Where this pi runs: `paseo` when it is a Paseo agent itself (`PASEO_AGENT_ID` set and the parent
 * process is the Paseo daemon; a shell inside an agent inherits the variable, so it alone is not enough),
 * `herdr` in an hc terminal (`HC_TERMINAL_ID`), else plain `pi`.
 */
export function detectHarness(env: NodeJS.ProcessEnv, parentCommand: string | undefined): { harness: string; where: string } {
	if (env.PASEO_AGENT_ID && parentCommand && /paseo/i.test(parentCommand)) return { harness: "paseo", where: env.PASEO_AGENT_ID };
	if (env.HC_TERMINAL_ID) return { harness: "herdr", where: env.HC_TERMINAL_ID };
	return { harness: "pi", where: "" };
}

/** pi-subagents children carry no env marker; their system prompt starts with `<active_agent name="..."/>` (see prune/index.ts). */
export function isSubagentPrompt(prompt: string): boolean {
	return /<active_agent name=|<sub_agent_context>|operating as a sub-agent/.test(prompt);
}

async function defaultParentCommand(): Promise<string | undefined> {
	const ppid = process.ppid;
	try {
		return (await readFile(`/proc/${ppid}/cmdline`, "utf-8")).replace(/\0/g, " ").trim();
	} catch {
		// no /proc (macOS)
	}
	return new Promise((resolve) => {
		try {
			execFile("ps", ["-o", "command=", "-p", String(ppid)], { timeout: 2_000 }, (err, out) =>
				resolve(err ? undefined : String(out).trim()),
			);
		} catch {
			resolve(undefined);
		}
	});
}

function messageText(message: any): string | undefined {
	if (!message || message.role !== "user") return undefined;
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return undefined;
	return message.content
		.filter((b: any) => b?.type === "text")
		.map((b: any) => b.text)
		.join("");
}

type Timings = Required<Omit<Options, "env" | "parentCommand">>;

/** Resolves once `signal` aborts. */
function whenAborted(signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

/** Open between compactions: `session_before_compact` holds it until `session_compact` or `session_compact_failed`. */
class CompactionGate {
	private held = false;
	private waiters: (() => void)[] = [];

	hold(): void {
		this.held = true;
	}

	open(): void {
		this.held = false;
		for (const resolve of this.waiters.splice(0)) resolve();
	}

	/** Resolves when no compaction runs, or when `signal` aborts. */
	wait(signal: AbortSignal): Promise<void> {
		if (!this.held || signal.aborted) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				signal.removeEventListener("abort", done);
				resolve();
			};
			this.waiters.push(done);
			signal.addEventListener("abort", done, { once: true });
		});
	}
}

/** What a ledger passes to the next extension instance across /reload. */
interface Handover {
	base: string | undefined;
	awaitingStart: [string, string[]][];
	unacknowledged: string[];
}

function handovers(): Map<string, Handover> {
	const g = globalThis as any;
	if (!(g[HANDOVER] instanceof Map)) g[HANDOVER] = new Map();
	return g[HANDOVER];
}

/**
 * One session's injected sends until their user message starts, and their started reports until the
 * server acknowledges them; outlives the Inbox, and a reload hands it on.
 */
class Ledger {
	/** Injected text -> send ids in injection order, until the matching user messages start. */
	private readonly awaitingStart = new Map<string, string[]>();
	/** Started sends whose report the server has not acknowledged yet, with their retry state. */
	private readonly unacknowledged = new Map<string, { delay: number; timer?: NodeJS.Timeout; inFlight: boolean }>();
	/** Set once the Inbox knows the server; reports wait for it. */
	base: string | undefined;
	private handedOver = false;
	private readonly opts: Timings;

	constructor(opts: Timings, from?: Handover) {
		this.opts = opts;
		this.base = from?.base;
		for (const [text, ids] of from?.awaitingStart ?? []) if (ids.length) this.awaitingStart.set(text, [...ids]);
		for (const id of from?.unacknowledged ?? []) this.unacknowledged.set(id, { delay: opts.startedMinBackoffMs, inFlight: false });
		this.flush();
	}

	queued(text: string, id: string): void {
		const ids = this.awaitingStart.get(text) ?? [];
		ids.push(id);
		this.awaitingStart.set(text, ids);
	}

	/** Every send still waiting for its message, removed from the ledger (to be released). */
	drainQueued(): string[] {
		const ids = [...this.awaitingStart.values()].flat();
		this.awaitingStart.clear();
		return ids;
	}

	/** A user message started: if it is an injected export, report the oldest send with that text. */
	onUserMessageStart(message: unknown): void {
		const text = messageText(message);
		if (text === undefined) return;
		const ids = this.awaitingStart.get(text);
		const id = ids?.shift();
		if (!id) return;
		if (!ids?.length) this.awaitingStart.delete(text);
		this.unacknowledged.set(id, { delay: this.opts.startedMinBackoffMs, inFlight: false });
		void this.report(id);
	}

	/** Sends every unacknowledged report now, with its backoff reset: the listen stream just connected. */
	flush(): void {
		for (const [id, entry] of this.unacknowledged) {
			entry.delay = this.opts.startedMinBackoffMs;
			void this.report(id);
		}
	}

	/** One started report; until the server answers 2xx or 4xx, the next try is scheduled with backoff. */
	private async report(id: string): Promise<void> {
		const entry = this.unacknowledged.get(id);
		if (!entry || entry.inFlight || this.handedOver || !this.base) return; // without a base, the first connect flushes it
		clearTimeout(entry.timer);
		entry.inFlight = true;
		let status: number | undefined;
		try {
			const res = await fetch(`${this.base}/api/agents/started/${encodeURIComponent(id)}`, {
				method: "POST",
				signal: AbortSignal.timeout(REQUEST_MS),
			});
			status = res.status;
			await res.body?.cancel().catch(() => {});
		} catch {
			// unreachable or cut off: maybe not recorded
		}
		entry.inFlight = false;
		if (this.unacknowledged.get(id) !== entry) return;
		// 2xx: recorded (a repeat is answered 200 too); 4xx: cannot succeed (409: the send is not claimed)
		if (status !== undefined && status >= 200 && status < 500) {
			this.unacknowledged.delete(id);
			return;
		}
		if (this.handedOver) return;
		const delay = entry.delay;
		entry.delay = Math.min(entry.delay * 2, this.opts.startedMaxBackoffMs);
		entry.timer = setTimeout(() => void this.report(id), delay);
		entry.timer.unref?.();
	}

	/** The state the next instance takes over after /reload; this ledger stops reporting. */
	handOver(): Handover {
		this.handedOver = true;
		for (const entry of this.unacknowledged.values()) clearTimeout(entry.timer);
		const out = {
			base: this.base,
			awaitingStart: [...this.awaitingStart.entries()].map(([t, ids]): [string, string[]] => [t, [...ids]]),
			unacknowledged: [...this.unacknowledged.keys()],
		};
		this.awaitingStart.clear();
		this.unacknowledged.clear();
		return out;
	}
}

/** One session's listener: the SSE stream, its reconnects, and the claim and delivery of pushed sends. */
class Inbox {
	private stopped = false;
	/** Reading a response of the listen request; cleared as soon as that connection falls through. */
	private live = false;
	/** Set when stopping: whether a claimed send that cannot be delivered is released. */
	private mayRelease = false;
	private shutdownSignal: AbortSignal | undefined;
	/** Aborted on stop: wakes every backoff sleep and compaction wait. */
	private readonly halted = new AbortController();
	private controller: AbortController | undefined;
	private retryTimer: NodeJS.Timeout | undefined;
	private watchdog: NodeJS.Timeout | undefined;
	private backoff: number;
	private readonly seen = new Set<string>();
	/** Deliveries from their claim to their injection or release; stop() waits for them within its deadline. */
	private readonly claiming = new Set<Promise<void>>();

	private readonly pi: ExtensionAPI;
	private readonly ctx: ExtensionContext;
	private readonly base: string;
	private readonly session: string;
	private readonly query: URLSearchParams;
	private readonly opts: Timings;
	private readonly gate: CompactionGate;
	private readonly ledger: Ledger;

	constructor(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		base: string,
		session: string,
		query: URLSearchParams,
		opts: Timings,
		gate: CompactionGate,
		ledger: Ledger,
	) {
		this.pi = pi;
		this.ctx = ctx;
		this.base = base;
		this.session = session;
		this.query = query;
		this.opts = opts;
		this.gate = gate;
		this.ledger = ledger;
		ledger.base = base;
		this.backoff = opts.minBackoffMs;
	}

	/** Waits `ms`, or less when the inbox stops. */
	private sleep(ms: number): Promise<void> {
		const signal = this.halted.signal;
		if (signal.aborted) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", done);
				resolve();
			};
			const timer = setTimeout(done, ms);
			timer.unref?.();
			signal.addEventListener("abort", done, { once: true });
		});
	}

	private api(path: string): string {
		return `${this.base}/api/${path}`;
	}

	start(): void {
		void this.connect();
	}

	private armWatchdog(): void {
		clearTimeout(this.watchdog);
		this.watchdog = setTimeout(() => this.controller?.abort(), this.opts.silenceMs);
		this.watchdog.unref?.();
	}

	private async connect(): Promise<void> {
		if (this.stopped) return;
		const controller = new AbortController();
		this.controller = controller;
		this.armWatchdog();
		try {
			const res = await fetch(`${this.api("agents/listen")}?${this.query}`, {
				signal: controller.signal,
				headers: { accept: "text/event-stream" },
			});
			if (!res.ok || !res.body) {
				await res.body?.cancel().catch(() => {});
				throw new Error(`listen: HTTP ${res.status}`);
			}
			this.live = true;
			this.ledger.flush(); // a started report lost while the server was away
			await this.read(res.body);
		} catch {
			// refused, dropped, or aborted by the watchdog or by stop()
		}
		this.live = false;
		clearTimeout(this.watchdog);
		if (controller === this.controller) this.controller = undefined;
		if (this.stopped) return;
		const delay = this.backoff;
		this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs);
		this.retryTimer = setTimeout(() => void this.connect(), delay);
		this.retryTimer.unref?.();
	}

	private async read(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		let event = { type: "", data: [] as string[] };
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			if (this.stopped) return;
			this.armWatchdog();
			this.backoff = this.opts.minBackoffMs; // bytes arrived: the server is there
			buf += decoder.decode(value, { stream: true });
			let nl: number;
			while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
				if (line === "") {
					if (event.data.length || event.type) this.onEvent(event.type, event.data.join("\n"));
					if (this.stopped) return;
					event = { type: "", data: [] };
					continue;
				}
				if (line.startsWith(":")) continue; // heartbeat comment
				const colon = line.indexOf(":");
				const field = colon < 0 ? line : line.slice(0, colon);
				const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
				if (field === "event") event.type = value;
				else if (field === "data") event.data.push(value);
			}
		}
	}

	private onEvent(type: string, data: string): void {
		if (type === "superseded") return this.supersede();
		let payload: any;
		try {
			payload = JSON.parse(data);
		} catch {
			return;
		}
		const id = payload?.id ?? payload?.send_id ?? payload?.sendId;
		const url = payload?.markdown_url ?? payload?.markdownUrl;
		if (typeof id !== "string" || !id || typeof url !== "string" || !url) return;
		void this.deliver(id, url).catch(() => {});
	}

	/** Markdown first, then the end of any compaction, then the claim and the injection. */
	private async deliver(id: string, markdownUrl: string): Promise<void> {
		if (this.seen.has(id)) return;
		this.seen.add(id);
		const md = await this.fetchMarkdown(markdownUrl);
		if (md !== undefined) await this.gate.wait(this.halted.signal);
		if (md === undefined || this.stopped) {
			// nothing claimed: the record stays pending and comes back with the next push
			this.seen.delete(id);
			return;
		}
		const work = this.claimAndInject(id, md);
		this.claiming.add(work);
		try {
			await work;
		} finally {
			this.claiming.delete(work);
		}
	}

	private async claimAndInject(id: string, md: string): Promise<void> {
		if (!(await this.claim(id))) return;
		await this.gate.wait(this.halted.signal); // a compaction that started during the claim
		if (this.stopped) {
			await this.release(id);
			return;
		}
		this.ledger.queued(md, id);
		// Never throws: pi reports a failed send through its own emitError.
		this.pi.sendUserMessage(md, { deliverAs: "followUp" });
		try {
			this.ctx.ui.notify(NOTICE, "info");
		} catch {
			// no UI in this mode
		}
	}

	/** True once the server committed the claim to this session; false when it is not ours to deliver. */
	private async claim(id: string): Promise<boolean> {
		let backoff = this.opts.claimMinBackoffMs;
		for (;;) {
			if (this.stopped) {
				this.seen.delete(id);
				return false;
			}
			let status: number | undefined;
			try {
				// Naming this pi lets the server answer 200 again when a committed claim's answer was lost.
				const res = await fetch(this.api(`agents/claim/${encodeURIComponent(id)}`), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ pid: Number(this.query.get("pid")), host: this.query.get("host") }),
					signal: AbortSignal.timeout(REQUEST_MS),
				});
				status = res.status;
				await res.body?.cancel().catch(() => {});
			} catch {
				// unreachable or cut off: not committed
			}
			if (status === 200) return true;
			if (status === 409) return false; // claimed elsewhere or earlier: final
			const uncommitted = status === undefined || status >= 500;
			if (!uncommitted || !this.live || this.stopped) {
				// left pending: a re-push after reconnecting starts over
				this.seen.delete(id);
				return false;
			}
			await this.sleep(backoff);
			backoff = Math.min(backoff * 2, this.opts.claimMaxBackoffMs);
			if (!this.live) {
				this.seen.delete(id);
				return false;
			}
		}
	}

	/** Hands a claimed send back to the server; best effort, within the shutdown deadline. */
	private async release(id: string): Promise<void> {
		if (!this.mayRelease) return;
		try {
			const res = await fetch(this.api(`agents/release/${encodeURIComponent(id)}`), {
				method: "POST",
				signal: this.shutdownSignal ?? AbortSignal.timeout(this.opts.shutdownMs),
			});
			await res.body?.cancel().catch(() => {});
		} catch {
			// the server's own timeout on unstarted claims covers it
		}
	}

	/** The markdown at `url` (absolute, or relative to the base URL), retried with backoff; nothing is claimed yet. */
	private async fetchMarkdown(url: string): Promise<string | undefined> {
		let target: string;
		try {
			target = new URL(url, `${this.base}/`).href;
		} catch {
			return undefined;
		}
		let delay = this.opts.fetchMinBackoffMs;
		let waited = 0;
		for (;;) {
			if (this.stopped) return undefined;
			try {
				const res = await fetch(target, { signal: AbortSignal.timeout(REQUEST_MS) });
				if (res.ok) return await res.text();
				await res.body?.cancel().catch(() => {});
			} catch {
				// retry below
			}
			if (waited >= this.opts.fetchBudgetMs || this.stopped) return undefined;
			await this.sleep(delay);
			waited += delay;
			delay *= 2;
		}
	}

	/** Stops claiming and reconnecting; leaves already injected sends to report their start. */
	private halt(): void {
		this.stopped = true;
		clearTimeout(this.retryTimer);
		clearTimeout(this.watchdog);
		this.halted.abort();
	}

	/** Another pi registered this session: the server now pushes to it, so close for good and send no DELETE. */
	private supersede(): void {
		if (this.stopped) return;
		this.mayRelease = true; // the server is up; a send claimed meanwhile goes back to the new holder
		this.halt();
		this.controller?.abort();
	}

	/**
	 * Session end: only while the stream is live, release every claimed send that will not start here
	 * (queued follow-ups die with quit, /new, /resume and fork, but `keepQueued` for reload, which keeps
	 * them; claims still in flight always) and DELETE the session, all within one deadline; with the
	 * stream gone, send nothing and return at once.
	 */
	async stop(keepQueued = false): Promise<void> {
		if (this.stopped) return;
		this.mayRelease = this.live;
		this.halt();
		if (this.mayRelease) {
			const deadline = AbortSignal.timeout(this.opts.shutdownMs);
			this.shutdownSignal = deadline;
			const queued = keepQueued ? [] : this.ledger.drainQueued();
			const requests = [
				...queued.map((id) => this.release(id)),
				...this.claiming,
				fetch(this.api(`agents/${encodeURIComponent(this.session)}`), { method: "DELETE", signal: deadline })
					.then((res) => res.body?.cancel())
					.catch(() => {}), // the server drops the entry on EOF anyway
			];
			await Promise.race([Promise.allSettled(requests), whenAborted(deadline)]);
		}
		this.controller?.abort();
	}
}

export function setup(pi: ExtensionAPI, options: Options = {}): void {
	const env = options.env ?? process.env;
	const timings: Timings = {
		minBackoffMs: options.minBackoffMs ?? MIN_BACKOFF_MS,
		maxBackoffMs: options.maxBackoffMs ?? MAX_BACKOFF_MS,
		silenceMs: options.silenceMs ?? SILENCE_MS,
		fetchMinBackoffMs: options.fetchMinBackoffMs ?? FETCH_MIN_BACKOFF_MS,
		fetchBudgetMs: options.fetchBudgetMs ?? FETCH_BUDGET_MS,
		claimMinBackoffMs: options.claimMinBackoffMs ?? CLAIM_MIN_BACKOFF_MS,
		claimMaxBackoffMs: options.claimMaxBackoffMs ?? CLAIM_MAX_BACKOFF_MS,
		startedMinBackoffMs: options.startedMinBackoffMs ?? STARTED_MIN_BACKOFF_MS,
		startedMaxBackoffMs: options.startedMaxBackoffMs ?? STARTED_MAX_BACKOFF_MS,
		shutdownMs: options.shutdownMs ?? SHUTDOWN_MS,
	};
	const gate = new CompactionGate();
	let inbox: Inbox | undefined;
	let ledger: Ledger | undefined;
	let ledgerSession: string | undefined;
	let generation = 0;

	/** On reload the ledger goes to the next instance and the queued sends stay claimed; otherwise they are released. */
	const stop = async (reason?: string) => {
		generation++;
		const current = inbox;
		inbox = undefined;
		const reload = reason === "reload";
		if (reload && ledger && ledgerSession) handovers().set(ledgerSession, ledger.handOver());
		ledger = undefined;
		ledgerSession = undefined;
		await current?.stop(reload);
	};

	pi.on("session_start", async (_event, ctx) => {
		try {
			await stop();
			let prompt = "";
			try {
				prompt = ctx.getSystemPrompt();
			} catch {
				// no prompt yet
			}
			if (isSubagentPrompt(prompt)) return;
			const session = ctx.sessionManager.getSessionId();
			if (!session) return;
			// Set up before anything async: a follow-up queued before a reload may start at once.
			const handed = handovers().get(session);
			handovers().delete(session);
			const mine = generation;
			const own = new Ledger(timings, handed);
			ledger = own;
			ledgerSession = session;
			// Not awaited: resolving the URL and the harness must never hold up startup.
			void (async () => {
				const base = await resolveBaseUrl(env);
				if (!base) return;
				const parent = env.PASEO_AGENT_ID ? await (options.parentCommand ?? defaultParentCommand)() : undefined;
				const { harness, where } = detectHarness(env, parent);
				if (mine !== generation) return; // shut down meanwhile
				const query = new URLSearchParams({ session, pid: String(process.pid), host: hostname(), harness, where });
				inbox = new Inbox(pi, ctx, base, session, query, timings, gate, own);
				inbox.start();
			})().catch(() => {});
		} catch {
			// never throw into pi
		}
	});

	pi.on("message_start", (event) => {
		try {
			ledger?.onUserMessageStart(event.message);
		} catch {
			// ignore
		}
	});

	// Compaction rewrites the context a follow-up would join, so deliveries wait for it to end.
	pi.on("session_before_compact", () => {
		gate.hold();
	});
	pi.on("session_compact", () => {
		gate.open();
	});
	pi.on("session_compact_failed", () => {
		gate.open();
	});

	pi.on("session_shutdown", async (event) => {
		try {
			await stop((event as { reason?: string } | undefined)?.reason);
		} catch {
			// ignore
		}
	});
}

export default function (pi: ExtensionAPI) {
	setup(pi);
}
