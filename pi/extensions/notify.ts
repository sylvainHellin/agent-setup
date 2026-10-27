/**
 * Notify Extension
 *
 * Sends a notification when Pi finishes a turn and is waiting for the next
 * user prompt. Notifications fired while a tool is waiting for input mid-turn
 * (e.g. questionnaire, guardrails) live in `shared/quiet-ui.ts`,
 * which calls into the same shared helper.
 *
 * Notifications fire only in the TUI: in print, JSON and RPC modes stdout is
 * the output channel, and a bell or OSC sequence would corrupt it. RPC still
 * reports hasUI=true, so ctx.mode is the gate. session_start records the mode
 * for the shared helper, whose other callers have no ctx at hand.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { notify, setNotifyMode } from "./shared/notify.js";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		setNotifyMode(ctx.mode);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		notify("Pi", "Agent finished");
	});
}
