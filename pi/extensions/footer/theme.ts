/**
 * Colour resolution for footer segments.
 *
 * The footer sits inside a tuios pane, so it takes tuios's chrome palette
 * rather than pi's theme. With no `appearance.theme` set, tuios draws its
 * chrome (dock, pills, sidebar, palette) in Charm's CharmTone colours: a
 * Charple and Hazy violet accent, Smoke and Squid greys, Julep for success.
 * The hex values are CharmTone's (charm.land/tone v0.1.0), the same ones tuios
 * bakes into internal/theme/charmtone.go.
 *
 * Literal hex keeps the footer matched to the multiplexer whatever pi theme is
 * active. The one exception is the thinking level, which goes through pi's
 * getThinkingBorderColor so the label always matches the editor border.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export type ColorValue = ThemeColor | `#${string}`;

/** CharmTone, the palette tuios's default chrome is drawn in. */
export const TONE = {
	butter: "#FFFAF1", // tuios Fg
	smoke: "#BFBCC8", // tuios FgDim
	squid: "#858392", // tuios FgMute
	iron: "#4D4C57",
	charple: "#6B50FF", // tuios Accent
	hazy: "#8B75FF", // tuios AccentBright
	malibu: "#00A4FF", // tuios Info
	sardine: "#4FBEFE",
	julep: "#00FFB2", // tuios Success
	guac: "#12C78F",
	mustard: "#F5EF34",
	tang: "#FF985A", // tuios Warning
	cherry: "#FF388B", // tuios Warn
	dolly: "#FF60FF",
} as const;

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
	pi: TONE.hazy,
	model: TONE.butter,
	path: TONE.smoke,
	// The only blue on the row, so a named session reads apart from the path.
	session: TONE.sardine,
	gitClean: TONE.julep,
	gitDirty: TONE.tang,
	gitStaged: TONE.guac,
	gitUntracked: TONE.squid,
	label: TONE.squid,
	value: TONE.smoke,
	loadNormal: TONE.smoke,
	loadWarning: TONE.tang,
	loadCritical: TONE.cherry,
	separator: TONE.iron,
	modeOn: TONE.hazy,
	status: TONE.squid,
};

/** Colour for a 0..100 load figure: context fill or plan usage. */
export function loadColor(percent: number, warnAt = 75, criticalAt = 90): SemanticColor {
	if (percent >= criticalAt) return "loadCritical";
	if (percent >= warnAt) return "loadWarning";
	return "loadNormal";
}

const RESET = "\x1b[0m";

function isHex(color: ColorValue): color is `#${string}` {
	return typeof color === "string" && color.startsWith("#");
}

export function hexToAnsi(hex: string): string {
	const h = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(h)) return "";
	return `\x1b[38;2;${parseInt(h.slice(0, 2), 16)};${parseInt(h.slice(2, 4), 16)};${parseInt(h.slice(4, 6), 16)}m`;
}

/** Paint text with a literal hex colour or a pi theme token. */
export function paint(theme: Theme, color: ColorValue, text: string): string {
	if (isHex(color)) return `${hexToAnsi(color)}${text}${RESET}`;
	return theme.fg(color as ThemeColor, text);
}

/** Paint text with a semantic footer colour. */
export function fg(theme: Theme, semantic: SemanticColor, text: string): string {
	return paint(theme, COLORS[semantic], text);
}
