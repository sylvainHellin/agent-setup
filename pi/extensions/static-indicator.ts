/**
 * Static Indicator Extension
 *
 * Replaces pi's animated braille spinner with a single static glyph.
 *
 * Why: pi-tui's `Loader` drives the working indicator from
 * `setInterval(..., DEFAULT_INTERVAL_MS)` with `DEFAULT_INTERVAL_MS = 80`,
 * and every tick calls `ui.requestRender()`. That is 12.5 forced full-TUI
 * repaints per second for the entire duration of a turn, whether or not any
 * content changed: including turns that produce no visible output at all,
 * such as waiting on a background subagent. In a GPU-composited terminal each
 * repaint is a full-window Metal draw plus a WindowServer compositing pass, so
 * an idle wait costs the same as active streaming and the GPU never gets to
 * power-gate.
 *
 * The fix is built into pi-tui: `Loader.restartAnimation()` returns early when
 * `frames.length <= 1`, so a single-frame indicator starts no timer at all.
 * Not a slower spinner, an absent one.
 *
 * Custom frames are rendered verbatim (`renderIndicatorVerbatim`), so the
 * colour has to be applied here rather than by the loader's spinnerColorFn.
 *
 * The colour is a literal truecolor escape rather than `theme.fg(...)` because
 * `Theme.fg` only resolves the semantic keys under `colors` in a theme file and
 * throws on anything else. Neither tokyo-night nor catppuccin-mocha exposes a
 * semantic orange; tokyo-night has one only as the palette var `orange`.
 *
 * `/spinner` toggles back to the stock animation for the current session.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** tokyo-night palette var `orange`, #ff9e64. */
const ORANGE = "\x1b[38;2;255;158;100m";
const FG_RESET = "\x1b[39m";
const GLYPH = `${ORANGE}●${FG_RESET}`;

let animated = false;

function apply(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") {
		return;
	}
	if (animated) {
		ctx.ui.setWorkingIndicator();
		return;
	}
	ctx.ui.setWorkingIndicator({ frames: [GLYPH] });
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		apply(ctx);
	});

	pi.registerCommand("spinner", {
		description: "Toggle the working indicator between static glyph and animated spinner",
		handler: async (_args, ctx) => {
			animated = !animated;
			apply(ctx);
			ctx.ui.notify(
				animated
					? "Working indicator: animated (12.5 repaints/s)"
					: "Working indicator: static (no repaint timer)",
				"info",
			);
		},
	});
}
