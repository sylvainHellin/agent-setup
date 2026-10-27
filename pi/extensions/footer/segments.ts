/**
 * Segment registry.
 *
 * The registry is a plain Map on globalThis rather than a module-local const so
 * that other extensions can contribute segments without forking this one. The
 * orchestrator extension registers its own indicator this way, and load order
 * does not matter: whichever module loads first creates the Map.
 *
 * A segment renders to a string and decides whether it is visible at all, so an
 * inactive mode or a non-git directory simply disappears rather than rendering
 * an empty slot.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { GitStatus } from "./git-status.js";
import { fg, loadColor, type SemanticColor } from "./theme.js";
import { deEmojify, ICONS } from "./icons.js";

export type SegmentContext = {
	theme: Theme;
	width: number;
	model: { id?: string; name?: string; provider?: string; contextWindow?: number } | undefined;
	isLocalModel: boolean;
	thinkingLevel: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
	contextPercent: number;
	contextWindow: number;
	git: GitStatus;
	/** User-defined session display name, set by /name. Undefined when unnamed. */
	sessionName: string | undefined;
	/** Texts registered by other extensions through ctx.ui.setStatus(). */
	statuses: ReadonlyMap<string, string>;
	/** Paint with a footer colour, for segments living outside this folder. */
	paint: (semantic: SemanticColor, text: string) => string;
};

export type RenderedSegment = { content: string; visible: boolean };
export type SegmentRenderer = (ctx: SegmentContext) => RenderedSegment;

type Registry = Map<string, SegmentRenderer>;

const g = globalThis as Record<string, unknown>;
if (!g.__piFooterSegments) g.__piFooterSegments = new Map<string, SegmentRenderer>();

export const registry = g.__piFooterSegments as Registry;

export function registerSegment(id: string, render: SegmentRenderer): void {
	registry.set(id, render);
}

/** Ask the footer to repaint after an out-of-turn state change (a mode toggle). */
export function requestFooterRender(): void {
	(g.__piFooterRequestRender as (() => void) | undefined)?.();
}

const hidden: RenderedSegment = { content: "", visible: false };

export function renderSegment(id: string, ctx: SegmentContext): RenderedSegment {
	// `text:...` renders a literal, which keeps static separators out of the registry.
	if (id.startsWith("text:")) {
		const text = id.slice(5);
		return { content: text, visible: text.length > 0 };
	}
	const renderer = registry.get(id);
	return renderer ? renderer(ctx) : hidden;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

/** Whole percent, with "<1%" so an almost empty window never reads as 0. */
export function formatPercent(p: number): string {
	if (p > 0 && p < 1) return "<1%";
	return `${Math.round(p)}%`;
}

function label(ctx: SegmentContext, text: string): string {
	return fg(ctx.theme, "label", text);
}

function value(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
	return fg(ctx.theme, semantic, text);
}

// ---------------------------------------------------------------------------
// Built-in segments
// ---------------------------------------------------------------------------

registerSegment("pi", (ctx) => ({
	content: fg(ctx.theme, "pi", ICONS.pi),
	visible: true,
}));

registerSegment("model", (ctx) => {
	// The provider is left out: a provider name on every frame was noise.
	let name = ctx.model?.name || ctx.model?.id || "no model";
	if (name.startsWith("Claude ")) name = name.slice(7);
	return { content: value(ctx, "model", name), visible: true };
});

registerSegment("path", (ctx) => {
	let pwd = process.cwd();
	const home = process.env.HOME;
	if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
	return { content: value(ctx, "path", pwd), visible: true };
});

registerSegment("session", (ctx) => {
	// Hidden when the session has no name. Most sessions never get one, and a
	// permanent "untitled" or a raw session id would be noise on the row that is
	// meant to answer "where am I" at a glance. Naming a session is what makes it
	// worth labelling, so the label appears exactly then.
	const name = ctx.sessionName?.trim();
	if (!name) return hidden;
	return { content: value(ctx, "session", `${ICONS.session} ${name}`), visible: true };
});

registerSegment("git", (ctx) => {
	const { branch, staged, unstaged, untracked } = ctx.git;
	if (!branch && !staged && !unstaged && !untracked) return hidden;

	const dirty = staged > 0 || unstaged > 0 || untracked > 0;
	let content = branch ? value(ctx, dirty ? "gitDirty" : "gitClean", `${ICONS.branch} ${branch}`) : "";

	const marks: string[] = [];
	if (unstaged > 0) marks.push(value(ctx, "gitDirty", `*${unstaged}`));
	if (staged > 0) marks.push(value(ctx, "gitStaged", `+${staged}`));
	if (untracked > 0) marks.push(value(ctx, "gitUntracked", `?${untracked}`));
	if (marks.length > 0) content += content ? ` ${marks.join(" ")}` : marks.join(" ");

	return content ? { content, visible: true } : hidden;
});

const THINKING_LABEL: Record<string, string> = {
	off: "no thinking",
	xhigh: "xhigh",
};

registerSegment("thinking", (ctx) => {
	// Painted with pi's own thinking border colour, so the word always matches
	// the rule drawn around the editor at the same level.
	const level = ctx.thinkingLevel || "off";
	const text = THINKING_LABEL[level] ?? level;
	const paintLevel = (ctx.theme as any).getThinkingBorderColor?.(level) as ((s: string) => string) | undefined;
	return { content: paintLevel ? paintLevel(text) : label(ctx, text), visible: true };
});

registerSegment("context", (ctx) => {
	// A figure rather than a bar: the percentage is what decides when to
	// compact, and the 18-cell bar took a fifth of the row to say the same.
	if (ctx.contextWindow <= 0) return hidden;
	const pct = value(ctx, loadColor(ctx.contextPercent, 50, 75), formatPercent(ctx.contextPercent));
	return { content: `${pct} ${label(ctx, `of ${formatTokens(ctx.contextWindow)}`)}`, visible: true };
});

/** Session token totals. Not in the default layout; kept for an opt-in row. */
registerSegment("tokens", (ctx) => {
	const { input, output, cacheRead, cacheWrite } = ctx.usage;
	const content =
		`${label(ctx, "\u2191")}${value(ctx, "value", formatTokens(input + cacheRead + cacheWrite))} ` +
		`${label(ctx, "\u2193")}${value(ctx, "value", formatTokens(output))}`;
	return { content, visible: true };
});

registerSegment("cost", (ctx) => {
	if (ctx.isLocalModel) return { content: label(ctx, "local"), visible: true };
	return { content: value(ctx, "value", `$${ctx.usage.cost.toFixed(2)}`), visible: true };
});

/**
 * Texts other extensions publish through ctx.ui.setStatus().
 *
 * setFooter replaces pi's whole footer, which otherwise silently swallows these.
 * Rendering them here keeps any extension's indicator alive instead of losing it
 * to the custom footer.
 *
 * The text is foreign, so it goes through deEmojify.
 */
registerSegment("statuses", (ctx) => {
	const texts = [...ctx.statuses.values()]
		.filter((t) => t.trim().length > 0)
		.map(deEmojify);
	if (texts.length === 0) return hidden;
	return { content: texts.map((t) => fg(ctx.theme, "status", t)).join(" "), visible: true };
});
