/**
 * subagents-busy: keep the Herdr app showing pi as "working" while background
 * subagents run.
 *
 * @tintinweb/pi-subagents runs background agents in-process. Once the root
 * turn settles, pi's native reporter (OSC 7501, program-status-reporter.js)
 * reports done/idle/error even though children are still working, and the app
 * toasts "done" too early.
 *
 * pi has no extension API for the program status, so this extension watches
 * the reporter's own OSC 7501 writes on process.stdout:
 * - while any subagent is live (top-level, nested or workflow: the lifecycle
 *   events cover all three since pi-subagents 0.26.2) or a workflow run is
 *   between `workflow_started` and `workflow_settled`, a native resting report (done, idle,
 *   error) is replaced in flight by `working` with the same app name and the
 *   session name as message, the shape pi itself uses for `working`;
 * - native `working` and `blocked` reports always pass through untouched, so a
 *   root turn or an open dialog is never overwritten;
 * - when the last subagent finishes and nothing native happened since, the
 *   last native report is replayed verbatim, i.e. what pi would show.
 * It writes only after pi has written a status itself, so it inherits pi's
 * own support check (terminal answered the 7501 query, or PI_PROGRAM_STATUS).
 *
 * Only active inside the Herdr app (HC_TERMINAL_ID set) in interactive mode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatProgramStatus } from "@earendil-works/pi-tui";

const OSC_7501 = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const RESTING = new Set(["done", "idle", "error"]);
/** Grace before replaying the resting status, so a completion nudge that starts a new root turn does not flash "done". */
const RELEASE_DELAY_MS = 300;

interface NativeReport {
	raw: string;
	state: string;
	app?: string;
}

function parseReport(raw: string, body: string): NativeReport | undefined {
	// `?` is pi's feature query, not a status.
	if (body.startsWith("?")) return undefined;
	const fields = new Map<string, string>();
	for (const pair of body.split(":")) {
		const eq = pair.indexOf("=");
		if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
	}
	const state = fields.get("state");
	return state ? { raw, state, app: fields.get("app") } : undefined;
}

export default function subagentsBusy(pi: ExtensionAPI) {
	if (!process.env.HC_TERMINAL_ID || process.env.PI_PROGRAM_STATUS === "0") return;
	if (typeof formatProgramStatus !== "function") return;

	const live = new Set<string>();
	/** Last status pi itself wrote; undefined until pi reports (or if it never does). */
	let native: NativeReport | undefined;
	/** True while our `working` is what the terminal shows instead of `native`. */
	let holding = false;
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;
	let originalWrite: typeof process.stdout.write | undefined;
	let wrapper: typeof process.stdout.write | undefined;
	let active = false;

	function workingSequence(): string {
		let message: string | undefined;
		try {
			message = pi.getSessionName();
		} catch {
			message = undefined;
		}
		return formatProgramStatus({ state: "working", app: native?.app ?? "pi", message });
	}

	function writeOwn(sequence: string): void {
		if (!originalWrite) return;
		try {
			originalWrite.call(process.stdout, sequence);
		} catch {
			// A status light must never crash the session.
		}
	}

	/** Rewrites pi's OSC 7501 reports inside one stdout chunk. */
	function filter(chunk: string): string {
		if (!chunk.includes("\x1b]7501;")) return chunk;
		return chunk.replace(OSC_7501, (raw: string, body: string) => {
			const report = parseReport(raw, body);
			if (!report) return raw;
			native = report;
			if (live.size > 0 && RESTING.has(report.state)) {
				holding = true;
				return workingSequence();
			}
			holding = false;
			return raw;
		});
	}

	function install(): void {
		if (wrapper) return;
		const original = process.stdout.write;
		originalWrite = original;
		const wrapped = function (this: unknown, chunk: unknown, ...rest: unknown[]) {
			if (active && typeof chunk === "string") {
				try {
					chunk = filter(chunk);
				} catch {
					// Fall through with the chunk as it was.
				}
			}
			return (original as (...args: unknown[]) => boolean).call(this ?? process.stdout, chunk, ...rest);
		} as typeof process.stdout.write;
		wrapper = wrapped;
		process.stdout.write = wrapped;
	}

	function uninstall(): void {
		active = false;
		if (releaseTimer) clearTimeout(releaseTimer);
		releaseTimer = undefined;
		if (wrapper && process.stdout.write === wrapper && originalWrite) {
			process.stdout.write = originalWrite;
		}
		// If another wrapper was stacked on top, ours stays as a passthrough (active = false).
		wrapper = undefined;
	}

	function hold(): void {
		if (releaseTimer) {
			clearTimeout(releaseTimer);
			releaseTimer = undefined;
		}
		if (!active || holding || !native || !RESTING.has(native.state)) return;
		holding = true;
		writeOwn(workingSequence());
	}

	function scheduleRelease(): void {
		if (releaseTimer) clearTimeout(releaseTimer);
		releaseTimer = setTimeout(() => {
			releaseTimer = undefined;
			if (!active || live.size > 0 || !holding) return;
			holding = false;
			// Still resting since pi's last report (a new turn or dialog would have cleared `holding`).
			if (native && RESTING.has(native.state)) writeOwn(native.raw);
		}, RELEASE_DELAY_MS);
		releaseTimer.unref?.();
	}

	function idOf(data: unknown): string | undefined {
		const id = (data as { id?: unknown } | undefined)?.id;
		return typeof id === "string" && id.length > 0 ? id : undefined;
	}

	const add = (data: unknown) => {
		const id = idOf(data);
		if (!id) return;
		live.add(id);
		hold();
	};
	const remove = (data: unknown) => {
		const id = idOf(data);
		if (id && live.delete(id) && live.size === 0) scheduleRelease();
	};

	pi.events.on("subagents:created", add);
	pi.events.on("subagents:started", add);
	pi.events.on("subagents:completed", remove);
	pi.events.on("subagents:failed", remove);
	// A workflow run counts as live from start to settle (its id is `wf_…`), so the gap between two of its agents does not release.
	pi.events.on("subagents:workflow_started", add);
	pi.events.on("subagents:workflow_settled", remove);
	pi.events.on("subagents:disposed", () => {
		live.clear();
		scheduleRelease();
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		install();
		active = true;
	});
	pi.on("session_shutdown", () => {
		live.clear();
		uninstall();
	});
}
