/**
 * Shared notification helper.
 *
 * Sends a desktop / terminal notification through the best available channel:
 *   - macOS  -> terminal-notifier (osascript if it is missing)
 *   - Kitty  -> OSC 99
 *   - Windows Terminal -> PowerShell toast
 *   - other  -> OSC 777 (Ghostty, iTerm2, WezTerm)
 *
 * A bell (\x07) is always emitted so tmux `monitor-activity` / `monitor-bell`
 * pick up the event regardless of the terminal in use.
 *
 * Used by:
 *   - notify.ts          -> on `agent_end` (agent finished its turn)
 *   - shared/quiet-ui.ts -> on entering an interactive UI (tool waiting for input)
 */

import { execFile } from "node:child_process";

const PI_GROUP = "pi-coding-agent";

function notifyMacOS(title: string, body: string): void {
	// terminal-notifier (brew install terminal-notifier) groups and replaces
	// toasts. Set PI_NOTIFY_SENDER to an app bundle id to borrow its icon.
	const sender = process.env.PI_NOTIFY_SENDER;
	execFile(
		"terminal-notifier",
		[...(sender ? ["-sender", sender] : []), "-title", title, "-message", body, "-group", PI_GROUP],
		(err) => {
			if (!err) return;
			// Not installed: fall back to AppleScript; errors are swallowed, the bell already rang.
			const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
		},
	);
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
	const type = "Windows.UI.Notifications";
	const script = [
		`[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime] > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent([${type}.ToastTemplateType]::ToastText01)`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show([${type}.ToastNotification]::new($xml))`,
	].join("; ");
	execFile("powershell.exe", ["-NoProfile", "-Command", script]);
}

function sendBell(): void {
	process.stdout.write("\x07");
}

// Run mode recorded by notify.ts on session_start. Kept on globalThis because
// pi loads each extension's copy of this module separately (see herdr-bus.ts).
const MODE_KEY = "__piNotifyMode";

// Once a TUI session has claimed the process, later non-TUI sessions leave the
// mode alone: in-process pi-subagents sessions start in "print" mode and used to
// overwrite it, which silenced the root session's bell after the first
// background agent.
export function setNotifyMode(mode: string): void {
	const g = globalThis as Record<string, unknown>;
	if (g[MODE_KEY] === "tui" && mode !== "tui") return;
	g[MODE_KEY] = mode;
}

// Unknown mode (notify.ts not loaded yet) counts as the TUI, so an interactive
// session never loses a notification to load order.
function isTui(): boolean {
	const mode = (globalThis as Record<string, unknown>)[MODE_KEY];
	return mode === undefined || mode === "tui";
}

/**
 * Send a notification via the best channel for the current platform / terminal.
 * Always emits a bell first so tmux monitor-bell / monitor-activity reacts.
 * Does nothing outside the TUI (print, JSON, RPC modes).
 *
 * Inside herdr (HERDR_ENV=1) the desktop toast is suppressed: herdr already
 * posts its own focus-aware system toast off the pane "blocked" / "done" state
 * (raised via shared/herdr-bus and the herdr-agent-state integration). Posting
 * our own terminal-notifier toast on top produced a duplicate notification.
 * The bell still fires so any bell-based watcher keeps working.
 */
export function notify(title: string, body: string): void {
	// Print, JSON and RPC modes own stdout: no bell, no OSC, no toast.
	if (!isTui()) return;

	sendBell();

	if (process.env.HERDR_ENV === "1") return;

	if (process.platform === "darwin") {
		notifyMacOS(title, body);
	} else if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

/**
 * Convenience wrapper used by interactive tools when they begin waiting
 * for user input. Debounced per-tick so several rapid back-to-back calls
 * (e.g. nested withQuietSpinner) only fire once.
 */
let lastInputNotifyAt = 0;
const INPUT_NOTIFY_DEBOUNCE_MS = 200;

export function notifyInputNeeded(toolName?: string): void {
	const now = Date.now();
	if (now - lastInputNotifyAt < INPUT_NOTIFY_DEBOUNCE_MS) return;
	lastInputNotifyAt = now;
	const body = toolName ? `Waiting for input (${toolName})` : "Waiting for input";
	notify("Pi", body);
}
