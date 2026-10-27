/**
 * Orchestrator mode.
 *
 * A toggle that turns the main session into a dispatcher: it injects an
 * instruction block telling the agent to delegate reading, research, and edits
 * to subagents instead of doing them itself, so the main context window stays
 * small enough to hold a faithful overview of a long task.
 *
 * The prompt deliberately says nothing about which model the subagents use.
 * Each agent definition in ~/.pi/agent/agents/ pins its model in frontmatter,
 * which pi-subagents treats as authoritative. Keeping it there means a model
 * rename is a one-line agent-file edit rather than a prompt edit, and it
 * cannot be forgotten by an agent that skims the instructions.
 */

import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PROMPT = `\
IMPORTANT: You are in ORCHESTRATOR MODE. Dispatch work to specialized subagents rather than doing it yourself, so your context window stays clean.

Your context should hold the plan, the running status of each work unit, and the open risks. Nothing more.

Rules:
- Do not read large files, search the codebase, or fetch web pages yourself. Dispatch a subagent and keep only its summary.
- If a skill about subagents or delegation is installed, load it before the first dispatch.
- Dispatch with the \`Agent\` tool, picking the agent type that fits (for example \`worker\` implements, \`reviewer\` reviews read-only, \`scout\` locates code, \`researcher\` searches the web). Collect background runs with \`get_subagent_result\`.
- Run independent work units in parallel. Keep a single writer per working directory.
- Use fresh-context read-only subagents for review, then apply fixes yourself as the sole writer.
- Before dispatching reviewers, load any code-review skill you have and pass it to each reviewer task; it sets the bar a finding must clear and what counts as blocking.
- Report each unit's outcome, the files it touched, and any residual risk.

Exception: act directly when dispatching would cost more than doing it, such as a one-line edit, a single short file, or a command whose output you need in full.`;

type State = { enabled: boolean };

const g = globalThis as Record<string, unknown>;

const state: State = { enabled: false };
g.__orchestrator = state;

// The footer's registry is a plain Map on globalThis precisely so a mode
// extension can contribute an indicator without either side importing the
// other. Whichever module loads first creates it.
if (!g.__piFooterSegments) g.__piFooterSegments = new Map();
(g.__piFooterSegments as Map<string, unknown>).set("orchestrator", (ctx: any) => {
	// Shown only while on. A permanent "Orchestrator: OFF" cell was once kept so
	// that "off" and "not loaded" looked different, but it was truncated to
	// "○ P..." on most widths anyway; /orchestrator confirms each toggle with a
	// notification instead. The filled circle keeps the state legible under
	// NO_COLOR. See ../footer/icons.ts.
	if (!state.enabled) return { content: "", visible: false };
	const text = "\u25CF orchestrator";
	return { content: ctx.paint ? ctx.paint("modeOn", text) : ctx.theme.fg("accent", text), visible: true };
});

function setEnabled(enabled: boolean): void {
	state.enabled = enabled;
	g.__orchestrator = { ...state };
	const requestRender = g.__piFooterRequestRender;
	if (typeof requestRender === "function") requestRender();
}

export default function orchestratorExtension(pi: ExtensionAPI): void {
	// Restore across fork and resume. Default is off: a mode that silently
	// rewrites the system prompt should never be inherited by surprise.
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager?.getEntries?.() ?? [];
		let restored = false;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as any;
			if (entry.type === "custom" && entry.customType === "orchestrator-state") {
				restored = Boolean(entry.data?.enabled);
				break;
			}
		}
		setEnabled(restored);
	});

	pi.on("before_agent_start", (event: BeforeAgentStartEvent): BeforeAgentStartEventResult => {
		if (!state.enabled) return {};
		return { systemPrompt: `${PROMPT}\n\n${event.systemPrompt ?? ""}` };
	});

	pi.registerCommand("orchestrator", {
		description: "Toggle orchestrator mode: delegate work to subagents to preserve context. Subcommand: off.",
		handler: async (args: string | undefined, ctx: ExtensionContext) => {
			if (!ctx.hasUI) return;
			const sub = (args ?? "").trim().toLowerCase();

			if (sub === "") {
				setEnabled(!state.enabled);
			} else if (sub === "off") {
				setEnabled(false);
			} else {
				ctx.ui.notify(
					["Usage: /orchestrator [off]", "", "  /orchestrator       Toggle on / off", "  /orchestrator off   Turn off"].join(
						"\n",
					),
					"info",
				);
				return;
			}

			pi.appendEntry("orchestrator-state", { enabled: state.enabled });
			ctx.ui.notify(
				state.enabled ? "Orchestrator mode on: delegate to subagents, keep context clean" : "Orchestrator mode off",
				"info",
			);
		},
	});
}
