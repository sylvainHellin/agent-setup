/**
 * workflows-on-demand: keep pi-subagents' SubagentWorkflow tool registered but
 * inactive until it is needed.
 *
 * The tool spec costs ~8k tokens on every request. pi-subagents registers it
 * during extension loading (`workflowsEnabled: true` in subagents.json), so it
 * is already in the active set when `session_start` fires; this extension
 * takes it out there. Reading a skill file whose path ends in TRIGGER_SUFFIX
 * (`skills/agents/subagents/workflows.md` here; change it to your own skill)
 * with the `read` tool puts it back for the rest of the session, and
 * `/workflows` toggles it by hand. pi sends the updated tool list on the next request.
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL = "SubagentWorkflow";
const TRIGGER_SUFFIX = "/skills/agents/subagents/workflows.md";

function resolveReadPath(raw: string, cwd: string): string {
	let p = raw.trim().replace(/^@/, "");
	if (p === "~") p = homedir();
	else if (p.startsWith("~/")) p = resolve(homedir(), p.slice(2));
	const abs = isAbsolute(p) ? p : resolve(cwd, p);
	try {
		return realpathSync(abs);
	} catch {
		return abs;
	}
}

export default function workflowsOnDemand(pi: ExtensionAPI) {
	const isRegistered = () => pi.getAllTools().some((t) => t.name === TOOL);
	const isActive = () => pi.getActiveTools().includes(TOOL);
	const setActive = (on: boolean) => {
		const rest = pi.getActiveTools().filter((name) => name !== TOOL);
		pi.setActiveTools(on ? [...rest, TOOL] : rest);
	};

	pi.on("session_start", () => {
		try {
			if (isActive()) setActive(false);
		} catch {
			// Hosts without tool control keep pi-subagents' default.
		}
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "read" || event.isError) return;
		const raw = (event.input as { path?: unknown } | undefined)?.path;
		if (typeof raw !== "string") return;
		if (!resolveReadPath(raw, ctx.cwd).endsWith(TRIGGER_SUFFIX)) return;
		try {
			if (!isActive() && isRegistered()) setActive(true);
		} catch {
			// Never fail a read over a tool toggle.
		}
	});

	pi.registerCommand("workflows", {
		description: "Toggle the SubagentWorkflow tool for this session",
		handler: async (_args, ctx) => {
			if (!isRegistered()) {
				ctx.ui.notify(`${TOOL} is not registered (check workflowsEnabled in subagents.json)`, "warning");
				return;
			}
			const on = !isActive();
			setActive(on);
			ctx.ui.notify(`${TOOL} ${on ? "active" : "inactive"} for this session`, "info");
		},
	});
}
