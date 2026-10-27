/**
 * Footer glyphs.
 *
 * No colour emoji, ever: they are double-width in a monospace terminal, their
 * advance width differs between terminals, and they break the column alignment
 * the two footer rows depend on.
 *
 * Codepoints come from the Font Awesome block (U+F000-U+F2FF), whose values are
 * unchanged between Nerd Fonts v2 and v3. Glyphs that moved in v3 (nf-fa-mobile,
 * the whole nf-md-* range, the Octicons block) are avoided on purpose, and
 * deEmojify below extends the rule to text this footer receives from elsewhere.
 *
 * There is deliberately no terminal capability detection. The upstream footer
 * this replaces sniffed TERM_PROGRAM and TERM to choose between a Nerd Font set
 * and an emoji fallback; under herdr TERM is a generic xterm-256color and
 * TERM_PROGRAM is empty, so every branch missed and it silently fell back to
 * emoji. Detection here can only ever produce false negatives, so the Nerd Font
 * glyphs are unconditional.
 */

export const ICONS = {
	/**
	 * The pi brand mark is the Greek letter itself (U+03C0), not a Nerd Font
	 * glyph. It is a plain single-width monospace character rather than an emoji,
	 * so it needs no patched font, and the Nerd Font alternative (nf-oct-pi,
	 * U+E22C) sits in the Octicons block that the rule above excludes.
	 */
	pi: "\u03C0",
	folder: "\uF115", // nf-fa-folder_open
	branch: "\uF126", // nf-fa-code_fork
	git: "\uF1D3", // nf-fa-git
	session: "\uF02B", // nf-fa-tag
	separator: "\u2502", // box drawing light vertical
} as const;

/**
 * Three-state indicators for mode segments.
 *
 * Filled, half, and hollow circles rather than coloured dots, so the state stays
 * legible under NO_COLOR, under any theme, and for colour blind readers.
 */
export const STATE = {
	on: "\u25CF", // filled circle
	partial: "\u25D0", // half circle
	off: "\u25CB", // hollow circle
} as const;

// ---------------------------------------------------------------------------
// Emoji arriving from other extensions
// ---------------------------------------------------------------------------

/**
 * Substitutes for the colour emoji other extensions publish through
 * ctx.ui.setStatus(), which this footer renders verbatim in its statuses
 * segment.
 *
 * No installed package emits these today; the table is kept because the footer
 * is the one surface visible in every session and a package update can start
 * publishing emoji at any time, with the catch-all below covering whatever the
 * named substitutions miss.
 */
const EMOJI_GLYPHS: Readonly<Record<string, string>> = {
	"\u{1F7E2}": STATE.on, // green circle  -> connected / online
	"\u{1F7E1}": STATE.partial, // yellow circle -> pending pairing
	"\u26AA": STATE.off, // white circle  -> off / offline
	"\u{1F4E1}": "\uF1EB", // satellite dish   -> nf-fa-wifi
	"\u{1F4F1}": "\uF0C1", // mobile phone     -> nf-fa-link
	"\u{1F512}": "\uF023", // padlock          -> nf-fa-lock
	"\u{1F4F7}": "\uF030", // camera           -> nf-fa-camera
	"\u{1F4E8}": "\uF0E0", // incoming envelope-> nf-fa-envelope
	"\u{1F4CB}": "\uF0EA", // clipboard        -> nf-fa-clipboard
	"\u26A0": "\uF071", // warning sign     -> nf-fa-warning
};

const KNOWN_EMOJI = new RegExp(Object.keys(EMOJI_GLYPHS).join("|"), "gu");

/** U+FE0F forces emoji presentation on an otherwise monochrome codepoint. */
const EMOJI_PRESENTATION = /\uFE0F/g;

/**
 * Anything left in the pictographic planes after the named substitutions: a
 * glyph a package started emitting after this file was written. It becomes a
 * question mark rather than passing through, since every codepoint in that
 * range is double-width colour art that breaks the column alignment.
 */
const UNMAPPED_PICTOGRAPH = /[\u{1F300}-\u{1FAFF}]/gu;
const UNKNOWN = "\uF128"; // nf-fa-question

/** Rewrite colour emoji in text this footer did not author. */
export function deEmojify(text: string): string {
	return text
		.replace(KNOWN_EMOJI, (match) => EMOJI_GLYPHS[match] ?? match)
		.replace(EMOJI_PRESENTATION, "")
		.replace(UNMAPPED_PICTOGRAPH, UNKNOWN);
}
