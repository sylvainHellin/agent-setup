/**
 * ThoughtDAG handoff
 *
 * `/thoughtdag` opens the current session in the ThoughtDAG desktop app
 * (https://github.com/chenxiachan/thoughtdag) through its deep link
 * `thoughtdag://open?session=<id>&turn=<entry id>`.
 * ThoughtDAG reads the Pi session file itself (Session Atlas, pi adapter):
 * forks show up as branches, the canvas keeps following the session as it
 * grows, and the `turn` parameter centres the canvas on the current leaf.
 * Continuing from the canvas runs `pi --mode rpc` on the same session file
 * (or a fork of it), so `/resume` in the TUI picks the new turns back up.
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPENER: Record<string, string> = { darwin: "open", linux: "xdg-open" };

export default function (pi: ExtensionAPI) {
	pi.registerCommand("thoughtdag", {
		description: "Open the current conversation tree in ThoughtDAG",
		handler: async (_args, ctx) => {
			const sm = ctx.sessionManager;
			const id = sm.getSessionId();
			const file = sm.getSessionFile();
			if (!file || !existsSync(file)) {
				ctx.ui.notify("ThoughtDAG: this session has no file on disk yet (ephemeral, or nothing answered so far).", "warning");
				return;
			}
			const opener = OPENER[process.platform];
			if (!opener) {
				ctx.ui.notify(`ThoughtDAG: no deep-link opener on ${process.platform}.`, "error");
				return;
			}
			const params = new URLSearchParams({ session: id });
			const leaf = sm.getLeafId();
			if (leaf) params.set("turn", leaf);
			const url = `thoughtdag://open?${params.toString()}`;
			const res = await pi.exec(opener, [url]);
			if (res.code !== 0) {
				ctx.ui.notify(
					`ThoughtDAG: could not open ${url} (${(res.stderr || `exit ${res.code}`).trim()}). Is the desktop app installed? brew install --cask thoughtdag`,
					"error",
				);
				return;
			}
			ctx.ui.notify("ThoughtDAG: session handed off; the canvas follows it from now on.", "info");
		},
	});
}
