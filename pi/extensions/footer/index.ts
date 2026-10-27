/**
 * One-row status footer.
 *
 * Replaces pi's native footer with a quiet single line: model and effort,
 * location, then what the session has consumed on the right. A terminal too
 * narrow for one line splits it into two, with no rule between them.
 *
 * Own implementation. The layout is modelled on @adrianapan/pikit's footer,
 * which was dropped for colliding with pi-vim and for shipping a pile of
 * unrelated extensions; none of its code is loaded at runtime.
 *
 * Segments live in a registry keyed on globalThis, so a mode extension can add
 * its own indicator without this file knowing about it.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { getGitStatus, invalidateGitStatus } from "./git-status.js";
import { fg, type SemanticColor } from "./theme.js";
import { renderSegment, type SegmentContext } from "./segments.js";

/**
 * Layout as groups of segment ids. Segments inside a group are joined by a
 * space, groups by a dim dot, and a group whose segments are all invisible
 * vanishes with its dot, so a hidden mode or a missing extension never leaves
 * a dangling separator.
 *
 * Left is what the session is and where it runs; right is what it has
 * consumed. On a narrow terminal the line splits at `split`: the groups before
 * it stay on row 1, the rest move to row 2.
 */
type Groups = string[][];

const LAYOUT: { left: Groups; right: Groups; splitLeft: number; splitRight: number } = {
	left: [
		["pi", "model", "thinking"],
		["path", "git"],
		["session"],
		["plan-mode", "orchestrator"],
		["statuses"],
	],
	// `limits` is left for a plan-usage extension to register; unregistered, it stays hidden.
	right: [["context"], ["limits"], ["cost"]],
	splitLeft: 3,
	splitRight: 1,
};

const GROUP_SEP = " \u2022 "; // bullet, as tuios and Crush separate details

/** Commands that can move HEAD or restage, and so invalidate the git segment. */
const GIT_MUTATING = /\bgit\s+(checkout|switch|branch|merge|rebase|pull|reset|worktree|stash|add|commit)/;

export default function footerExtension(pi: ExtensionAPI): void {
	let currentCtx: ExtensionContext | null = null;
	let tuiRef: TUI | null = null;
	let footerDataRef: ReadonlyFooterDataProvider | null = null;

	// Usage is summed over the whole branch, which is O(n) in messages, so it is
	// recomputed only when the branch actually grows.
	let usageCache: SegmentContext["usage"] | null = null;
	let usageCacheLen = -1;

	function buildContext(ctx: ExtensionContext, width: number, theme: Theme): SegmentContext {
		const branch = ctx.sessionManager?.getBranch?.() ?? [];

		const assistantMessages = branch
			.filter((e: any) => e.type === "message" && e.message.role === "assistant")
			.map((e: any) => e.message as AssistantMessage)
			.filter((m) => m.stopReason !== "error" && m.stopReason !== "aborted");

		let usage = usageCache;
		if (!usage || branch.length !== usageCacheLen) {
			usage = assistantMessages.reduce(
				(acc, m) => ({
					input: acc.input + m.usage.input,
					output: acc.output + m.usage.output,
					cacheRead: acc.cacheRead + m.usage.cacheRead,
					cacheWrite: acc.cacheWrite + m.usage.cacheWrite,
					cost: acc.cost + m.usage.cost.total,
				}),
				{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			);
			usageCache = usage;
			usageCacheLen = branch.length;
		}

		// Thinking level can be changed mid-session; the last event wins.
		const thinkingLevel = branch
			.filter((e: any) => e.type === "thinking_level_change")
			.reduce((_acc: string, e: any) => e.thinkingLevel ?? "off", pi.getThinkingLevel?.() ?? "off");

		// Context use is what the last turn actually sent, not the session total.
		const last = assistantMessages.at(-1);
		const contextTokens = last
			? last.usage.input + last.usage.output + last.usage.cacheRead + last.usage.cacheWrite
			: 0;
		const contextWindow = ctx.model?.contextWindow || 0;

		return {
			theme,
			width,
			model: ctx.model,
			isLocalModel: /localhost|127\.0\.0\.1|::1/.test((ctx.model as any)?.baseUrl ?? ""),
			thinkingLevel,
			usage,
			contextPercent: contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0,
			contextWindow,
			git: getGitStatus(footerDataRef?.getGitBranch() ?? null, () => tuiRef?.requestRender()),
			sessionName: pi.getSessionName?.(),
			paint: (semantic: SemanticColor, text: string) => fg(theme, semantic, text),
			statuses: footerDataRef?.getExtensionStatuses() ?? new Map(),
		};
	}

	/** Render groups to one string, dropping empty groups and their dots. */
	function renderGroups(ctx: SegmentContext, groups: Groups): string {
		return groups
			.map((ids) =>
				ids
					.map((id) => renderSegment(id, ctx))
					.filter((s) => s.visible && s.content)
					.map((s) => s.content)
					.join(" "),
			)
			.filter((g) => g.length > 0)
			.join(fg(ctx.theme, "separator", GROUP_SEP));
	}

	/** One line, or two when the terminal is too narrow for everything. */
	function buildRows(ctx: SegmentContext, width: number): string[] {
		const left = renderGroups(ctx, LAYOUT.left);
		const right = renderGroups(ctx, LAYOUT.right);
		const maxWidth = Math.max(0, width - 2);
		if (visibleWidth(left) + visibleWidth(right) + 2 <= maxWidth) {
			return [layoutRow(left, right, width)];
		}
		const row1 = layoutRow(
			renderGroups(ctx, LAYOUT.left.slice(0, LAYOUT.splitLeft)),
			renderGroups(ctx, LAYOUT.right.slice(0, LAYOUT.splitRight)),
			width,
		);
		const row2Left = renderGroups(ctx, LAYOUT.left.slice(LAYOUT.splitLeft));
		const row2Right = renderGroups(ctx, LAYOUT.right.slice(LAYOUT.splitRight));
		return row2Left || row2Right ? [row1, layoutRow(row2Left, row2Right, width)] : [row1];
	}

	/** Lay one row out, left string padded away from right string. */
	function layoutRow(leftStr: string, rightStr: string, width: number): string {
		const maxWidth = Math.max(0, width - 2);

		if (!rightStr) {
			const l = truncateToWidth(leftStr, maxWidth);
			return ` ${l}${" ".repeat(Math.max(0, maxWidth - visibleWidth(l)))} `;
		}

		const rightWidth = visibleWidth(rightStr);
		// A narrow terminal loses the left group before it loses the right one,
		// since cost and context matter more than the path when space is tight.
		if (rightWidth >= maxWidth) return ` ${truncateToWidth(rightStr, maxWidth)} `;

		const leftBudget = maxWidth - rightWidth - 1;
		const l = truncateToWidth(leftStr, leftBudget);
		const gap = " ".repeat(Math.max(1, maxWidth - visibleWidth(l) - rightWidth));
		return ` ${l}${gap}${rightStr} `;
	}

	function setupFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
			tuiRef = tui;
			footerDataRef = footerData;

			// Mode extensions call this after toggling so the footer repaints
			// without waiting for the next keystroke.
			(globalThis as Record<string, unknown>).__piFooterRequestRender = () => tui.requestRender();

			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					if (!currentCtx) return [];
					let segmentCtx: SegmentContext;
					try {
						segmentCtx = buildContext(currentCtx, width, theme);
					} catch {
						// Never let a footer error take down the TUI.
						return [];
					}
					return ["", ...buildRows(segmentCtx, width)];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		usageCache = null;
		usageCacheLen = -1;
		invalidateGitStatus();
		if (ctx.hasUI) setupFooter(ctx);
	});

	pi.on("tool_result", async (event: any, _ctx) => {
		if (event.toolName === "write" || event.toolName === "edit") {
			invalidateGitStatus();
		} else if (event.toolName === "bash" && GIT_MUTATING.test(String(event.input?.command ?? ""))) {
			invalidateGitStatus();
			// The write lands after the tool returns, so repaint on the next tick.
			setTimeout(() => tuiRef?.requestRender(), 100);
		}
	});

	// `!` escape commands bypass the tool path entirely.
	pi.on("user_bash", async (event: any, _ctx) => {
		if (GIT_MUTATING.test(event.command ?? "")) {
			invalidateGitStatus();
			tuiRef?.requestRender();
		}
	});

	// /name does not itself touch the agent loop, so without this the new label
	// would only appear at the next unrelated redraw.
	pi.on("session_info_changed", async (_event: any, _ctx) => {
		tuiRef?.requestRender();
	});
}
