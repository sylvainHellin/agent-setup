/**
 * herdr blocked-state bridge.
 *
 * Registers pi's shared event bus into shared/herdr-bus so interactive tool
 * flows (the guardrails confirmation, routed through shared/quiet-ui
 * withQuietSpinner) can flip the
 * herdr pane to "blocked" while waiting for input. herdr then fires a native
 * toast / sound when the pane is not focused.
 *
 * herdr's own pi integration (herdr-agent-state.ts, installed by herdr)
 * consumes the "herdr:blocked" event and reports the state over the herdr socket. This file lives beside it (that
 * file's header says "add custom hooks beside this file instead of editing
 * it"), so herdr integration updates do not clobber this bridge.
 *
 * Only activates inside herdr (HERDR_ENV=1); elsewhere it does nothing, so
 * notification behavior under tmux / bare terminals is unchanged.
 *
 * The bus is registered from the TUI root session's session_start, never at
 * load. @tintinweb/pi-subagents runs background agents in-process, each with
 * its own DefaultResourceLoader and therefore its own fresh event bus, and each
 * loads this extension too. Registering at load let every subagent overwrite
 * the process-global slot with its bus, so after the first background agent
 * the root session's guardrail prompts emitted "herdr:blocked" onto a bus
 * whose herdr-agent-state instance ignores it (not the root session), and the
 * pane stayed "working" for as long as the prompt waited. Subagent sessions
 * run in "print" mode, so the tui gate excludes them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHerdrBus } from "./shared/herdr-bus.js";

export default function (pi: ExtensionAPI) {
	if (process.env.HERDR_ENV !== "1") return;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx?.mode !== "tui") return;
		registerHerdrBus(pi.events);
	});
}
