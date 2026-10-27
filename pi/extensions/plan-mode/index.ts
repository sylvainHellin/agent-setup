/**
 * Plan mode.
 *
 * A toggle that holds the session in read-only planning: explore, interview,
 * author a plan file, submit it for review, and stop. It is the standing
 * counterpart to a `/plan` prompt template (`prompts/plan.md` in this setup),
 * which does the same thing for a single task given as an argument.
 *
 * The two are a deliberate pair, not a duplication to be factored out. The
 * template is a one-shot that takes `$@` and ends with the plan; the mode has no
 * task, persists across turns, and shows in the footer. Sharing one string would
 * force the mode to carry `Task:` and frontmatter it has no use for. Edit both
 * when the planning discipline itself changes.
 *
 * This mode only injects a prompt: it does not withdraw the edit tools. That was
 * a deliberate choice, and it means the
 * read-only rule holds by instruction rather than by construction.
 */

import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PROMPT = `\
IMPORTANT: You are in PLAN MODE. This is read-only exploration plus plan authoring. Do NOT edit the codebase and do NOT run git writes. Implementing is a separate, explicit step the user will ask for later, if at all.

Explore the codebase to understand what is relevant: the files, patterns, and conventions that matter, and the architecture around the area in question. If a question can be answered by exploring the codebase, explore instead of asking.

Interview the user relentlessly about every aspect of the plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one. Ask the questions one at a time, and give your recommended answer for each.

Use your web search and fetch tools for direct lookups: single-page docs, API references, quick fact-checks. Dispatch a research subagent (the \`Agent\` tool, if installed) only for genuinely heavy multi-source research; do not dispatch one for what a single search answers.

Once aligned, or if the task is straightforward, deliver the plan. For a short plan, answer directly in the response. For anything longer, or anything the user will want to comment on line by line, author it as a markdown file at \`.pi/workflow/_adhoc/plan-<slug>.md\` (or any path the user names) using the \`write\` tool and report the path. Writing that one file is the sole exception to the no-edit rule. Keep the plan tight, with no filler, repetition, or verbose explanation: a short overview of what changes, where, and why, plus system design, interfaces, and the architectural decisions taken. Do not go deep into implementation details.

Then STOP and wait. The user reviews on their own initiative, with \`/annotate\` or in their editor; do not open a review surface yourself.

When review comments come back, do NOT rewrite the whole plan: use the \`edit\` tool to change only the affected lines, then report that the file is updated.

When the plan is approved, STOP. Do not start implementing unless the user explicitly asks you to.`;

type State = { enabled: boolean };

const g = globalThis as Record<string, unknown>;

const state: State = { enabled: false };
g.__planMode = state;

// The footer's registry is a plain Map on globalThis precisely so a mode
// extension can contribute an indicator without either side importing the
// other. Whichever module loads first creates it.
if (!g.__piFooterSegments) g.__piFooterSegments = new Map();
(g.__piFooterSegments as Map<string, unknown>).set("plan-mode", (ctx: any) => {
	// Shown only while on. The permanent "Plan: OFF" cell cost width on every
	// frame to say nothing; /plan-mode confirms each toggle with a notification,
	// which covers checking that it really turned off. The filled circle keeps
	// the state legible under NO_COLOR. See ../footer/icons.ts.
	if (!state.enabled) return { content: "", visible: false };
	const text = "\u25CF plan";
	return { content: ctx.paint ? ctx.paint("modeOn", text) : ctx.theme.fg("accent", text), visible: true };
});

function setEnabled(enabled: boolean): void {
	state.enabled = enabled;
	g.__planMode = { ...state };
	const requestRender = g.__piFooterRequestRender;
	if (typeof requestRender === "function") requestRender();
}

export default function planModeExtension(pi: ExtensionAPI): void {
	// Restore across fork and resume. Default is off: a mode that silently
	// rewrites the system prompt should never be inherited by surprise.
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager?.getEntries?.() ?? [];
		let restored = false;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as any;
			if (entry.type === "custom" && entry.customType === "plan-mode-state") {
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

	// Named `plan-mode` rather than `plan` because a `/plan` prompt template
	// (prompts/plan.md) may own the name, and a command would shadow it.
	pi.registerCommand("plan-mode", {
		description: "Toggle plan mode: read-only exploration and plan authoring, no edits. Subcommand: off.",
		handler: async (args: string | undefined, ctx: ExtensionContext) => {
			if (!ctx.hasUI) return;
			const sub = (args ?? "").trim().toLowerCase();

			if (sub === "") {
				setEnabled(!state.enabled);
			} else if (sub === "off") {
				setEnabled(false);
			} else {
				ctx.ui.notify(
					["Usage: /plan-mode [off]", "", "  /plan-mode       Toggle on / off", "  /plan-mode off   Turn off"].join("\n"),
					"info",
				);
				return;
			}

			pi.appendEntry("plan-mode-state", { enabled: state.enabled });
			ctx.ui.notify(
				state.enabled ? "Plan mode on: explore and plan, no edits until you ask" : "Plan mode off",
				"info",
			);
		},
	});
}
