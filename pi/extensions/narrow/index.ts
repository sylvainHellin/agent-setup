/**
 * Narrow: a compact transcript when the terminal is narrower than 60 columns, such as an upright phone in the Herdr app.
 *
 * Below the threshold:
 * - thinking blocks are hidden,
 * - Markdown tables in user and assistant messages become nested lists,
 * - a tool call shows at most two lines,
 * - a tool result is hidden unless it failed (first three lines) or is expanded (the expand key or a click).
 *
 * The test runs on every render, so the view follows the pane: when the phone resizes it the transcript turns compact,
 * and when a wider screen takes the size back it returns to normal.
 * Print and RPC modes have no terminal width and stay unchanged.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { CALL_LINES, cutLines, ERROR_LINES, isNarrow, tablesToLists } from "./narrow.ts";

const narrowNow = () => isNarrow(process.stdout.columns);
const truncate = (text: string, width: number) => truncateToWidth(text, width, "");

type Mode = "call" | "result";

/** Wraps a tool's own component and decides at each render whether to show it whole or cut down. */
class CompactView implements Component {
	constructor(
		readonly inner: Component,
		private readonly mode: Mode,
		private readonly expanded: boolean,
		private readonly isError: boolean,
	) {}

	render(width: number): string[] {
		const lines = this.inner.render(width);
		if (!narrowNow() || this.expanded) return lines;
		if (this.mode === "call") return cutLines(lines, CALL_LINES, width, truncate);
		if (this.isError) return cutLines(lines, ERROR_LINES, width, truncate);
		return [];
	}

	handleMouse(event: Parameters<NonNullable<Component["handleMouse"]>>[0]) {
		return this.inner.handleMouse?.(event);
	}

	invalidate(): void {
		this.inner.invalidate();
	}
}

/** The tool's renderer gets back the component it returned last time, not our wrapper around it. */
// Bound by the one field it reads, since pi does not export ToolRenderContext from its index.
function unwrapped<T extends { lastComponent?: unknown }>(context: T): T {
	const last = context.lastComponent;
	return last instanceof CompactView ? { ...context, lastComponent: last.inner } : context;
}

export default function (pi: ExtensionAPI) {
	pi.registerMarkdownTransformer((markdown, { messageType }) => {
		if (!narrowNow()) return markdown;
		if (messageType === "assistant-thinking") return "";
		return tablesToLists(markdown);
	});

	pi.registerToolRenderer((_toolName, next) => {
		const base = next();
		if (!base) return undefined;
		const { renderCall, renderResult } = base;
		return {
			...base,
			renderCall: renderCall
				? (args, theme, context) =>
						new CompactView(renderCall(args, theme, unwrapped(context)), "call", context.expanded, false)
				: undefined,
			renderResult: renderResult
				? (result, options, theme, context) =>
						new CompactView(
							renderResult(result, options, theme, unwrapped(context)),
							"result",
							options.expanded,
							context.isError,
						)
				: undefined,
		};
	});
}
