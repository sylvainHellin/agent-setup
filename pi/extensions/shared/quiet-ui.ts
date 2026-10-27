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
 * Modern native terminals hide this with synchronized output (ESC[?2026h),
 * but tmux is unreliable, so the user sees rapid alternation between the
 * chat history and the custom UI.
 *
 * `withQuietSpinner()` and `withQuietSpinnerSync()` pause the indicator for
 * the duration of an interactive flow. `Loader.restartAnimation()` skips
 * `setInterval` when frames.length <= 1, so passing `frames: []` cleanly stops
 * the ticking without removing the loader from the tree. Calling
 * `setWorkingIndicator()` with no argument restores the default spinner.
 *
 * Side-effect: every entry into `withQuietSpinner` corresponds to a tool /
 * hook waiting on the user. We fire `notifyInputNeeded()` so tmux's bell and
 * the macOS toast (with Pi.app icon) trigger in mid-turn flows like the
 * questionnaire and the guardrails confirmation, not just on `agent_end`. Pass `notify: false` to opt out.
 *
 * We also flip the herdr pane to "blocked" for the duration (via
 * shared/herdr-bus), so herdr fires its native toast / sound when the pane is
 * not focused. herdr's screen heuristics do not recognize pi's custom select /
 * overlay UIs as a permission prompt, so this is what makes the herdr sidebar
 * show "blocked" while a guardrail or review is waiting. No-ops outside herdr.
 */

import { emitHerdrBlocked } from "./herdr-bus.js";
import { notifyInputNeeded } from "./notify.js";

interface QuietUI {
	setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
}

interface QuietCtx {
	hasUI: boolean;
	ui: QuietUI;
}

export interface QuietSpinnerOptions {
	/** Send a desktop / tmux notification on entry. Defaults to true. */
	notify?: boolean;
	/** Optional tool name included in the notification body. */
	toolName?: string;
}

export async function withQuietSpinner<T>(
	ctx: QuietCtx,
	fn: () => Promise<T>,
	options: QuietSpinnerOptions = {},
): Promise<T> {
	if (!ctx.hasUI) return fn();
	if (options.notify !== false) {
		notifyInputNeeded(options.toolName);
	}
	emitHerdrBlocked(true, options.toolName ?? "waiting for input");
	ctx.ui.setWorkingIndicator({ frames: [] });
	try {
		return await fn();
	} finally {
		// Restore the default animated spinner and clear the herdr blocked state.
		emitHerdrBlocked(false);
		ctx.ui.setWorkingIndicator();
	}
}
