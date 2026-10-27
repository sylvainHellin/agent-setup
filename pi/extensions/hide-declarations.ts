/**
 * Hide Declarations Extension
 *
 * Leaves rarely used tools out of every model request while they stay active
 * and callable, directly or from codemode (`tools.Agent({...})`).
 * The skill or message that needs them carries the call syntax instead:
 *
 * - `Agent`, `get_subagent_result`, `steer_subagent` (from @tintinweb/pi-subagents):
 *   a skill about subagents should carry the call syntax (about 1.8k tokens per
 *   request, used in about 6% of sessions). Remove them from HIDDEN if no skill does.
 * - `smart_compact`: every smart-compaction steering message says the tool is
 *   callable and names `smart_compact({ handoff })`; without that, models read
 *   the missing declaration as "unavailable" and stop calling it.
 * - `prune`: the smart-compaction reminders that recommend it name `prune({})`
 *   and say it is callable, the same way.
 *
 * pi's `prepareLoadout` hook does the hiding; it belongs to a tool, so this
 * registers an inert one and hides it too. A hidden `Agent` still runs when called directly or through codemode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const GATE = "hide_declarations";
const HIDDEN = ["Agent", "get_subagent_result", "steer_subagent", "smart_compact", "prune", GATE];

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: GATE,
		label: "Hide declarations",
		description: "Internal; does nothing.",
		parameters: Type.Object({}),
		prepareLoadout: (loadout) => {
			const declared = new Set(loadout.declared.map((t) => t.name));
			return { hiddenDeclarations: HIDDEN.filter((name) => declared.has(name)) };
		},
		async execute() {
			return { content: [{ type: "text", text: "This tool does nothing." }], details: {}, isError: true };
		},
	});
}
