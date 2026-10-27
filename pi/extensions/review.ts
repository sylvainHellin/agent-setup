/**
 * Session Review Extension
 *
 * Provides a /review command that lists every file the agent edited or wrote
 * during the current session and lets you review each file's diffs with inline
 * comments.
 *
 * Unlike the git-based /diff, this reads the changes straight from the
 * session log (the recorded edit/write tool calls and their diffs). That means
 * it also captures files outside the git repo and files that were committed
 * mid-session, which `git diff` would miss.
 *
 * Usage:
 *   /review              - Open the changed-files reviewer for this session
 *
 * File list keys:
 *   up/down, j/k         - Navigate files
 *   enter, right, l      - View diffs for the selected file
 *   L                    - List comments           x - copy comments to clipboard
 *   w                    - Write full diff report  S - send comments to the agent
 *   q, escape            - Quit
 *
 * Diff view keys:
 *   up/down, j/k         - Move cursor line        PageUp/Down, space - half page
 *   c                    - Comment on cursor line  d - delete comment on line
 *   L                    - List comments           v - toggle word-level diff
 *   W                    - Toggle line wrapping    n / p - next / previous file
 *   x                    - Copy comments
 *   esc, h, left         - Back to file list
 *
 * Comment input:
 *   type text, Enter save, Esc cancel
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type Comment,
	type DiffSegment,
	annotateWordDiffs,
	commentInputText,
	getCommentAtLine,
	getCommentsForFile,
	nextCodePoint,
	prevCodePoint,
	renderStatBar,
} from "./shared/diff-utils.js";
import { resolveToolPath } from "./shared/tool-path.js";
import { closeSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

interface Change {
	kind: "edit" | "write";
	diff: string;
	additions: number;
	deletions: number;
}

interface FileChanges {
	absPath: string;
	displayPath: string;
	changes: Change[];
	additions: number;
	deletions: number;
	wrote: boolean;
	edited: boolean;
}

// pi edit diffs carry no ---/+++ file headers (lines are "+<lineNum> <text>")
// and write diffs are synthesized as "+" + line, so a leading +/- always marks
// an added/removed line, even when the text itself starts with "++" or "--".
function countDiff(diff: string): [number, number] {
	let a = 0;
	let d = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) a++;
		else if (line.startsWith("-")) d++;
	}
	return [a, d];
}

// ── Pruned sessions ────────────────────────────────────────────────────
// /prune (prune/) copies a branch into a new session with tool-call arguments
// cut and tool-result `details` dropped, so edit diffs and write contents are
// gone there. Its notice entry names the parent session file, which still
// holds them; tool-call ids are kept, so they join back by id.

const PRUNE_NOTICE = "prune:notice";
/** A tool-call string argument prune cut (current and legacy mark). */
const PRUNE_ARG_CUT = /\[truncated(, entry [\w-]+ in [^\]]+)?\]$/;

/** Whether prune cut any string in these tool-call arguments. */
function argsCut(v: unknown): boolean {
	if (typeof v === "string") return PRUNE_ARG_CUT.test(v);
	if (Array.isArray(v)) return v.some(argsCut);
	if (v && typeof v === "object") return Object.values(v).some(argsCut);
	return false;
}

/** The parentSession named in a session file's header line. */
function headerParent(file: string): string | undefined {
	try {
		const fd = openSync(file, "r");
		const buf = Buffer.alloc(8192);
		const n = readSync(fd, buf, 0, buf.length, 0);
		closeSync(fd);
		const p = JSON.parse(buf.toString("utf8", 0, n).split("\n")[0]).parentSession;
		return typeof p === "string" && p ? p : undefined;
	} catch {
		return undefined;
	}
}

interface PrunedSource {
	/** Edit/write arguments by tool-call id, uncut where any chain file has them uncut. */
	args: Map<string, any>;
	/** Tool-result details by tool-call id. */
	details: Map<string, any>;
	/** Parent session files that could not be read. */
	unreadable: string[];
}

/** Uncut edit/write calls and result details from the sessions a pruned branch came from, or null if not pruned. */
function readPrunedSource(entries: any[]): PrunedSource | null {
	const chain: string[] = [];
	for (const e of entries) {
		if (e.type !== "custom_message" || e.customType !== PRUNE_NOTICE) continue;
		let p: string | undefined = e.details?.parentSession;
		while (typeof p === "string" && p && !chain.includes(p) && chain.length < 20) {
			chain.push(p);
			p = headerParent(p);
		}
	}
	if (chain.length === 0) return null;
	const src: PrunedSource = { args: new Map(), details: new Map(), unreadable: [] };
	// A parent can itself be a pruned session holding cut copies of the same
	// calls, so an uncut copy always replaces a cut one, whatever the file order.
	for (const file of chain) {
		let lines: string[];
		try {
			lines = readFileSync(file, "utf8").split("\n");
		} catch {
			src.unreadable.push(file);
			continue;
		}
		for (const line of lines) {
			const isCall = line.includes('"toolCall"');
			if (!isCall && !line.includes('"toolResult"')) continue;
			let e: any;
			try {
				e = JSON.parse(line);
			} catch {
				continue;
			}
			const msg = e?.type === "message" ? e.message : undefined;
			if (!msg) continue;
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const b of msg.content) {
					if (b?.type !== "toolCall" || (b.name !== "edit" && b.name !== "write") || !b.id) continue;
					const prev = src.args.get(b.id);
					if (prev === undefined || (argsCut(prev) && !argsCut(b.arguments))) src.args.set(b.id, b.arguments);
				}
			} else if (msg.role === "toolResult" && msg.toolCallId && msg.details !== undefined) {
				if (!src.details.has(msg.toolCallId)) src.details.set(msg.toolCallId, msg.details);
			}
		}
	}
	return src;
}

/**
 * Walk the current branch and reconstruct per-file changes from the recorded
 * edit/write tool calls (paths + arguments) joined to their tool results (diffs).
 * In a pruned session the calls and diffs come from the parent session files;
 * anything that cannot be recovered is reported through `warnings`.
 */
export function collectChanges(ctx: ExtensionContext, warnings: string[] = []): FileChanges[] {
	const cwd = ctx.cwd;
	const calls = new Map<string, { name: string; path: string; content?: string }>();
	const order: string[] = [];
	const byPath = new Map<string, FileChanges>();

	const entries = ctx.sessionManager.getBranch();
	const pruned = readPrunedSource(entries as any[]);
	let incomplete = 0;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg: any = entry.message;

		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const item of msg.content) {
				if (item?.type !== "toolCall") continue;
				if (item.name !== "edit" && item.name !== "write") continue;
				const args = (item.id ? pruned?.args.get(item.id) : undefined) ?? item.arguments ?? {};
				const p = args.path ?? args.file_path;
				if (typeof p !== "string" || !item.id) continue;
				calls.set(item.id, {
					name: item.name,
					path: p,
					content: typeof args.content === "string" ? args.content : undefined,
				});
			}
			continue;
		}

		if (msg.role !== "toolResult") continue;
		if (msg.isError) continue;
		const details: any = msg.details ?? pruned?.details.get(msg.toolCallId);
		// safe-write.ts refuses overwrites by returning (not throwing), so the
		// result is not flagged isError; nothing was written.
		if (details?.blocked) continue;
		if (msg.toolName !== "edit" && msg.toolName !== "write") continue;
		const call = calls.get(msg.toolCallId);
		if (!call) continue;

		const absPath = resolveToolPath(call.path, cwd);
		let fc = byPath.get(absPath);
		if (!fc) {
			const rel = relative(cwd, absPath);
			const display = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : absPath;
			fc = {
				absPath,
				displayPath: display,
				changes: [],
				additions: 0,
				deletions: 0,
				wrote: false,
				edited: false,
			};
			byPath.set(absPath, fc);
			order.push(absPath);
		}

		let diffText = "";
		let additions = 0;
		let deletions = 0;
		if (call.name === "edit") {
			if (typeof details?.diff === "string") diffText = details.diff;
			else {
				diffText = "(no diff recorded for this edit)";
				if (pruned) incomplete++;
			}
			[additions, deletions] = countDiff(diffText);
			fc.edited = true;
		} else {
			const content = call.content ?? "";
			if (pruned && PRUNE_ARG_CUT.test(content)) incomplete++;
			const lines = content.length ? content.split("\n") : [];
			// A final newline is a line terminator, not an extra empty line.
			if (lines.length && lines[lines.length - 1] === "") lines.pop();
			additions = lines.length;
			diffText = lines.map((l) => "+" + l).join("\n");
			fc.wrote = true;
		}

		fc.changes.push({ kind: call.name as "edit" | "write", diff: diffText, additions, deletions });
		fc.additions += additions;
		fc.deletions += deletions;
	}

	if (pruned && incomplete > 0) {
		const why = pruned.unreadable.length ? ` (unreadable: ${pruned.unreadable.join(", ")})` : "";
		warnings.push(
			`Session was pruned; ${incomplete} change(s) could not be recovered from the parent session${why}, so their diffs are incomplete.`,
		);
	}
	return order.map((p) => byPath.get(p)!);
}

function statusChar(fc: FileChanges): string {
	if (fc.wrote && !fc.edited) return "A"; // new file / full overwrite
	return "M";
}

function colorDiffLine(line: string, theme: any): string {
	if (line.startsWith("+")) return theme.fg("toolDiffAdded", line);
	if (line.startsWith("-")) return theme.fg("toolDiffRemoved", line);
	return theme.fg("muted", line);
}

export function buildReport(files: FileChanges[]): string {
	const lines: string[] = ["# Session file changes", ""];
	lines.push(`${files.length} file(s) changed.`, "");
	for (const fc of files) {
		lines.push(`## ${statusChar(fc)} ${fc.displayPath}  (+${fc.additions} -${fc.deletions})`, "");
		fc.changes.forEach((c, i) => {
			if (fc.changes.length > 1) lines.push(`### change ${i + 1} (${c.kind})`);
			lines.push("```diff", c.diff, "```", "");
		});
	}
	return lines.join("\n");
}

// ── Flattened diff lines (for cursor + comment addressing) ─────────────
type LineType = "added" | "removed" | "context" | "meta";
interface FlatLine {
	raw: string;
	type: LineType;
	content: string;
	segments?: DiffSegment[];
}

function flatten(fc: FileChanges): FlatLine[] {
	const out: FlatLine[] = [];
	fc.changes.forEach((c, i) => {
		if (fc.changes.length > 1) {
			out.push({
				raw: `── change ${i + 1}/${fc.changes.length} (${c.kind}) ──`,
				type: "meta",
				content: "",
			});
		}
		for (const raw of c.diff.split("\n")) {
			const type: LineType = raw.startsWith("+") ? "added" : raw.startsWith("-") ? "removed" : "context";
			const content = type === "added" || type === "removed" ? raw.slice(1) : raw;
			out.push({ raw, type, content });
		}
	});
	// Pair adjacent removed/added runs and mark the tokens that changed within each line.
	annotateWordDiffs(out);
	return out;
}

// Reverse-video (\x1b[7m..\x1b[27m) on changed tokens so they read as a solid block
// on top of the base add/remove color; unchanged tokens keep the plain diff color.
function renderSegmented(color: string, prefix: string, segs: DiffSegment[], theme: any): string {
	const body = segs
		.map((seg) => (seg.changed ? theme.fg(color, `\x1b[7m${seg.text}\x1b[27m`) : theme.fg(color, seg.text)))
		.join("");
	return theme.fg(color, prefix) + body;
}

function colorFlat(fl: FlatLine, theme: any, wordDiff: boolean): string {
	switch (fl.type) {
		case "added":
			return wordDiff && fl.segments
				? renderSegmented("toolDiffAdded", fl.raw.slice(0, 1), fl.segments, theme)
				: theme.fg("toolDiffAdded", fl.raw);
		case "removed":
			return wordDiff && fl.segments
				? renderSegmented("toolDiffRemoved", fl.raw.slice(0, 1), fl.segments, theme)
				: theme.fg("toolDiffRemoved", fl.raw);
		case "meta":
			return theme.fg("dim", fl.raw);
		default:
			return theme.fg("muted", fl.raw);
	}
}

function exportAnnotations(files: FileChanges[], comments: Comment[]): string {
	const lines: string[] = ["# Session change review", ""];
	const fileCount = new Set(comments.map((c) => c.filePath)).size;
	lines.push(`${comments.length} comment(s) across ${fileCount} file(s).`, "");
	for (const fc of files) {
		const fcs = getCommentsForFile(comments, fc.absPath).sort((a, b) => a.diffLineIndex - b.diffLineIndex);
		if (fcs.length === 0) continue;
		lines.push(`## ${fc.displayPath}`, "");
		for (const c of fcs) {
			lines.push("```diff", c.lineContent.trim() || "(context)", "```");
			lines.push(`> ${c.text}`, "");
		}
	}
	return lines.join("\n");
}

function copyClipboard(text: string): boolean {
	const candidates: Array<[string, string[]]> =
		process.platform === "darwin"
			? [["pbcopy", []]]
			: [
					["wl-copy", []],
					["xclip", ["-selection", "clipboard"]],
					["xsel", ["--clipboard", "--input"]],
				];
	for (const [cmd, args] of candidates) {
		try {
			execFileSync(cmd, args, { input: text });
			return true;
		} catch {
			// try next backend
		}
	}
	return false;
}

export default function sessionChangesExtension(pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description: "Review files the agent changed this session (session log), with inline comments",
		handler: async (_args, ctx) => {
			const warnings: string[] = [];
			const files = collectChanges(ctx, warnings);
			if (files.length === 0) {
				ctx.ui.notify("No file changes recorded in this session.", "info");
				return;
			}

			const comments: Comment[] = [];
			let sendAfter = false;

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const t = theme;
				let view: "files" | "diff" | "comments" = "files";
				let fileIndex = 0;
				let cursorLine = 0;
				let scrollOffset = 0;
				let flat: FlatLine[] = flatten(files[0]);
				let commentScroll = 0;
				let commentSel = 0;
				let wordDiffEnabled = true;
				let wrapEnabled = true;
				let jumps: Array<{ fileIdx: number; lineIdx: number } | null> = [];
				let commentMode = false;
				let commentText = "";
				let commentCursor = 0;
				let status = "";
				let statusTime = 0;

				const setStatus = (s: string) => {
					status = s;
					statusTime = Date.now();
				};
				const loadFile = (i: number) => {
					fileIndex = i;
					flat = flatten(files[i]);
					cursorLine = 0;
					scrollOffset = 0;
					rowCache = null;
				};

				// A diff line can span several terminal rows once wrapped, so the
				// viewport scrolls in rows while the cursor and comments still
				// address flat diff lines. rows[] maps one to the other; it is
				// rebuilt whenever the file, width or a render toggle changes.
				interface Row {
					idx: number;
					text: string;
					cont: boolean;
				}
				let rowCache: { key: string; rows: Row[]; firstRow: number[]; lastRow: number[] } | null = null;

				const buildRows = (width: number) => {
					const key = `${fileIndex}|${width}|${wordDiffEnabled ? 1 : 0}|${wrapEnabled ? 1 : 0}`;
					if (rowCache && rowCache.key === key) return rowCache;
					// 2 columns for the cursor gutter, 2 more reserved for the comment mark.
					const bodyWidth = Math.max(8, width - 4);
					const contIndent = "  ";
					const rows: Row[] = [];
					const firstRow: number[] = [];
					const lastRow: number[] = [];
					for (let i = 0; i < flat.length; i++) {
						const body = colorFlat(flat[i], t, wordDiffEnabled);
						const pieces = wrapEnabled
							? wrapTextWithAnsi(body, bodyWidth - contIndent.length)
							: [truncateToWidth(body, bodyWidth)];
						if (pieces.length === 0) pieces.push("");
						firstRow[i] = rows.length;
						for (let p = 0; p < pieces.length; p++) {
							rows.push({ idx: i, text: p === 0 ? pieces[p] : contIndent + pieces[p], cont: p > 0 });
						}
						lastRow[i] = rows.length - 1;
					}
					rowCache = { key, rows, firstRow, lastRow };
					return rowCache;
				};
				const clampCursor = () => {
					if (cursorLine >= flat.length) cursorLine = flat.length - 1;
					if (cursorLine < 0) cursorLine = 0;
				};
				const availHeight = () => Math.max((process.stdout.rows || 40) - 6, 8);
				const freshStatus = () => status && Date.now() - statusTime < 4000;

				const doExport = () => {
					if (comments.length === 0) {
						setStatus("No comments to copy");
						return;
					}
					const md = exportAnnotations(files, comments);
					if (copyClipboard(md)) {
						setStatus(`Copied ${comments.length} comment(s) to clipboard`);
						return;
					}
					try {
						const f = join(tmpdir(), `pi-review-${Date.now()}.md`);
						writeFileSync(f, md, "utf8");
						setStatus(`No clipboard tool; wrote ${f}`);
					} catch (e) {
						setStatus(`Copy failed: ${(e as Error).message}`);
					}
				};

				function renderFiles(width: number): string[] {
					const lines: string[] = [];
					const totalA = files.reduce((s, f) => s + f.additions, 0);
					const totalD = files.reduce((s, f) => s + f.deletions, 0);
					lines.push(
						t.bold(t.fg("accent", `Session changes: ${files.length} file(s)`)) +
							"  " +
							t.fg("toolDiffAdded", `+${totalA}`) +
							" " +
							t.fg("toolDiffRemoved", `-${totalD}`) +
							(comments.length ? t.fg("warning", `  ✎ ${comments.length}`) : ""),
					);
					for (const w of warnings) lines.push(truncateToWidth(t.fg("warning", `⚠ ${w}`), width));
					lines.push("");
					const vh = Math.max(availHeight() - 2 - warnings.length, 4);
					let start = 0;
					if (files.length > vh) start = Math.min(Math.max(fileIndex - Math.floor(vh / 2), 0), files.length - vh);
					for (let vi = 0; vi < vh; vi++) {
						const i = start + vi;
						if (i >= files.length) {
							lines.push("");
							continue;
						}
						const fc = files[i];
						const isSel = i === fileIndex;
						const cur = isSel ? t.fg("accent", "> ") : "  ";
						const st = fc.wrote && !fc.edited ? t.fg("toolDiffAdded", "A") : t.fg("warning", "M");
						const nC = getCommentsForFile(comments, fc.absPath).length;
						const cmark = nC ? t.fg("warning", ` ✎${nC}`) : "";
						const pathStr = isSel ? t.bold(t.fg("accent", fc.displayPath)) : fc.displayPath;
						const nEdits = fc.changes.length > 1 ? t.fg("dim", ` (${fc.changes.length})`) : "";
						const stats =
							t.fg("toolDiffAdded", `+${fc.additions}`) + " " + t.fg("toolDiffRemoved", `-${fc.deletions}`);
						const bar = renderStatBar(fc.additions, fc.deletions, 12, t);
						const left = `${cur}${st} ${pathStr}${nEdits}${cmark}`;
						const right = `${bar} ${stats}`;
						const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
						lines.push(truncateToWidth(left + " ".repeat(gap) + right, width));
					}
					lines.push("");
					lines.push(
						freshStatus()
							? t.fg("success", " " + status)
							: t.fg("dim", "↑↓/jk move · enter diffs · L comments · x copy · w report · S send · q quit"),
					);
					return lines;
				}

				function renderDiff(width: number): string[] {
					const fc = files[fileIndex];
					const lines: string[] = [];
					lines.push(
						truncateToWidth(
							t.bold(t.fg("accent", `${statusChar(fc)} ${fc.displayPath}`)) +
								"  " +
								t.fg("toolDiffAdded", `+${fc.additions}`) +
								" " +
								t.fg("toolDiffRemoved", `-${fc.deletions}`) +
								t.fg("dim", `   [${fileIndex + 1}/${files.length}]`),
							width,
						),
					);
					lines.push("");
					const vh = Math.max(availHeight() - 3, 4);
					clampCursor();
					const { rows, firstRow, lastRow } = buildRows(width);
					const curStart = firstRow[cursorLine] ?? 0;
					const curEnd = lastRow[cursorLine] ?? 0;
					if (curStart < scrollOffset) scrollOffset = curStart;
					else if (curEnd >= scrollOffset + vh) scrollOffset = curEnd - vh + 1;
					const maxScroll = Math.max(0, rows.length - vh);
					scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
					for (let vi = 0; vi < vh; vi++) {
						const r = rows[scrollOffset + vi];
						if (!r) {
							lines.push("");
							continue;
						}
						const isCur = r.idx === cursorLine;
						const cur = isCur ? t.fg("accent", "▍") : " ";
						const hasC = !r.cont && !!getCommentAtLine(comments, fc.absPath, r.idx);
						const mark = hasC ? t.fg("warning", " ✎") : "";
						lines.push(truncateToWidth(cur + " " + r.text, Math.max(1, width - visibleWidth(mark))) + mark);
					}
					lines.push("");
					if (commentMode) {
						const prefix = "comment ▸ ";
						const avail = Math.max(4, width - visibleWidth(prefix) - 1);
						// Window by display width and whole code points, so wide chars and
						// emoji neither push the cursor off-screen nor get split.
						let winStart = commentCursor;
						let used = 0;
						while (winStart > 0) {
							const p = prevCodePoint(commentText, winStart);
							const w = visibleWidth(commentText.slice(p, winStart));
							if (used + w > avail) break;
							used += w;
							winStart = p;
						}
						const before = commentText.slice(winStart, commentCursor);
						const after = truncateToWidth(commentText.slice(commentCursor), Math.max(0, avail - used), "");
						lines.push(truncateToWidth(t.fg("accent", prefix) + before + t.fg("accent", "▏") + after, width));
					} else {
						const scrollInfo = flat.length > 0 ? `   ${cursorLine + 1}/${flat.length}` : "";
						lines.push(
							freshStatus()
								? t.fg("success", " " + status)
								: t.fg(
										"dim",
										`↑↓/jk · c comment · d delete · L list · v word-diff:${wordDiffEnabled ? "on" : "off"} · W wrap:${wrapEnabled ? "on" : "off"} · x copy · n/p · esc back${scrollInfo}`,
								  ),
						);
					}
					return lines;
				}

				function renderComments(width: number): string[] {
					const lines: string[] = [];
					lines.push(t.bold(t.fg("accent", `Comments: ${comments.length}`)));
					lines.push("");
					const vh = Math.max(availHeight() - 2, 4);
					const disp: string[] = [];
					jumps = [];
					for (const fc of files) {
						const fcs = getCommentsForFile(comments, fc.absPath).sort((a, b) => a.diffLineIndex - b.diffLineIndex);
						if (fcs.length === 0) continue;
						const fidx = files.indexOf(fc);
						disp.push(t.fg("accent", fc.displayPath));
						jumps.push(null);
						for (const c of fcs) {
							const jump = { fileIdx: fidx, lineIdx: c.diffLineIndex };
							// Only the first row of each block is selectable, so ↑↓ steps
							// from comment to comment rather than through wrapped rows.
							const srcRows = wrapEnabled
								? wrapTextWithAnsi(t.fg("muted", c.lineContent.trim()), Math.max(8, width - 6))
								: [t.fg("muted", truncateToWidth(c.lineContent.trim(), Math.max(1, width - 6)))];
							srcRows.forEach((r, ri) => {
								disp.push("  " + r);
								jumps.push(ri === 0 ? jump : null);
							});
							const cmtRows = wrapEnabled
								? wrapTextWithAnsi(t.fg("warning", "✎ ") + c.text, Math.max(8, width - 8))
								: [t.fg("warning", "✎ ") + c.text];
							cmtRows.forEach((r, ri) => {
								disp.push("    " + r);
								jumps.push(ri === 0 ? jump : null);
							});
						}
						disp.push("");
						jumps.push(null);
					}
					if (disp.length === 0) {
						disp.push(t.fg("dim", "No comments yet. Press c on a diff line to add one."));
						jumps.push(null);
					}
					const selectable = jumps.map((j, i) => (j ? i : -1)).filter((i) => i >= 0);
					if (selectable.length === 0) commentSel = 0;
					else if (!jumps[commentSel])
						commentSel = selectable.find((i) => i >= commentSel) ?? selectable[selectable.length - 1];
					if (commentSel < commentScroll) commentScroll = commentSel;
					else if (commentSel >= commentScroll + vh) commentScroll = commentSel - vh + 1;
					commentScroll = Math.max(0, Math.min(commentScroll, Math.max(0, disp.length - vh)));
					for (let vi = 0; vi < vh; vi++) {
						const i = commentScroll + vi;
						const sel = i === commentSel && jumps[i] ? t.fg("accent", "› ") : "  ";
						lines.push(i < disp.length ? truncateToWidth(sel + disp[i], width) : "");
					}
					lines.push("");
					lines.push(t.fg("dim", "↑↓/jk move · enter jump · x copy · esc back"));
					return lines;
				}

				return {
					render(width: number): string[] {
						const border = new DynamicBorder((s: string) => t.fg("accent", s)).render(width);
						const out: string[] = [...border];
						if (view === "files") out.push(...renderFiles(width));
						else if (view === "diff") out.push(...renderDiff(width));
						else out.push(...renderComments(width));
						out.push(...border);
						// Hard clamp: pi-tui crashes on any line wider than the terminal,
						// and hint/status/header lines are not individually truncated.
						return out.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width) : l));
					},
					invalidate() {},
					handleInput(data: string) {
						if (commentMode) {
							if (matchesKey(data, Key.escape)) {
								commentMode = false;
								commentText = "";
								commentCursor = 0;
							} else if (matchesKey(data, Key.enter)) {
								const fc = files[fileIndex];
								const fl = flat[cursorLine];
								const exIdx = comments.findIndex((c) => c.filePath === fc.absPath && c.diffLineIndex === cursorLine);
								if (exIdx >= 0) comments.splice(exIdx, 1);
								if (commentText.trim()) {
									comments.push({
										filePath: fc.absPath,
										diffLineIndex: cursorLine,
										lineContent: fl?.raw ?? "",
										lineType: fl?.type ?? "context",
										text: commentText.trim(),
									});
									setStatus("Comment saved");
								}
								commentMode = false;
								commentText = "";
								commentCursor = 0;
							} else if (matchesKey(data, Key.backspace)) {
								if (commentCursor > 0) {
									const p = prevCodePoint(commentText, commentCursor);
									commentText = commentText.slice(0, p) + commentText.slice(commentCursor);
									commentCursor = p;
								}
							} else if (matchesKey(data, Key.delete)) {
								if (commentCursor < commentText.length)
									commentText =
										commentText.slice(0, commentCursor) +
										commentText.slice(nextCodePoint(commentText, commentCursor));
							} else if (matchesKey(data, Key.left)) {
								commentCursor = prevCodePoint(commentText, commentCursor);
							} else if (matchesKey(data, Key.right)) {
								commentCursor = nextCodePoint(commentText, commentCursor);
							} else if (matchesKey(data, Key.home)) {
								commentCursor = 0;
							} else if (matchesKey(data, Key.end)) {
								commentCursor = commentText.length;
							} else {
								const ins = commentInputText(data);
								if (ins) {
									commentText = commentText.slice(0, commentCursor) + ins + commentText.slice(commentCursor);
									commentCursor += ins.length;
								}
							}
							tui.requestRender();
							return;
						}

						if (view === "files") {
							if (matchesKey(data, Key.up) || data === "k") {
								if (fileIndex > 0) fileIndex--;
							} else if (matchesKey(data, Key.down) || data === "j") {
								if (fileIndex < files.length - 1) fileIndex++;
							} else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right) || data === "l") {
								loadFile(fileIndex);
								view = "diff";
							} else if (data === "L") {
								view = "comments";
								commentScroll = 0;
								commentSel = 0;
							} else if (data === "x") {
								doExport();
							} else if (data === "w") {
								try {
									const f = join(tmpdir(), `pi-session-changes-${Date.now()}.md`);
									writeFileSync(f, buildReport(files), "utf8");
									setStatus(copyClipboard(f) ? `Full report: ${f} (path copied)` : `Full report: ${f}`);
								} catch (e) {
									setStatus(`Report failed: ${(e as Error).message}`);
								}
							} else if (data === "S") {
								sendAfter = true;
								done();
								return;
							} else if (matchesKey(data, Key.escape) || data === "q") {
								done();
								return;
							}
						} else if (view === "diff") {
							if (matchesKey(data, Key.escape) || data === "h" || matchesKey(data, Key.left)) {
								view = "files";
							} else if (matchesKey(data, Key.up) || data === "k") {
								cursorLine--;
								clampCursor();
							} else if (matchesKey(data, Key.down) || data === "j") {
								cursorLine++;
								clampCursor();
							} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
								cursorLine -= Math.floor(availHeight() / 2);
								clampCursor();
							} else if (
								matchesKey(data, Key.pageDown) ||
								matchesKey(data, Key.ctrl("d")) ||
								matchesKey(data, Key.space)
							) {
								cursorLine += Math.floor(availHeight() / 2);
								clampCursor();
							} else if (data === "c") {
								const ex = getCommentAtLine(comments, files[fileIndex].absPath, cursorLine);
								commentMode = true;
								commentText = ex?.text ?? "";
								commentCursor = commentText.length;
							} else if (data === "d") {
								const idx = comments.findIndex(
									(c) => c.filePath === files[fileIndex].absPath && c.diffLineIndex === cursorLine,
								);
								if (idx >= 0) {
									comments.splice(idx, 1);
									setStatus("Comment deleted");
								}
							} else if (data === "L") {
								view = "comments";
								commentScroll = 0;
								commentSel = 0;
							} else if (data === "v") {
								wordDiffEnabled = !wordDiffEnabled;
							} else if (data === "W") {
								wrapEnabled = !wrapEnabled;
								setStatus(`Line wrap ${wrapEnabled ? "on" : "off"}`);
							} else if (data === "n") {
								if (fileIndex < files.length - 1) loadFile(fileIndex + 1);
							} else if (data === "p") {
								if (fileIndex > 0) loadFile(fileIndex - 1);
							} else if (data === "x") {
								doExport();
							} else if (data === "q") {
								done();
								return;
							}
						} else {
							if (matchesKey(data, Key.escape) || data === "q") {
								view = "files";
							} else if (matchesKey(data, Key.up) || data === "k") {
								const prev = jumps.map((j, i) => (j ? i : -1)).filter((i) => i >= 0 && i < commentSel);
								if (prev.length) commentSel = prev[prev.length - 1];
							} else if (matchesKey(data, Key.down) || data === "j") {
								const next = jumps.map((j, i) => (j ? i : -1)).filter((i) => i > commentSel);
								if (next.length) commentSel = next[0];
							} else if (matchesKey(data, Key.enter)) {
								const j = jumps[commentSel];
								if (j) {
									loadFile(j.fileIdx);
									cursorLine = j.lineIdx;
									clampCursor();
									view = "diff";
								}
							} else if (data === "x") {
								doExport();
							}
						}
						tui.requestRender();
					},
				};
			});

			if (sendAfter && comments.length > 0) {
				const text =
					"I reviewed your changes this session and left inline comments. Please address them:\n\n" +
					exportAnnotations(files, comments);
				if (ctx.isIdle()) {
					pi.sendUserMessage(text);
				} else {
					// Mid-run: an unqueued send throws inside pi and the comments are lost.
					// Queue as follow-up, and keep a copy because a send during compaction
					// still fails (pi swallows the error, so it cannot be detected here).
					let saved = "";
					try {
						saved = join(tmpdir(), `pi-review-${Date.now()}.md`);
						writeFileSync(saved, exportAnnotations(files, comments), "utf8");
					} catch {
						saved = "";
					}
					pi.sendUserMessage(text, { deliverAs: "followUp" });
					ctx.ui.notify(
						`Review comments queued as follow-up${saved ? `; copy saved to ${saved}` : ""}`,
						"info",
					);
				}
			}
		},
	});
}
