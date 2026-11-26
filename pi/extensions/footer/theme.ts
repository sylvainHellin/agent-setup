/**
 * Colour resolution for footer segments.
 *
 * The footer takes its colours from the terminal's 16-colour ANSI palette
 * rather than from literal hex. Inside the Herdr desktop app that palette is
 * the active Herdr theme's own (`themes/<name>.json` `ansi`, or a built-in
 * preset), so the footer follows a theme switch live, with no file read and
 * no subprocess. The same holds for a session on a remote machine whose
 * herdr-core terminals the local Herdr app draws, and any other terminal
 * simply shows its own palette.
 *
 * Reading the theme's hex values instead is not reliable: the theme picker's
 * choice lives in Herdr's internal `layouts/.state/` files, the built-in
 * presets (graphite, ink, moss, paper) have no colour file on disk, and a
 * remote machine has no Herdr app config at all.
 *
 * The one exception is the thinking level, which goes through pi's
 * getThinkingBorderColor so the label always matches the editor border.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/** An SGR foreground: a 16-colour ANSI slot, optionally faint. */
export type AnsiColor = { sgr: string };

export type ColorValue = ThemeColor | AnsiColor;

/** The terminal's palette slots, named by role in a typical theme. */
export const ANSI = {
	fg: { sgr: "39" }, // the theme's foreground
	white: { sgr: "37" }, // a softer foreground in most themes
	grey: { sgr: "90" }, // bright black: comments, muted text
	faint: { sgr: "2;90" }, // bright black, faint: rules and separators
	red: { sgr: "31" },
	green: { sgr: "32" },
	brightGreen: { sgr: "92" },
	yellow: { sgr: "33" },
	cyan: { sgr: "36" },
	magenta: { sgr: "95" }, // bright magenta: the accent slot in most themes
} as const satisfies Record<string, AnsiColor>;

export type SemanticColor =
	| "pi"
	| "model"
	| "path"
	| "session"
	| "gitClean"
	| "gitDirty"
	| "gitStaged"
	| "gitUntracked"
	| "label"
	| "value"
	| "loadNormal"
	| "loadWarning"
	| "loadCritical"
	| "separator"
	| "modeOn"
	| "status";

export const COLORS: Record<SemanticColor, ColorValue> = {
	pi: ANSI.magenta,
	model: ANSI.fg,
	path: ANSI.white,
	// The only cyan on the row, so a named session reads apart from the path.
	session: ANSI.cyan,
	gitClean: ANSI.brightGreen,
	// ANSI has no orange, so the warning hue is the theme's yellow.
	gitDirty: ANSI.yellow,
	gitStaged: ANSI.green,
	gitUntracked: ANSI.grey,
	label: ANSI.grey,
	value: ANSI.white,
	// Plain green rather than bright: it stays quiet on every repaint.
	loadNormal: ANSI.green,
	loadWarning: ANSI.yellow,
	loadCritical: ANSI.red,
	separator: ANSI.faint,
	modeOn: ANSI.magenta,
	status: ANSI.grey,
};

/** Plan usage turns orange from 50% and red above 85%. */
export const USAGE_WARN_AT = 50;
export const USAGE_CRITICAL_ABOVE = 85;

/** Context turns orange from 100k tokens and red above 160k, whatever the window. */
export const CONTEXT_WARN_AT = 100_000;
export const CONTEXT_CRITICAL_ABOVE = 160_000;

/** Green, orange or red for a load figure: orange from `warnAt`, red above `criticalAbove`. */
export function loadColor(amount: number, warnAt: number, criticalAbove: number): SemanticColor {
	if (amount > criticalAbove) return "loadCritical";
	if (amount >= warnAt) return "loadWarning";
	return "loadNormal";
}

const RESET = "\x1b[0m";

function isAnsi(color: ColorValue): color is AnsiColor {
	return typeof color === "object" && color !== null && "sgr" in color;
}

/** Paint text with an ANSI palette slot or a pi theme token. */
export function paint(theme: Theme, color: ColorValue, text: string): string {
	if (isAnsi(color)) return `\x1b[${color.sgr}m${text}${RESET}`;
	return theme.fg(color, text);
}

/** Paint text with a semantic footer colour. */
export function fg(theme: Theme, semantic: SemanticColor, text: string): string {
	return paint(theme, COLORS[semantic], text);
}
