/**
 * Code Review Extension
 *
 * Provides a /diff command to review all code changes in the working tree
 * using a file list + diff viewer with inline commenting.
 *
 * Usage:
 *   /diff                - Review uncommitted changes (staged + unstaged + untracked)
 *   /diff --staged       - Review only staged changes
 *   /diff <commit>       - Review changes since a specific commit
 *
 * Keybindings (file list):
 *   ↑/↓ or j/k           - Navigate file list
 *   Enter or l/→          - View diff for selected file
 *   C                     - View all comments summary
 *   x                     - Export comments to markdown file
 *   e                     - Open in external editor ($EDITOR)
 *   t                     - Open in tuicr (if installed)
 *   q/Escape              - Quit
 *
 * Keybindings (diff view):
 *   ↑/↓ or j/k           - Move cursor line
 *   PageUp/PageDown       - Half-page scroll
 *   c                     - Add comment on current line
 *   d                     - Delete comment on current line
 *   n/p                   - Next/previous file
 *   Escape or h/←         - Back to file list
 *
 * Keybindings (comment input):
 *   Enter                 - Save comment
 *   Escape                - Cancel
 *
 * Keybindings (comments summary):
 *   ↑/↓ or j/k           - Select file/comment
 *   Enter                 - Jump to selection
 *   Escape                - Back
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	Key,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { execSync, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
	type Comment,
	type DiffSegment,
	annotateWordDiffs,
	commentInputText,
	fileHasComments,
	getCommentAtLine,
	getCommentsForFile,
	nextCodePoint,
	prevCodePoint,
	renderStatBar,
} from "./shared/diff-utils.js";
import { notifyInputNeeded } from "./shared/notify.js";

// ── Icons (Nerd Font via JS unicode escapes) ───────────────────────

const ICON = {
	comment: "\uF075",    // nf-fa-comment
	file: "\uF15C",       // nf-fa-file_text
	pencil: "\uF040",     // nf-fa-pencil
	export: "\uF56E",     // nf-mdi-export
} as const;

// ── Types ──────────────────────────────────────────────────────────────

interface FileDiff {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
	oldPath?: string;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

interface DiffLine {
	type: "context" | "added" | "removed" | "header";
	content: string;
	/** Source file line number (for added/context: new file; for removed: old file) */
	lineNumber?: number;
	/** Populated only for paired add/remove lines via annotateWordDiffs */
	segments?: DiffSegment[];
}

type View = "files" | "diff" | "comments";

/** Untracked files larger than this, or past this count, are left out of /diff. */
const UNTRACKED_MAX_BYTES = 512 * 1024;
const UNTRACKED_MAX_FILES = 200;

function shellQuoteSingle(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

// ── Diff Parsing ───────────────────────────────────────────────────────

/**
 * Undo git's C-style path quoting (`"caf\303\251.md"`): octal escapes are
 * UTF-8 bytes. Unquoted input is returned as is.
 */
function unquoteGitPath(s: string): string {
	if (!s.startsWith('"')) return s;
	const body = s.endsWith('"') && s.length > 1 ? s.slice(1, -1) : s.slice(1);
	const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, "\\": 92 };
	const bytes: number[] = [];
	for (let i = 0; i < body.length; i++) {
		const ch = String.fromCodePoint(body.codePointAt(i)!);
		if (ch.length > 1) i++;
		if (ch !== "\\" || i + 1 >= body.length) {
			bytes.push(...Buffer.from(ch, "utf8"));
			continue;
		}
		const next = body[++i]!;
		const oct = /^[0-7]{1,3}/.exec(body.slice(i, i + 3));
		if (oct) {
			bytes.push(parseInt(oct[0], 8) & 0xff);
			i += oct[0].length - 1;
		} else {
			bytes.push(simple[next] ?? next.charCodeAt(0));
		}
	}
	return Buffer.from(bytes).toString("utf8");
}

/** A `---`/`+++` path: unquoted, without the a/ or b/ prefix; null for /dev/null. */
function markerPath(rest: string): string | null {
	// git appends a tab after names containing spaces.
	const p = unquoteGitPath(rest.replace(/\t$/, ""));
	if (p === "/dev/null") return null;
	return p.replace(/^[ab]\//, "");
}

const QUOTED_PATH = String.raw`"(?:[^"\\]|\\.)*"`;
const DIFF_GIT_HEADER = new RegExp(`^(${QUOTED_PATH}|a/.+?) (${QUOTED_PATH}|b/.+)$`);

function parseGitDiff(raw: string): FileDiff[] {
	const files: FileDiff[] = [];
	const fileSections = raw.split(/^diff --git /m).filter(Boolean);

	for (const section of fileSections) {
		// CRLF files would otherwise keep a "\r" on every line.
		const lines = section.split(/\r?\n/);
		// The section's final newline is not an empty context line.
		if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
		if (lines.length === 0) continue;

		// Paths: the ---/+++ and rename lines are unambiguous; the diff --git
		// header is the fallback (binary and mode-only changes have nothing else).
		let oldPath: string | undefined;
		let newPath: string | undefined;
		const headerMatch = lines[0]!.match(DIFF_GIT_HEADER);
		if (headerMatch) {
			oldPath = unquoteGitPath(headerMatch[1]!).replace(/^a\//, "");
			newPath = unquoteGitPath(headerMatch[2]!).replace(/^b\//, "");
		}
		for (const line of lines.slice(1)) {
			if (line.startsWith("@@")) break;
			if (line.startsWith("--- ")) oldPath = markerPath(line.slice(4)) ?? oldPath;
			else if (line.startsWith("+++ ")) newPath = markerPath(line.slice(4)) ?? newPath;
			else if (line.startsWith("rename from ")) oldPath = unquoteGitPath(line.slice(12));
			else if (line.startsWith("rename to ")) newPath = unquoteGitPath(line.slice(10));
		}
		if (!newPath) newPath = oldPath;
		if (!oldPath) oldPath = newPath;
		if (!oldPath || !newPath) continue;

		let status: FileDiff["status"] = "modified";
		const isNew = lines.some((l) => l.startsWith("new file mode"));
		const isDel = lines.some((l) => l.startsWith("deleted file mode"));
		const isRename = lines.some((l) => l.startsWith("rename from"));

		if (isNew) status = "added";
		else if (isDel) status = "deleted";
		else if (isRename) status = "renamed";

		const hunks: DiffHunk[] = [];
		let currentHunk: DiffHunk | null = null;
		let additions = 0;
		let deletions = 0;
		let oldLineNum = 0;
		let newLineNum = 0;

		for (const line of lines) {
			if (line.startsWith("@@")) {
				// Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
				const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
				oldLineNum = hunkMatch ? parseInt(hunkMatch[1]!, 10) : 0;
				newLineNum = hunkMatch ? parseInt(hunkMatch[2]!, 10) : 0;
				currentHunk = { header: line, lines: [{ type: "header", content: line }] };
				hunks.push(currentHunk);
			} else if (currentHunk) {
				if (line.startsWith("+")) {
					currentHunk.lines.push({ type: "added", content: line.slice(1), lineNumber: newLineNum });
					newLineNum++;
					additions++;
				} else if (line.startsWith("-")) {
					currentHunk.lines.push({ type: "removed", content: line.slice(1), lineNumber: oldLineNum });
					oldLineNum++;
					deletions++;
				} else if (line.startsWith(" ") || line === "") {
					// git writes empty context lines as " "; a bare "" only survives
					// whitespace-stripping transports, the trailing artifact is gone.
					currentHunk.lines.push({ type: "context", content: line.slice(1) || "", lineNumber: newLineNum });
					oldLineNum++;
					newLineNum++;
				}
			}
		}

		files.push({
			path: newPath,
			status,
			oldPath: isRename ? oldPath : undefined,
			additions,
			deletions,
			hunks,
		});
	}

	return files;
}

// ── Word-level Diff ────────────────────────────────────────────────────
// Core wordDiff, tokenizeForWordDiff, and annotateWordDiffs are in shared/diff-utils.ts.
// This wrapper iterates the git-diff-specific FileDiff/DiffHunk structure.

function annotateWordDiffsForFiles(files: FileDiff[]): void {
	for (const file of files) {
		for (const hunk of file.hunks) {
			annotateWordDiffs(hunk.lines);
		}
	}
}

/** Flatten all diff lines for a file into a single array */
function flattenDiffLines(file: FileDiff): DiffLine[] {
	const flat: DiffLine[] = [];
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			flat.push(line);
		}
	}
	return flat;
}

// renderStatBar, getCommentsForFile, getCommentAtLine, fileHasComments
// are imported from shared/diff-utils.ts

function exportCommentsMarkdown(comments: Comment[], files: FileDiff[]): string {
	if (comments.length === 0) return "# Code Review\n\nNo comments.\n";

	const lines: string[] = [];
	lines.push("# Code Review Comments");
	lines.push("");
	lines.push(`> ${comments.length} comment${comments.length !== 1 ? "s" : ""} across ${new Set(comments.map((c) => c.filePath)).size} file${new Set(comments.map((c) => c.filePath)).size !== 1 ? "s" : ""}`);
	lines.push("");

	// Group by file
	const byFile = new Map<string, Comment[]>();
	for (const c of comments) {
		if (!byFile.has(c.filePath)) byFile.set(c.filePath, []);
		byFile.get(c.filePath)!.push(c);
	}

	for (const [filePath, fileComments] of byFile) {
		const file = files.find((f) => f.path === filePath);
		const statusTag = file ? ` \`${file.status}\`` : "";
		lines.push(`## ${filePath}${statusTag}`);
		lines.push("");

		// Sort by line index
		const sorted = [...fileComments].sort((a, b) => a.diffLineIndex - b.diffLineIndex);
		for (const comment of sorted) {
			const prefix = comment.lineType === "added" ? "+" : comment.lineType === "removed" ? "-" : " ";
			const lineRef = comment.lineNumber != null ? `L${comment.lineNumber}` : "";
			if (lineRef) lines.push(`**${lineRef}**`);
			lines.push("```diff");
			lines.push(`${prefix} ${comment.lineContent}`);
			lines.push("```");
			lines.push("");
			lines.push(`${ICON.comment} ${comment.text}`);
			lines.push("");
		}
	}

	return lines.join("\n");
}

// ── Extension ──────────────────────────────────────────────────────────

export default function codeReviewExtension(pi: ExtensionAPI) {
	pi.registerCommand("diff", {
		description: "Review git working-tree changes (git diff) with inline comments",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Code review requires interactive mode", "error");
				return;
			}

			// Determine git diff command
			const trimmed = (args || "").trim();
			let diffArgs: string[];
			if (trimmed === "--staged" || trimmed === "--cached") {
				diffArgs = ["diff", "--cached"];
			} else if (trimmed) {
				diffArgs = ["diff", ...trimmed.split(/\s+/)];
			} else {
				diffArgs = ["diff", "HEAD"];
			}

			// Unquoted UTF-8 paths in headers; every invocation goes through here.
			const git = (gitArgs: string[], cwd?: string) =>
				pi.exec("git", ["-c", "core.quotePath=false", ...gitArgs], { timeout: 10000, cwd });
			// pi.exec reports a timeout kill as code 0 (code null coerced).
			const failure = (r: { code: number; killed: boolean; stderr: string }) =>
				r.killed
					? "timed out after 10s"
					: r.code !== 0
						? r.stderr.trim().split("\n")[0] || `exit code ${r.code}`
						: null;

			// Get the diff
			const diffResult = await git(diffArgs);
			const diffErr = failure(diffResult);
			if (diffErr) {
				// Only the default `git diff HEAD` falls back (no commit yet); an
				// explicit argument that fails must not show a different diff.
				if (trimmed) {
					ctx.ui.notify(`git ${diffArgs.join(" ")} failed: ${diffErr}`, "error");
					return;
				}
				const fallback = await git(["diff"]);
				const fallbackErr = failure(fallback);
				if (fallbackErr) {
					ctx.ui.notify(`git diff failed: ${fallbackErr}`, "error");
					return;
				}
				diffResult.stdout = fallback.stdout;
			}

			// Diff paths are relative to the repo root, which may be above ctx.cwd.
			const top = await git(["rev-parse", "--show-toplevel"]);
			const repoRoot = (!failure(top) && top.stdout.trim()) || ctx.cwd;

			// The default working-tree review also shows untracked files, each
			// diffed against /dev/null (exit code 1 just means "differs").
			const untrackedIncluded: string[] = [];
			if (!trimmed) {
				const ls = await git(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot);
				const untracked = failure(ls) ? [] : ls.stdout.split("\0").filter(Boolean);
				// Comments are keyed by path, so a path the main diff already shows
				// (e.g. deleted from the index by `git rm --cached`) is not added twice.
				const shown = new Set<string>();
				for (const d of parseGitDiff(diffResult.stdout)) {
					shown.add(d.path);
					if (d.oldPath) shown.add(d.oldPath);
				}
				let skipped = 0;
				for (const f of untracked) {
					if (shown.has(f)) continue;
					let size = 0;
					try {
						size = statSync(join(repoRoot, f)).size;
					} catch {
						// Dangling symlink or vanished file.
						skipped++;
						continue;
					}
					if (size > UNTRACKED_MAX_BYTES || untrackedIncluded.length >= UNTRACKED_MAX_FILES) {
						skipped++;
						continue;
					}
					const r = await git(["diff", "--no-index", "--", "/dev/null", f], repoRoot);
					// Exit 1 also covers real errors (nested repo, symlink to a
					// directory): those print to stderr and produce no diff.
					if (r.killed || (r.code !== 0 && r.code !== 1) || (r.code === 1 && (!r.stdout || r.stderr.trim()))) {
						skipped++;
						continue;
					}
					untrackedIncluded.push(f);
					if (r.stdout) diffResult.stdout += (diffResult.stdout && !diffResult.stdout.endsWith("\n") ? "\n" : "") + r.stdout;
				}
				if (skipped > 0)
					ctx.ui.notify(
						`Skipped ${skipped} untracked file(s) (over ${UNTRACKED_MAX_BYTES / 1024} KB, past ${UNTRACKED_MAX_FILES} files, or git failed)`,
						"warning",
					);
			}

			if (!diffResult.stdout.trim()) {
				ctx.ui.notify("No changes to review", "info");
				return;
			}

			const files = parseGitDiff(diffResult.stdout);
			if (files.length === 0) {
				ctx.ui.notify("No changes to review", "info");
				return;
			}
			annotateWordDiffsForFiles(files);

			const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
			const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

			// ── Review UI ──────────────────────────────────────────
			notifyInputNeeded("code-review");
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				// ── State ──
				let view: View = "files";
				let fileIndex = 0;
				let scrollOffset = 0;
				let viewportHeight = 20;

				// Cursor line in diff view (index into flatLines)
				let cursorLine = 0;
				let flatLines: DiffLine[] = [];

				// Comment state
				const comments: Comment[] = [];
				let commentMode = false;
				let commentText = "";
				let commentCursorPos = 0;

				// Word-level diff toggle (inline highlights within paired add/remove lines)
				let wordDiffEnabled = true;

				// Plain view toggle (diff vs flat read mode)
				let plainViewEnabled = false;

				// Comments summary scroll, and the selected summary line (a non-null jump)
				let commentScrollOffset = 0;
				let commentSel = 0;
				// Mapping from summary display line → { fileIndex, diffLineIndex }
				let commentSummaryJumps: Array<{ fileIdx: number; lineIdx: number } | null> = [];

				// Help overlay
				let showHelp = false;

				// ── Helpers ──

				function clampCursor() {
					if (cursorLine < 0) cursorLine = 0;
					if (cursorLine >= flatLines.length) cursorLine = flatLines.length - 1;
					if (cursorLine < 0) cursorLine = 0;
				}

				// Plain view does not render hunk headers or removed lines, so the
				// cursor must never rest on one: step past them in direction `dir`,
				// or back the other way at either end.
				const hiddenInPlain = (i: number) => {
					const t = flatLines[i]?.type;
					return t === "header" || t === "removed";
				};
				function settleCursor(dir: 1 | -1 = 1) {
					clampCursor();
					if (!plainViewEnabled || !hiddenInPlain(cursorLine)) return;
					for (const d of [dir, -dir]) {
						let i = cursorLine;
						while (i >= 0 && i < flatLines.length && hiddenInPlain(i)) i += d;
						if (i >= 0 && i < flatLines.length) {
							cursorLine = i;
							return;
						}
					}
				}

				function loadFile(i: number) {
					fileIndex = i;
					flatLines = flattenDiffLines(files[fileIndex]!);
					cursorLine = 0;
					scrollOffset = 0;
					settleCursor(1);
				}

				// Hand the terminal to an interactive program (pi's own external-editor
				// flow: stop the TUI, run with inherited stdio, restart and redraw).
				function runInTerminal(command: string, label: string) {
					let result: ReturnType<typeof spawnSync> | undefined;
					_tui.stop();
					try {
						process.stdout.write("\x1b[2J\x1b[H");
						result = spawnSync(process.env.SHELL || "/bin/sh", ["-c", command], {
							stdio: "inherit",
							cwd: repoRoot,
							env: process.env,
						});
					} finally {
						_tui.start();
						_tui.requestRender(true);
					}
					if (result.error) exportStatus = `Failed to run ${label}: ${result.error.message}`;
					else if (result.status === 127) exportStatus = `${label} not found`;
					else if (result.status !== 0) exportStatus = `${label} exited with code ${result.status ?? result.signal}`;
					else return;
					exportStatusTime = Date.now();
				}

				// ── Render: File List ──
				function renderFileList(width: number, height: number): string[] {
					const lines: string[] = [];
					const innerWidth = width - 2;
					const commentCount = comments.length;

					lines.push(theme.fg("accent", theme.bold(" Code Review")) + theme.fg("dim", " [files]"));

					let subHeader =
						theme.fg("muted", ` ${files.length} file${files.length !== 1 ? "s" : ""} changed`) +
						"  " +
						theme.fg("toolDiffAdded", `+${totalAdditions}`) +
						" " +
						theme.fg("toolDiffRemoved", `-${totalDeletions}`);
					if (commentCount > 0) {
						subHeader += "  " + theme.fg("warning", `${ICON.comment} ${commentCount} comment${commentCount !== 1 ? "s" : ""}`);
					}
					lines.push(subHeader);
					lines.push("");

					// Window the list around the selection: 3 header rows, then a
					// blank, the help line and the status line below.
					const vh = Math.max(height - 6, 3);
					let start = 0;
					if (files.length > vh) start = Math.min(Math.max(fileIndex - Math.floor(vh / 2), 0), files.length - vh);
					for (let i = start; i < Math.min(files.length, start + vh); i++) {
						const f = files[i]!;
						const selected = i === fileIndex;
						const prefix = selected ? theme.fg("accent", "❯ ") : "  ";

						let statusIcon: string;
						switch (f.status) {
							case "added":
								statusIcon = theme.fg("toolDiffAdded", "A");
								break;
							case "deleted":
								statusIcon = theme.fg("toolDiffRemoved", "D");
								break;
							case "renamed":
								statusIcon = theme.fg("warning", "R");
								break;
							default:
								statusIcon = theme.fg("accent", "M");
						}

						const stats =
							theme.fg("toolDiffAdded", `+${f.additions}`) +
							" " +
							theme.fg("toolDiffRemoved", `-${f.deletions}`);

						const pathDisplay = f.oldPath
							? theme.fg("muted", f.oldPath + " → ") + f.path
							: f.path;

						// Comment indicator
						const hasComments = fileHasComments(comments, f.path);
						const commentBadge = hasComments
							? " " + theme.fg("warning", `${ICON.comment}${getCommentsForFile(comments, f.path).length}`)
							: "";

						const fileLine = `${prefix}${statusIcon} ${pathDisplay}${commentBadge}`;
						const statsWidth = 12;
						const fileLineWidth = visibleWidth(fileLine);
						const padding = Math.max(1, innerWidth - fileLineWidth - statsWidth);

						const bar = renderStatBar(f.additions, f.deletions, 10, theme);

						lines.push(truncateToWidth(fileLine + " ".repeat(padding) + stats + " " + bar, width));
					}

					lines.push("");
					const helpParts = [
						"↑↓/jk navigate",
						"Enter/l diff",
						"PgUp/PgDn first/last",
						"C comments",
						"x export",
						"e editor",
						"t tuicr",
						"? help",
						"q quit",
					];
					const pos = files.length > vh ? `[${fileIndex + 1}/${files.length}] ` : "";
					lines.push(truncateToWidth(theme.fg("dim", " " + pos + helpParts.join(" • ")), width));

					// Show export/action status if recent (3s)
					if (exportStatus && Date.now() - exportStatusTime < 3000) {
						lines.push(truncateToWidth(theme.fg("success", ` ${exportStatus}`), width));
					}

					return lines;
				}

				// ── Render: Diff View ──
				function renderDiffView(width: number, height: number): string[] {
					const f = files[fileIndex]!;
					flatLines = flattenDiffLines(f);
					clampCursor();

					const allLines: string[] = [];
					const fileComments = getCommentsForFile(comments, f.path);
					const innerWidth = Math.max(10, width - 2);
					// Wrap budget for diff lines: reserve 2 cols for the cursor/indent marker
					const diffWrapWidth = Math.max(10, width - 2);
					// Wrap budget for comment body: reserve ~6 cols for "  \u2503 icon " prefix
					const commentWrapWidth = Math.max(10, width - 6);

					// ── Header (3 lines) ──
					const statusLabel =
						f.status === "added"
							? theme.fg("toolDiffAdded", "[new file]")
							: f.status === "deleted"
								? theme.fg("toolDiffRemoved", "[deleted]")
								: f.status === "renamed"
									? theme.fg("warning", "[renamed]")
									: "";
					const headerModeTag = plainViewEnabled ? " [plain]" : " [diff]";
					const headerTitle =
						theme.fg("accent", theme.bold(` ${f.path}`)) +
						(statusLabel ? " " + statusLabel : "") +
						theme.fg("muted", headerModeTag);
					allLines.push(...wrapTextWithAnsi(headerTitle, width));
					if (!plainViewEnabled) {
						allLines.push(
							theme.fg("toolDiffAdded", ` +${f.additions}`) +
								" " +
								theme.fg("toolDiffRemoved", `-${f.deletions}`) +
								"  " +
								renderStatBar(f.additions, f.deletions, 20, theme),
						);
					}
					allLines.push(theme.fg("borderMuted", "─".repeat(Math.min(innerWidth, 80))));

					const headerLines = allLines.length;

					// Track where the cursor line is rendered so we can scroll to it
					let cursorRenderedStart = headerLines;
					let cursorRenderedEnd = headerLines;

					// ── Diff lines with inline comments ──
					for (let i = 0; i < flatLines.length; i++) {
						const dl = flatLines[i]!;

						// In plain view, skip removed lines entirely
						if (plainViewEnabled && dl.type === "removed") continue;
						const isCursor = i === cursorLine;
						const renderStart = allLines.length;

						const renderSegmented = (color: Parameters<typeof theme.fg>[0], prefix: string, segs: DiffSegment[]): string => {
							// Reverse-video (\x1b[7m..\x1b[27m) layered on top of the base
							// color so changed tokens read as a colored block. wrapTextWithAnsi
							// handles these SGR codes correctly.
							const body = segs
								.map((seg) =>
									seg.changed
										? theme.fg(color, `\x1b[7m${seg.text}\x1b[27m`)
										: theme.fg(color, seg.text),
								)
								.join("");
							return theme.fg(color, prefix) + body;
						};

						let lineStr: string;
						switch (dl.type) {
							case "header":
								if (plainViewEnabled) continue;
								lineStr = theme.fg("accent", dl.content);
								break;
							case "added":
								lineStr =
									wordDiffEnabled && dl.segments
										? renderSegmented("toolDiffAdded", "+ ", dl.segments)
										: theme.fg("toolDiffAdded", "+ " + dl.content);
								break;
							case "removed":
								lineStr =
									wordDiffEnabled && dl.segments
										? renderSegmented("toolDiffRemoved", "- ", dl.segments)
										: theme.fg("toolDiffRemoved", "- " + dl.content);
								break;
							case "context":
								lineStr = plainViewEnabled
										? dl.content
										: theme.fg("dim", "  " + dl.content);
								break;
							default:
								lineStr = dl.content;
						}

						// Wrap instead of truncating so full code is visible
						const wrapped = wrapTextWithAnsi(lineStr, diffWrapWidth);
						for (let w = 0; w < wrapped.length; w++) {
							const prefix =
								w === 0 && isCursor ? theme.fg("accent", "▸ ") : "  ";
							allLines.push(prefix + wrapped[w]);
						}

						// Render inline comment if present
						const cmt = getCommentAtLine(fileComments, f.path, i);
						if (cmt) {
							const headPrefix = theme.fg("warning", `  \u2503 ${ICON.comment} `);
							const contPrefix = theme.fg("warning", `  \u2503   `);
							const wrappedCmt = wrapTextWithAnsi(
								theme.fg("warning", cmt.text),
								commentWrapWidth,
							);
							for (let w = 0; w < wrappedCmt.length; w++) {
								allLines.push((w === 0 ? headPrefix : contPrefix) + wrappedCmt[w]);
							}
							allLines.push(
								theme.fg(
									"warning",
									"  ┗" + "─".repeat(Math.max(4, Math.min(innerWidth - 4, 40))),
								),
							);
						}

						// Render inline input if we're in comment mode on this line
						if (commentMode && isCursor && !(plainViewEnabled && dl.type === "removed")) {
							const headPrefix = theme.fg("accent", `  \u2503 ${ICON.pencil} `);
							const contPrefix = theme.fg("accent", `  \u2503   `);
							const beforeCursor = commentText.slice(0, commentCursorPos);
							const cursorEnd = nextCodePoint(commentText, commentCursorPos);
							const atCursor = commentText.slice(commentCursorPos, cursorEnd) || " ";
							const afterCursor = commentText.slice(cursorEnd);
							const inputBody =
								beforeCursor +
								theme.fg("accent", `\x1b[7m${atCursor}\x1b[27m`) +
								afterCursor;
							const wrappedInput = wrapTextWithAnsi(inputBody, commentWrapWidth);
							for (let w = 0; w < wrappedInput.length; w++) {
								allLines.push((w === 0 ? headPrefix : contPrefix) + wrappedInput[w]);
							}
							allLines.push(
								theme.fg(
									"accent",
									"  ┗" + "─".repeat(Math.min(40, Math.max(4, innerWidth - 4))),
								) + theme.fg("dim", " Enter save • Esc cancel"),
							);
						}

						if (isCursor) {
							cursorRenderedStart = renderStart;
							cursorRenderedEnd = allLines.length - 1;
						}
					}

					if (flatLines.length === 0) {
						allLines.push(theme.fg("muted", "  (binary file or no diff content)"));
					}

					// ── Footer ──
					allLines.push("");
					const pos = `${fileIndex + 1}/${files.length}`;
					const commentInfo = fileComments.length > 0 ? ` \u2022 ${ICON.comment} ${fileComments.length}` : "";
					const wordDiffTag = wordDiffEnabled ? "on" : "off";
					const modeTag = plainViewEnabled ? "plain" : "diff";
					const footerLine = commentMode
						? theme.fg("accent", `${ICON.pencil} Type your comment, Enter to save, Escape to cancel`)
						: theme.fg("dim", ` Esc/h back • ↑↓/jk move • c comment • d delete • n/p file • v ${modeTag} • w word-diff:${wordDiffTag} • ? help • [${pos}]${commentInfo}`);
					allLines.push(...wrapTextWithAnsi(footerLine, width));

					// ── Viewport ──
					viewportHeight = Math.max(height - 2, 10);

					// Scroll so cursor (and any inline comment/input below it) is visible
					if (cursorRenderedStart < scrollOffset + headerLines) {
						scrollOffset = Math.max(0, cursorRenderedStart - headerLines);
					} else if (cursorRenderedEnd >= scrollOffset + viewportHeight - 2) {
						scrollOffset = cursorRenderedEnd - viewportHeight + 3;
					}

					const maxScroll = Math.max(0, allLines.length - viewportHeight);
					scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

					const visible = allLines.slice(scrollOffset, scrollOffset + viewportHeight);

					if (allLines.length > viewportHeight) {
						const pct = maxScroll > 0 ? Math.round((scrollOffset / maxScroll) * 100) : 0;
						visible.push(theme.fg("muted", ` ── ${pct}% ──`));
					}

					return visible;
				}

				// ── Render: Comments Summary ──
				function renderCommentsSummary(width: number, height: number): string[] {
					const allLines: string[] = [];
					commentSummaryJumps = [];
					const innerWidth = width - 2;

					allLines.push(theme.fg("accent", theme.bold(` ${ICON.comment} All Comments`)));
					commentSummaryJumps.push(null);

					if (comments.length === 0) {
						allLines.push("");
						commentSummaryJumps.push(null);
						allLines.push(theme.fg("muted", " No comments yet. Press c in the diff view to add one."));
						commentSummaryJumps.push(null);
					} else {
						allLines.push(
							theme.fg("muted", ` ${comments.length} comment${comments.length !== 1 ? "s" : ""}`) +
								" across " +
								theme.fg("muted", `${new Set(comments.map((c) => c.filePath)).size} file${new Set(comments.map((c) => c.filePath)).size !== 1 ? "s" : ""}`),
						);
						commentSummaryJumps.push(null);
						allLines.push("");
						commentSummaryJumps.push(null);

						// Group by file
						const byFile = new Map<string, Comment[]>();
						for (const c of comments) {
							if (!byFile.has(c.filePath)) byFile.set(c.filePath, []);
							byFile.get(c.filePath)!.push(c);
						}

						for (const [filePath, fileComments] of byFile) {
							const fIdx = files.findIndex((f) => f.path === filePath);

							allLines.push(theme.fg("accent", theme.bold(`${ICON.file} ${filePath}`)));
							commentSummaryJumps.push(fIdx >= 0 ? { fileIdx: fIdx, lineIdx: 0 } : null);
							// Only the first row of each block is selectable, so ↑↓ steps
							// file to comment to comment rather than through wrapped rows.

							allLines.push(theme.fg("borderMuted", " " + "─".repeat(Math.min(innerWidth - 2, 60))));
							commentSummaryJumps.push(null);

							const sorted = [...fileComments].sort((a, b) => a.diffLineIndex - b.diffLineIndex);
							const summaryWrapWidth = Math.max(10, width - 6);
							for (const cmt of sorted) {
								const prefix = cmt.lineType === "added" ? "+" : cmt.lineType === "removed" ? "-" : " ";
								const lineColor = cmt.lineType === "added" ? "toolDiffAdded" : cmt.lineType === "removed" ? "toolDiffRemoved" : "dim";
								const jumpTarget = fIdx >= 0 ? { fileIdx: fIdx, lineIdx: cmt.diffLineIndex } : null;

								const wrappedSrc = wrapTextWithAnsi(
									theme.fg(lineColor, `${prefix} ${cmt.lineContent}`),
									summaryWrapWidth,
								);
								wrappedSrc.forEach((wl, wi) => {
									allLines.push("   " + wl);
									commentSummaryJumps.push(wi === 0 ? jumpTarget : null);
								});

								const wrappedCmt = wrapTextWithAnsi(
									theme.fg("warning", `${ICON.comment} ${cmt.text}`),
									summaryWrapWidth,
								);
								for (const wl of wrappedCmt) {
									allLines.push("   " + wl);
									commentSummaryJumps.push(null);
								}

								allLines.push("");
								commentSummaryJumps.push(null);
							}
						}
					}

					allLines.push("");
					commentSummaryJumps.push(null);
					allLines.push(theme.fg("dim", " Esc back • ↑↓/jk select • Enter jump • x export • ? help"));
					commentSummaryJumps.push(null);

					// Selection: snap to a selectable line, then keep it in view.
					const selectable = commentSummaryJumps.map((j, i) => (j ? i : -1)).filter((i) => i >= 0);
					if (selectable.length === 0) commentSel = 0;
					else if (!commentSummaryJumps[commentSel])
						commentSel = selectable.find((i) => i >= commentSel) ?? selectable[selectable.length - 1]!;

					// Viewport
					viewportHeight = Math.max(height - 2, 10);
					if (selectable.length > 0) {
						if (commentSel < commentScrollOffset) commentScrollOffset = commentSel;
						else if (commentSel >= commentScrollOffset + viewportHeight)
							commentScrollOffset = commentSel - viewportHeight + 1;
					}
					const maxScroll = Math.max(0, allLines.length - viewportHeight);
					commentScrollOffset = Math.max(0, Math.min(commentScrollOffset, maxScroll));

					const visible = allLines
						.slice(commentScrollOffset, commentScrollOffset + viewportHeight)
						.map((l, vi) => {
							const i = commentScrollOffset + vi;
							const mark = i === commentSel && commentSummaryJumps[i] ? theme.fg("accent", "› ") : "  ";
							return truncateToWidth(mark + l, width);
						});

					if (allLines.length > viewportHeight) {
						const pct = maxScroll > 0 ? Math.round((commentScrollOffset / maxScroll) * 100) : 0;
						visible.push(theme.fg("muted", ` ── ${pct}% ──`));
					}

					return visible;
				}

				// ── Export ──
				// Export status message (shown in-view since notify may not be visible)
				let exportStatus = "";
				let exportStatusTime = 0;

				function doExport() {
					if (comments.length === 0) {
						exportStatus = "No comments to export";
						exportStatusTime = Date.now();
						return;
					}
					const md = exportCommentsMarkdown(comments, files);
					try {
						execSync("pbcopy", { input: md, encoding: "utf8" });
						exportStatus = `${ICON.export} ${comments.length} comment${comments.length !== 1 ? "s" : ""} copied to clipboard`;
					} catch (e) {
						exportStatus = `Export failed: ${e}`;
					}
					exportStatusTime = Date.now();
				}

				// ── Render: Help ──
				function renderHelp(width: number): string[] {
					const lines: string[] = [];
					const hr = theme.fg("borderMuted", "─".repeat(Math.min(width - 2, 60)));

					lines.push(theme.fg("accent", theme.bold(" Keybindings")));
					lines.push("");

					const section = (title: string, keys: [string, string][]) => {
						lines.push(theme.fg("accent", ` ${title}`));
						lines.push(hr);
						for (const [key, desc] of keys) {
							const pad = Math.max(1, 20 - visibleWidth(key));
							lines.push(`  ${theme.fg("warning", key)}${" ".repeat(pad)}${theme.fg("muted", desc)}`);
						}
						lines.push("");
					};

					section("File List", [
						["↑/↓ or j/k", "Navigate files"],
						["Enter or l/→", "View diff for selected file"],
						["C", "View all comments summary"],
						["x", "Export comments to markdown"],
						["e", "Open file in $EDITOR"],
						["t", "Open in tuicr"],
						["q / Esc", "Quit review"],
					]);

				section("Diff View", [
					["↑/↓ or j/k", "Move cursor line"],
					["PgUp/PgDn or Ctrl+d/u", "Half-page scroll"],
					["v", "Toggle diff / plain view"],
					["c", "Add/edit comment on current line"],
					["d", "Delete comment on current line"],
					["n / p", "Next / previous file"],
					["w", "Toggle word-level highlighting"],
					["x", "Export comments to markdown"],
					["Esc or h/←", "Back to file list"],
				]);

					section("Comment Input", [
						["Enter", "Save comment"],
						["Esc", "Cancel"],
					]);

					section("Comments Summary", [
						["↑/↓ or j/k", "Select file/comment"],
						["Enter", "Jump to selection"],
						["x", "Export comments to markdown"],
						["Esc", "Back to file list"],
					]);

					lines.push(theme.fg("dim", " Press any key to close"));

					return lines;
				}

				// ── Component ──
				return {
					render(width: number): string[] {
						const lines: string[] = [];
						const borderFn = (s: string) => theme.fg("accent", s);
						const border = new DynamicBorder(borderFn);
						const borderLines = border.render(width);
						lines.push(...borderLines);

						const availHeight = Math.max((process.stdout.rows || 40) - 4, 10);

						if (showHelp) {
							lines.push(...renderHelp(width));
						} else if (view === "files") {
							lines.push(...renderFileList(width, availHeight));
						} else if (view === "diff") {
							lines.push(...renderDiffView(width, availHeight));
						} else if (view === "comments") {
							lines.push(...renderCommentsSummary(width, availHeight));
						}

						lines.push(...borderLines);
						// Hard clamp: pi-tui crashes on any line wider than the terminal
						// (help line, comment-input footer and headers are not truncated).
						return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width) : l));
					},

					invalidate() {},

					handleInput(data: string) {
						// ── Help overlay ──
						if (showHelp) {
							showHelp = false;
							_tui.requestRender();
							return;
						}

						// ── Comment Input Mode ──
						if (commentMode) {
							if (matchesKey(data, Key.escape)) {
								commentMode = false;
								commentText = "";
								commentCursorPos = 0;
							} else if (matchesKey(data, Key.enter)) {
								// Save comment
								if (commentText.trim()) {
									const f = files[fileIndex]!;
									const dl = flatLines[cursorLine];
									// Remove existing comment on this line first
									const existingIdx = comments.findIndex(
										(c) => c.filePath === f.path && c.diffLineIndex === cursorLine,
									);
									if (existingIdx >= 0) comments.splice(existingIdx, 1);

									comments.push({
										filePath: f.path,
										diffLineIndex: cursorLine,
										lineContent: dl?.content ?? "",
										lineType: dl?.type ?? "context",
										lineNumber: dl?.lineNumber,
										text: commentText.trim(),
									});
								}
								commentMode = false;
								commentText = "";
								commentCursorPos = 0;
							} else if (matchesKey(data, Key.backspace)) {
								if (commentCursorPos > 0) {
									const p = prevCodePoint(commentText, commentCursorPos);
									commentText = commentText.slice(0, p) + commentText.slice(commentCursorPos);
									commentCursorPos = p;
								}
							} else if (matchesKey(data, Key.delete)) {
								if (commentCursorPos < commentText.length) {
									commentText =
										commentText.slice(0, commentCursorPos) +
										commentText.slice(nextCodePoint(commentText, commentCursorPos));
								}
							} else if (matchesKey(data, Key.left)) {
								commentCursorPos = prevCodePoint(commentText, commentCursorPos);
							} else if (matchesKey(data, Key.right)) {
								commentCursorPos = nextCodePoint(commentText, commentCursorPos);
							} else if (matchesKey(data, Key.home)) {
								commentCursorPos = 0;
							} else if (matchesKey(data, Key.end)) {
								commentCursorPos = commentText.length;
							} else {
								// Typed text (any printable, emoji included) or a whole paste
								const ins = commentInputText(data);
								if (ins) {
									commentText =
										commentText.slice(0, commentCursorPos) + ins + commentText.slice(commentCursorPos);
									commentCursorPos += ins.length;
								}
							}
							_tui.requestRender();
							return;
						}

						// ── File List ──
						if (view === "files") {
							if (matchesKey(data, Key.up) || data === "k") {
								if (fileIndex > 0) fileIndex--;
							} else if (matchesKey(data, Key.down) || data === "j") {
								if (fileIndex < files.length - 1) fileIndex++;
							} else if (matchesKey(data, Key.enter) || data === "l" || matchesKey(data, Key.right)) {
								view = "diff";
								loadFile(fileIndex);
						} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
							fileIndex = 0;
						} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
							fileIndex = files.length - 1;
							} else if (matchesKey(data, Key.escape) || data === "q") {
								done();
								return;
							} else if (data === "C") {
								view = "comments";
								commentScrollOffset = 0;
								commentSel = 0;
							} else if (data === "x") {
								doExport();
							} else if (data === "e") {
								// $EDITOR may carry its own flags ("code -w"), so it goes through the shell.
								const editor = process.env.EDITOR || "vim";
								const file = join(repoRoot, files[fileIndex]!.path);
								runInTerminal(`${editor} ${shellQuoteSingle(file)}`, editor);
							} else if (data === "t") {
								runInTerminal("tuicr -w", "tuicr");
							} else if (data === "?") {
								showHelp = true;
							}

						// ── Diff View ──
						} else if (view === "diff") {
							if (matchesKey(data, Key.escape) || data === "h" || matchesKey(data, Key.left)) {
								view = "files";
							} else if (matchesKey(data, Key.up) || data === "k") {
								cursorLine--;
								settleCursor(-1);
							} else if (matchesKey(data, Key.down) || data === "j") {
								cursorLine++;
								settleCursor(1);
							} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
								cursorLine -= Math.floor(viewportHeight / 2);
								settleCursor(-1);
								scrollOffset = Math.max(0, scrollOffset - Math.floor(viewportHeight / 2));
							} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
								cursorLine += Math.floor(viewportHeight / 2);
								settleCursor(1);
								scrollOffset += Math.floor(viewportHeight / 2);
							} else if (data === "c") {
								// Enter comment mode
								const f = files[fileIndex]!;
								const existing = getCommentAtLine(comments, f.path, cursorLine);
								commentMode = true;
								commentText = existing?.text ?? "";
								commentCursorPos = commentText.length;
							} else if (data === "d") {
								// Delete comment on current line
								const f = files[fileIndex]!;
								const idx = comments.findIndex(
									(c) => c.filePath === f.path && c.diffLineIndex === cursorLine,
								);
								if (idx >= 0) {
									comments.splice(idx, 1);
								}
							} else if (data === "n") {
								if (fileIndex < files.length - 1) loadFile(fileIndex + 1);
							} else if (data === "p") {
								if (fileIndex > 0) loadFile(fileIndex - 1);
							} else if (data === "w") {
								wordDiffEnabled = !wordDiffEnabled;
							} else if (data === "v") {
								plainViewEnabled = !plainViewEnabled;
								settleCursor(1);
							} else if (data === "x") {
								doExport();
							} else if (data === "?") {
								showHelp = true;
							} else if (data === "q") {
								done();
								return;
							}

						// ── Comments Summary ──
						} else if (view === "comments") {
							if (matchesKey(data, Key.escape)) {
								view = "files";
							} else if (
								matchesKey(data, Key.up) ||
								data === "k" ||
								matchesKey(data, Key.pageUp) ||
								matchesKey(data, Key.ctrl("u"))
							) {
								// Page keys move the selection half a page, arrows one item.
								const page = matchesKey(data, Key.up) || data === "k" ? 0 : Math.floor(viewportHeight / 2);
								const prev = commentSummaryJumps
									.map((j, i) => (j ? i : -1))
									.filter((i) => i >= 0 && i < commentSel - page);
								const first = commentSummaryJumps.findIndex((j) => j);
								if (prev.length) commentSel = prev[prev.length - 1]!;
								else if (page && first >= 0) commentSel = first;
							} else if (
								matchesKey(data, Key.down) ||
								data === "j" ||
								matchesKey(data, Key.pageDown) ||
								matchesKey(data, Key.ctrl("d"))
							) {
								const page = matchesKey(data, Key.down) || data === "j" ? 0 : Math.floor(viewportHeight / 2);
								const next = commentSummaryJumps
									.map((j, i) => (j ? i : -1))
									.filter((i) => i >= 0 && i > commentSel + page);
								const sel = commentSummaryJumps.map((j, i) => (j ? i : -1)).filter((i) => i >= 0);
								if (next.length) commentSel = next[0]!;
								else if (page && sel.length) commentSel = sel[sel.length - 1]!;
							} else if (matchesKey(data, Key.enter)) {
								// Jump to the selected file/comment
								const jumpTarget = commentSummaryJumps[commentSel];
								if (jumpTarget) {
									loadFile(jumpTarget.fileIdx);
									cursorLine = jumpTarget.lineIdx;
									settleCursor(1);
									view = "diff";
								}
							} else if (data === "x") {
								doExport();
							} else if (data === "?") {
								showHelp = true;
							} else if (data === "q") {
								done();
								return;
							}
						}

						_tui.requestRender();
					},
				};
			});
		},
	});
}
