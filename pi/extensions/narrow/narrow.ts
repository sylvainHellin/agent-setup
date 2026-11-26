/**
 * Pure helpers for the narrow extension: the width test, the table rewrite and the line cuts.
 * Kept free of pi imports so `node --test` runs them without the pi runtime.
 */

/** Below this many terminal columns pi switches to the compact view (an upright phone is about 40 to 50). */
export const NARROW_COLUMNS = 60;

/** Lines a compact tool call keeps, and lines a compact failed result keeps. */
export const CALL_LINES = 2;
export const ERROR_LINES = 3;

export function isNarrow(columns: number | undefined, threshold = NARROW_COLUMNS): boolean {
	return typeof columns === "number" && columns > 0 && columns < threshold;
}

/** Splits a Markdown table row into trimmed cells, keeping `\|` and pipes inside code spans. */
export function splitRow(line: string): string[] {
	let row = line.trim();
	if (row.startsWith("|")) row = row.slice(1);
	if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
	const cells: string[] = [];
	let cell = "";
	let inCode = false;
	for (let i = 0; i < row.length; i++) {
		const ch = row[i];
		if (ch === "\\" && row[i + 1] === "|") {
			cell += "|";
			i++;
		} else if (ch === "`") {
			inCode = !inCode;
			cell += ch;
		} else if (ch === "|" && !inCode) {
			cells.push(cell.trim());
			cell = "";
		} else {
			cell += ch;
		}
	}
	cells.push(cell.trim());
	return cells;
}

const SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*(```|~~~)/;

function isRow(line: string): boolean {
	return line.includes("|") && line.trim() !== "";
}

/** Rewrites one table: each row becomes a bullet led by its first cell, the other cells nested under their header. */
function tableToList(header: string[], rows: string[][]): string[] {
	const out: string[] = [];
	for (const row of rows) {
		const first = row[0] || "(empty)";
		out.push(`- ${first}`);
		for (let c = 1; c < Math.max(header.length, row.length); c++) {
			const value = row[c] ?? "";
			if (value === "") continue;
			const label = header[c] ?? "";
			out.push(label ? `  - ${label}: ${value}` : `  - ${value}`);
		}
	}
	return out;
}

/** Turns every GFM table outside code fences into a nested list, which wraps cleanly on a narrow screen. */
export function tablesToLists(markdown: string): string {
	if (!markdown.includes("|")) return markdown;
	const lines = markdown.split("\n");
	const out: string[] = [];
	let fence: string | undefined;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1];
			else if (fenceMatch[1] === fence) fence = undefined;
			out.push(line);
			i++;
			continue;
		}
		if (fence === undefined && isRow(line) && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("-")) {
			const header = splitRow(line);
			const rows: string[][] = [];
			let j = i + 2;
			while (j < lines.length && isRow(lines[j]) && !FENCE.test(lines[j])) {
				rows.push(splitRow(lines[j]));
				j++;
			}
			out.push(...tableToList(header, rows));
			i = j;
			continue;
		}
		out.push(line);
		i++;
	}
	return out.join("\n");
}

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

/** True when a rendered line shows nothing but colour and spaces, like a box's padding row. */
export function isBlank(line: string): boolean {
	return line.replace(ANSI, "").trim() === "";
}

/**
 * Keeps the first `max` content lines; when some are dropped the last kept line ends in an ellipsis.
 * Blank padding rows above the content, and the closing one below it, stay so a framed box keeps its frame.
 */
export function cutLines(lines: string[], max: number, width: number, truncate: (text: string, width: number) => string): string[] {
	let top = 0;
	while (top < lines.length && isBlank(lines[top])) top++;
	if (lines.length - top <= max) return lines;
	const kept = lines.slice(0, top + max);
	const last = kept.length - 1;
	kept[last] = `${truncate(kept[last], Math.max(1, width - 1))}…`;
	if (top > 0 && isBlank(lines[lines.length - 1])) kept.push(lines[lines.length - 1]);
	return kept;
}
