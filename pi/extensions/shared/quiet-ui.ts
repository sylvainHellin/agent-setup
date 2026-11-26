/**
 * Quiet-UI helpers
 *
 * The interactive Loader (working spinner) lives in `statusContainer` and ticks
 * every 80 ms while the agent is streaming. When a tool / hook opens a custom
 * UI via ctx.ui.custom() that pushes the chat history above the visible
 * viewport (e.g. large questionnaires or dangerous-command prompts in long
 * sessions), each spinner tick changes a line above the
 * viewport. pi-tui's doRender() falls into the
 *
 *     if (firstChanged < prevViewportTop) fullRender(true)  // ESC[2J ESC[H ESC[3J
 *
 * branch and clears + redraws the entire screen ~12 times per second.
 *
 * Terminals without reliable synchronized output (ESC[?2026h) show this as
 * rapid alternation between the chat history and the custom UI.
 *
 * `withQuietSpinner()` and `withQuietSpinnerSync()` pause the indicator for
 * the duration of an interactive flow. `Loader.restartAnimation()` skips
 * `setInterval` when frames.length <= 1, so passing `frames: []` cleanly stops
 * the ticking without removing the loader from the tree. Calling
 * `setWorkingIndicator()` with no argument restores the default spinner.
 *
 * Side-effect: every entry into `withQuietSpinner` corresponds to a tool /
 * hook waiting on the user. We fire `notifyInputNeeded()` so the bell and,
 * outside the Herdr app, the desktop toast trigger in mid-turn flows like the
 * questionnaire and the guardrails confirmation, not just on `agent_end`.
 * Pass `notify: false` to opt out.
 *
 * Blocked status: pi reports select / confirm / input / editor dialogs as
 * "blocked" (OSC 7501 program status, which the Herdr app shows in its
 * sidebar and toasts) on its own, but a `ctx.ui.custom()` component only when
 * the caller passes `options.blocked`, and only inline (overlays ignore it).
 * `fn` therefore receives a ready `{ blocked }` options object to hand to
 * `ctx.ui.custom(factory, dialog)`; its message is `options.blocked.message`,
 * else `options.toolName`, else "Waiting for input".
 */

import { notifyInputNeeded } from "./notify.js";

interface QuietUI {
	setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
}

interface QuietCtx {
	hasUI: boolean;
	ui: QuietUI;
}

/** What pi reports while a custom dialog waits (OSC 7501 `blocked` kind and message). */
export interface BlockedStatus {
	kind: "permission" | "question" | "auth";
	message: string;
}

/** Options to pass to `ctx.ui.custom()` so pi reports the dialog as blocked. */
export interface BlockedDialogOptions {
	blocked: BlockedStatus;
}

export interface QuietSpinnerOptions {
	/** Send a bell / desktop notification on entry. Defaults to true. */
	notify?: boolean;
	/** Optional tool name included in the notification body. */
	toolName?: string;
	/** Blocked status for a custom dialog; kind defaults to "question". */
	blocked?: Partial<BlockedStatus>;
}

export async function withQuietSpinner<T>(
	ctx: QuietCtx,
	fn: (dialog: BlockedDialogOptions) => Promise<T>,
	options: QuietSpinnerOptions = {},
): Promise<T> {
	const dialog: BlockedDialogOptions = {
		blocked: {
			kind: options.blocked?.kind ?? "question",
			message: options.blocked?.message ?? options.toolName ?? "Waiting for input",
		},
	};
	if (!ctx.hasUI) return fn(dialog);
	if (options.notify !== false) {
		notifyInputNeeded(options.toolName);
	}
	ctx.ui.setWorkingIndicator({ frames: [] });
	try {
		return await fn(dialog);
	} finally {
		// Restore the default animated spinner.
		ctx.ui.setWorkingIndicator();
	}
}
