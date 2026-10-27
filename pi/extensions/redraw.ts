/**
 * Redraw Extension
 *
 * Registers /redraw to force a full TUI repaint. Workaround for terminals
 * where pi's SIGWINCH-driven resize handling fails to clear stranded
 * characters after a terminal resize.
 *
 * Previous approach used ctx.ui.custom() to get the TUI instance and call
 * requestRender(true). That proved unreliable because the showExtensionCustom
 * flow calls restoreEditor() inside done(), which modifies the component tree
 * and can interfere with the render state. The current approach writes the
 * clear sequence directly to the terminal (bypassing pi-tui's synchronized
 * output mode), invalidates all component caches, and then forces a full
 * re-render via requestRender(true) inside ctx.ui.custom()'s factory.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("redraw", {
		description: "Force a full TUI repaint (fixes stranded chars after resize)",
		handler: async (_args, ctx) => {
			// Write clear sequence directly to the terminal, bypassing pi-tui's
			// render pipeline entirely. ESC[2J = clear screen, ESC[H = cursor home,
			// ESC[3J = clear scrollback. Done before ctx.ui.custom so the screen is
			// clean before pi-tui re-renders fresh content on next tick.
			process.stdout.write("\x1b[2J\x1b[H\x1b[3J");

			await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
				tui.invalidate();
				tui.requestRender(true);
				done(undefined);
				return { render: () => [], invalidate: () => {} };
			});
		},
	});
}
