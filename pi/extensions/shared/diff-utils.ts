/**
 * Shared diff utilities used by code-review.ts and review-drafts.ts.
 *
 * Not an extension: no default export. Lives in a subdirectory so
 * pi's auto-discovery skips it (only index.ts in subdirs is loaded).
 */

import { decodeKittyPrintable } from "@earendil-works/pi-tui";

// ── Types ─────────────────────────────────────────────────────────────

export interface DiffSegment {
	text: string;
	changed: boolean;
}

/** Diff line shared by both git-diff and text-diff consumers. */
export interface DiffLineBase {
	type: string;
	content: string;
	lineNumber?: number;
	segments?: DiffSegment[];
}

export interface Comment {
	filePath: string;
	diffLineIndex: number;
	lineContent: string;
	lineType: string;
	lineNumber?: number;
	text: string;
}

// ── Word-level diff ───────────────────────────────────────────────────

export function tokenizeForWordDiff(s: string): string[] {
	return s.match(/\s+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s]/g) ?? [];
}

/** Lines longer than this, or token tables larger than this, skip word diff (the LCS table is O(m*n)). */
const WORD_DIFF_MAX_CHARS = 2000;
const WORD_DIFF_MAX_CELLS = 1_000_000;

/**
 * Word-level diff between two strings using a standard LCS table.
 * Returns one segment list per side that together fully cover the input,
 * with adjacent segments of the same `changed` flag coalesced, or null when
 * the lines are too large to diff without risking memory blow-up.
 */
export function wordDiff(
	a: string,
	b: string,
): { aSegs: DiffSegment[]; bSegs: DiffSegment[] } | null {
	if (a.length > WORD_DIFF_MAX_CHARS || b.length > WORD_DIFF_MAX_CHARS) return null;
	const aToks = tokenizeForWordDiff(a);
	const bToks = tokenizeForWordDiff(b);
	const m = aToks.length;
	const n = bToks.length;
	if (m * n > WORD_DIFF_MAX_CELLS) return null;

	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (aToks[i - 1] === bToks[j - 1]) {
				dp[i]![j] = dp[i - 1]![j - 1]! + 1;
			} else {
				dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
			}
		}
	}

	const aOps: Array<{ text: string; changed: boolean }> = [];
	const bOps: Array<{ text: string; changed: boolean }> = [];
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (aToks[i - 1] === bToks[j - 1]) {
			aOps.push({ text: aToks[i - 1]!, changed: false });
			bOps.push({ text: bToks[j - 1]!, changed: false });
			i--;
			j--;
		} else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
			aOps.push({ text: aToks[i - 1]!, changed: true });
			i--;
		} else {
			bOps.push({ text: bToks[j - 1]!, changed: true });
			j--;
		}
	}
	while (i > 0) {
		aOps.push({ text: aToks[i - 1]!, changed: true });
		i--;
	}
	while (j > 0) {
		bOps.push({ text: bToks[j - 1]!, changed: true });
		j--;
	}
	aOps.reverse();
	bOps.reverse();

	const coalesce = (ops: Array<{ text: string; changed: boolean }>): DiffSegment[] => {
		const out: DiffSegment[] = [];
		for (const op of ops) {
			const last = out[out.length - 1];
			if (last && last.changed === op.changed) {
				last.text += op.text;
			} else {
				out.push({ text: op.text, changed: op.changed });
			}
		}
		return out;
	};

	return { aSegs: coalesce(aOps), bSegs: coalesce(bOps) };
}

/**
 * Annotate paired remove/add blocks with word-level segments.
 * Works on any array of DiffLineBase-compatible objects.
 */
export function annotateWordDiffs<T extends DiffLineBase>(lines: T[]): void {
	let i = 0;
	while (i < lines.length) {
		if (lines[i]!.type !== "removed") {
			i++;
			continue;
		}
		const removedStart = i;
		while (i < lines.length && lines[i]!.type === "removed") i++;
		const removedEnd = i;
		if (i >= lines.length || lines[i]!.type !== "added") continue;
		const addedStart = i;
		while (i < lines.length && lines[i]!.type === "added") i++;
		const addedEnd = i;

		const pairCount = Math.min(removedEnd - removedStart, addedEnd - addedStart);
		for (let k = 0; k < pairCount; k++) {
			const rem = lines[removedStart + k]!;
			const add = lines[addedStart + k]!;
			const wd = wordDiff(rem.content, add.content);
			// Too large: leave both lines unsegmented, rendered like unpaired lines.
			if (!wd) continue;
			rem.segments = wd.aSegs;
			add.segments = wd.bSegs;
		}
	}
}

// ── Stat bar ──────────────────────────────────────────────────────────

export function renderStatBar(additions: number, deletions: number, maxWidth: number, theme: any): string {
	const total = additions + deletions;
	if (total === 0) return "";
	const barWidth = Math.min(20, maxWidth);
	const addCols = Math.round((additions / total) * barWidth);
	const delCols = barWidth - addCols;
	return theme.fg("toolDiffAdded", "\u2588".repeat(addCols)) + theme.fg("toolDiffRemoved", "\u2588".repeat(delCols));
}

// ── Comment helpers ───────────────────────────────────────────────────

export function getCommentsForFile(comments: Comment[], filePath: string): Comment[] {
	return comments.filter((c) => c.filePath === filePath);
}

export function getCommentAtLine(comments: Comment[], filePath: string, lineIndex: number): Comment | undefined {
	return comments.find((c) => c.filePath === filePath && c.diffLineIndex === lineIndex);
}

export function fileHasComments(comments: Comment[], filePath: string): boolean {
	return comments.some((c) => c.filePath === filePath);
}

// ── Single-line comment input ─────────────────────────────────────────

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

/**
 * Text a single-line comment input should insert for raw terminal input, or
 * null when the data is a key or control sequence. pi-tui delivers a paste as
 * one string wrapped in bracketed-paste markers; its newlines and tabs become
 * spaces. Anything else is accepted when it has no control chars (emoji and
 * other non-BMP chars arrive as two UTF-16 units).
 */
export function commentInputText(data: string): string | null {
	if (data.startsWith(PASTE_START)) {
		let s = data.slice(PASTE_START.length);
		const end = s.indexOf(PASTE_END);
		if (end >= 0) s = s.slice(0, end);
		return s
			.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
			.replace(/\r\n|[\r\n\t]/g, " ")
			.replace(new RegExp(CONTROL_CHARS.source, "g"), "");
	}
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	if (!data || CONTROL_CHARS.test(data)) return null;
	return data;
}

/** Cursor position one code point left of `pos`, never splitting a surrogate pair. */
export function prevCodePoint(s: string, pos: number): number {
	if (pos <= 0) return 0;
	const lo = s.charCodeAt(pos - 1);
	if (lo >= 0xdc00 && lo <= 0xdfff && pos >= 2) {
		const hi = s.charCodeAt(pos - 2);
		if (hi >= 0xd800 && hi <= 0xdbff) return pos - 2;
	}
	return pos - 1;
}

/** Cursor position one code point right of `pos`, never splitting a surrogate pair. */
export function nextCodePoint(s: string, pos: number): number {
	if (pos >= s.length) return s.length;
	const hi = s.charCodeAt(pos);
	if (hi >= 0xd800 && hi <= 0xdbff && pos + 1 < s.length) {
		const lo = s.charCodeAt(pos + 1);
		if (lo >= 0xdc00 && lo <= 0xdfff) return pos + 2;
	}
	return pos + 1;
}
