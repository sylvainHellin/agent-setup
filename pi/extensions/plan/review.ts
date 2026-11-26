/**
 * The review surface of `/annotate`: a full-screen TUI overlay over pi.
 *
 * j/k move a cursor over the rendered markdown; c comments the cursor line, or
 * edits its comment when it has one; g does the same for the one general
 * comment on the whole document; d deletes the cursor line's comment and n/N
 * jump between commented lines; s sends, q discards. Saving an empty comment
 * deletes it. Esc and Enter close the overlay only while it holds no
 * comments, so a spare key after leaving the comment input loses nothing.
 *
 * Comments are written in a floating box over the review, in pi-vim's
 * ModalEditor (normal and insert modes, motions, operators, undo), the vim
 * editor pi already uses for its prompt; without pi-vim the input is pi-tui's
 * plain Editor. Ctrl+U and Ctrl+D move the cursor half the input's height.
 *
 * Vim yanks copy to the clipboard: yi` the code block holding the cursor
 * (its source text, without fences), yy the cursor line. Any other key after
 * y or yi cancels the yank and then acts as usual; Esc only cancels.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getAgentDir, getMarkdownTheme, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type EditorTheme,
	type Focusable,
	Key,
	Markdown,
	type MarkdownTheme,
	Marked,
	matchesKey,
	type OverlayHandle,
	type OverlayOptions,
	type Token,
	type Tokens,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import path from "node:path";
import { notifyInputNeeded } from "../shared/notify.js";
import { stripAnsi } from "./helpers.js";
import type { ReviewComment } from "./types.js";

// ── Vim comment editor ───────────────────────────────────────────────
//
// pi-vim (`npm:pi-vim` in settings.json) exports the ModalEditor it installs
// as pi's prompt editor. An extension cannot import a pi package by name, so it is
// loaded by path from pi's package dir; pi's extension loader resolves its own
// imports of pi-coding-agent and pi-tui.

type CommentEditor = Editor & { onEscape?: () => void };

// pi-vim ships TypeScript source loaded at runtime, with no types here.
type ModalEditorClass = new (tui: any, theme: EditorTheme, keybindings: any) => any;

let modalEditor: Promise<ModalEditorClass | undefined> | undefined;

function loadModalEditor(): Promise<ModalEditorClass | undefined> {
	modalEditor ??= import(path.join(getAgentDir(), "npm", "node_modules", "pi-vim", "index.ts"))
		.then((module) => module.ModalEditor as ModalEditorClass | undefined)
		.catch(() => undefined);
	return modalEditor;
}

/** A comment input: pi-vim's ModalEditor when available, else pi-tui's Editor. */
function newCommentEditor(
	ModalEditor: ModalEditorClass | undefined,
	tui: any,
	editorTheme: EditorTheme,
	keybindings: any,
	cancel: () => void,
	notify: (message: string) => void,
): CommentEditor {
	if (!ModalEditor) return new Editor(tui, editorTheme);
	const editor = new ModalEditor(tui, editorTheme, keybindings);
	editor.setNotifyFn(notify);
	// `:q` cancels the comment instead of quitting pi.
	editor.setQuitFn(cancel);
	editor.setHistoryNavigation(false);
	// `:name` would otherwise submit `/name` as the comment text.
	editor.setExCommandSettings({ piDispatch: false, copyInputToClipboard: false });
	editor.setCommandNamesFn(() => new Set<string>());
	// Esc in normal mode reaches pi's interrupt binding, which calls onEscape.
	editor.onEscape = cancel;
	return editor;
}

/** Rows the editor shows before it scrolls: pi-tui's Editor caps itself at 30% of the terminal, at least 5. */
const editorRows = (tui: TUI) => Math.max(5, Math.floor(tui.terminal.rows * 0.3));

/**
 * Ctrl+U / Ctrl+D: move the cursor half the editor's height up or down, by
 * wrapped rows, landing on the start or end of the text when that is closer.
 * Uses pi-tui Editor internals (present on ModalEditor, which extends it).
 */
function jumpHalfPage(editor: CommentEditor, direction: -1 | 1, rows: number, vim: boolean): void {
	const e = editor as any;
	if (typeof e.buildVisualLineMap !== "function" || typeof e.moveToVisualLine !== "function") return;
	// A pending vim operator or count (`d`, `3`) must not apply to the jump's next key.
	if (vim) e.clearPendingState?.();
	const map = e.buildVisualLineMap(e.lastWidth);
	if (!Array.isArray(map) || map.length === 0) return;
	const current = e.findCurrentVisualLine(map) as number;
	const target = current + direction * Math.max(3, Math.floor(rows / 2));
	const lines = editor.getLines();
	e.lastAction = null;
	if (direction < 0 && target <= 0) {
		e.state.cursorLine = 0;
		e.setCursorCol(0);
	} else if (direction > 0 && target >= map.length - 1) {
		e.state.cursorLine = lines.length - 1;
		e.setCursorCol(lines[lines.length - 1]?.length ?? 0);
	} else {
		e.moveToVisualLine(map, current, target);
	}
	if (vim) {
		e.displayWantedColumn = null;
		// Normal mode keeps the cursor on a character, never past the line's end.
		if (e.getMode?.() !== "insert") e.clampCursorToLastGrapheme?.();
	}
}

/**
 * The floating comment box: one rounded accent border holding the heading
 * (styled by the caller), the full commented line when the heading had to cut
 * it, the editor (its own border rules dropped) and a hint line; the vim mode
 * and scroll counts sit in the bottom border.
 */
function commentBox(
	tui: TUI,
	theme: Theme,
	editor: CommentEditor,
	vim: boolean,
	heading: string,
	excerpt: string,
	cancel: () => void,
): Component & Focusable {
	let focused = false;
	const accent = (s: string) => theme.fg("accent", s);
	return {
		get focused() {
			return focused;
		},
		set focused(value: boolean) {
			focused = value;
			editor.focused = value;
		},
		render(width: number): string[] {
			const inner = Math.max(10, width - 4);
			const row = (content: string) => {
				const fitted = truncateToWidth(content, inner, "");
				return `${accent("\u2502")} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${accent("\u2502")}`;
			};

			const body: string[] = [row(heading)];
			if (excerpt) {
				const wrapped = wrapTextWithAnsi(excerpt, inner - 2);
				const shown = wrapped.slice(0, 3);
				if (wrapped.length > 3) shown[2] = truncateToWidth(`${shown[2]} \u2026`, inner - 2);
				for (const line of shown) body.push(row(theme.fg("dim", `\u258f ${line}`)));
			}
			body.push(row(""));

			// The editor draws a rule above and below its text, with scroll counts in them.
			const rendered = editor.render(inner);
			const counts = [rendered[0], rendered[rendered.length - 1]]
				.map((rule) => /[\u2191\u2193] \d+ more/.exec(stripAnsi(rule ?? ""))?.[0])
				.filter(Boolean)
				.join(" ");
			for (const line of rendered.slice(1, -1)) body.push(row(line));
			body.push(row(""));

			const mode = vim ? (editor as any).getMode?.() : undefined;
			const hint = !vim
				? "Enter save \u00b7 Esc cancel \u00b7 Ctrl+U/D jump"
				: mode === "insert"
					? "Enter save \u00b7 Esc normal \u00b7 Esc Esc cancel \u00b7 Ctrl+U/D jump"
					: "Enter save \u00b7 i insert \u00b7 Esc cancel \u00b7 Ctrl+U/D jump";
			body.push(row(theme.fg("dim", hint)));

			const label = vim ? (((editor as any).getModeLabel?.() as string | undefined) ?? ` ${String(mode).toUpperCase()} `) : "";
			const left = counts ? `\u2500 ${counts} ` : "";
			const fill = Math.max(0, width - 2 - visibleWidth(left) - visibleWidth(label) - 1);
			const bottom = accent(`\u2570${left}${"\u2500".repeat(fill)}`) + theme.fg("accent", theme.bold(label)) + accent("\u2500\u256f");
			const top = accent(`\u256d${"\u2500".repeat(width - 2)}\u256e`);
			return [top, ...body, truncateToWidth(bottom, width, "")];
		},
		invalidate() {
			editor.invalidate();
		},
		handleInput(data: string) {
			if (matchesKey(data, Key.ctrl("u")) || matchesKey(data, Key.ctrl("d"))) {
				// Before the editor: pi-tui reads Ctrl+U as delete-to-line-start, pi Ctrl+D as exit.
				jumpHalfPage(editor, matchesKey(data, Key.ctrl("u")) ? -1 : 1, editorRows(tui), vim);
			} else if (!vim && matchesKey(data, Key.escape)) {
				// pi-tui's plain Editor ignores Esc, so the box cancels for it.
				cancel();
			} else {
				editor.handleInput(data);
			}
			tui.requestRender();
		},
	};
}

/** The box's place: centred, 80% of the terminal's width up to 100 columns, re-read on every render. */
function commentBoxOptions(tui: TUI): OverlayOptions {
	return {
		anchor: "center",
		get width() {
			return Math.min(100, Math.max(40, Math.floor(tui.terminal.columns * 0.8)));
		},
	};
}

// ── Yanking code blocks ──────────────────────────────────────────────
//
// Rendered rows do not map to source lines (wrapping, fence rows, list markers),
// so the code blocks are found from both ends and paired in document order: the
// marked lexer pi-tui's Markdown is built on yields the code tokens, depth first,
// and the render shows each of them, in the same order, between a ```lang border
// row and a ``` border row at the same column (code rows sit one indent further
// in). Pairing by order, not by matching code text, stays correct when blocks
// share identical lines, and the border rows bound a block however its long
// lines wrap.

/** A code block: its rendered border rows, its source text and, per code row, the source line shown there. */
interface CodeBlock {
	open: number;
	close: number;
	text: string;
	/** Source line of each row between the borders; empty when the wrapping could not be replayed. */
	rowLines: (string | undefined)[];
}

const lexer = new Marked();

/** Code tokens in document order, including those inside lists and blockquotes. */
function codeTokens(tokens: Token[], out: Tokens.Code[] = []): Tokens.Code[] {
	for (const token of tokens) {
		if (token.type === "code") out.push(token as Tokens.Code);
		else {
			const children = (token as { tokens?: Token[]; items?: Token[] }).tokens ?? (token as { items?: Token[] }).items;
			if (Array.isArray(children)) codeTokens(children, out);
		}
	}
	return out;
}

/**
 * Locate every code block of `content` in `rows`, the output of
 * `new Markdown(content, paddingX, ...).render(renderWidth)`.
 */
function mapCodeBlocks(
	rows: string[],
	content: string,
	renderWidth: number,
	paddingX: number,
	mdTheme: MarkdownTheme,
): CodeBlock[] {
	// Markdown renders tabs as three spaces; the copy keeps the source's tabs when both parses agree.
	const shown = codeTokens(lexer.lexer(content.replace(/\t/g, "   ")));
	const source = codeTokens(lexer.lexer(content));
	const exact = source.length === shown.length;
	const plain = rows.map((row) => stripAnsi(row).trimEnd());
	const indent = mdTheme.codeBlockIndent ?? "  ";
	const blocks: CodeBlock[] = [];
	let from = 0;
	shown.forEach((token, i) => {
		const fence = `\`\`\`${token.lang || ""}`;
		let open = -1;
		let column = 0;
		for (let r = from; r < plain.length && open < 0; r++) {
			const line = plain[r]!;
			const prefix = line.slice(0, line.length - fence.length);
			// Before the border: margin, list markers or a quote bar, never text or backticks.
			if (line.endsWith(fence) && !/[`\p{L}]/u.test(prefix.replace(/\[[ x]\]/g, ""))) {
				open = r;
				column = prefix.length;
			}
		}
		if (open < 0) return;
		let close = -1;
		for (let r = open + 1; r < plain.length && close < 0; r++) {
			if (plain[r]!.length === column + 3 && plain[r]!.endsWith("```")) close = r;
		}
		if (close < 0) return;
		from = close + 1;

		const shownLines = token.text.split("\n");
		const text = exact ? source[i]!.text : token.text;
		const sourceLines = text.split("\n");
		const rowCount = close - open - 1;
		const rowLines: (string | undefined)[] = [];
		if (sourceLines.length === shownLines.length) {
			// Replay the wrapping at the block's width: the render width less the margins and what precedes the border.
			const width = Math.max(1, renderWidth - 2 * paddingX - (column - paddingX));
			const spans =
				rowCount === shownLines.length
					? shownLines.map(() => 1)
					: shownLines.map((line) => wrapTextWithAnsi(indent + line, width).length);
			if (spans.reduce((a, b) => a + b, 0) === rowCount) {
				spans.forEach((span, k) => {
					for (let s = 0; s < span; s++) rowLines.push(sourceLines[k]);
				});
			}
		}
		blocks.push({ open, close, text, rowLines });
	});
	return blocks;
}

/** The text of the first inline code span on a rendered row, found by the escape codes of the theme's code style. */
function inlineCode(row: string, mdTheme: MarkdownTheme): string | undefined {
	const [start, end] = mdTheme.code("\0").split("\0");
	if (!start) return undefined;
	const at = row.indexOf(start);
	if (at < 0) return undefined;
	const from = at + start.length;
	const to = end ? row.indexOf(end, from) : -1;
	const text = stripAnsi(row.slice(from, to < 0 ? undefined : to));
	return text.trim() ? text : undefined;
}

// ── TUI markdown overlay ─────────────────────────────────────────────

export async function showMarkdownReview(
	content: string,
	title: string,
	ctx: ExtensionContext,
): Promise<ReviewComment[] | undefined> {
	if (!content.trim()) {
		ctx.ui.notify("Nothing to review: document is empty.", "info");
		return undefined;
	}

	const ModalEditor = await loadModalEditor();
	notifyInputNeeded("plan-review");
	return await ctx.ui.custom<ReviewComment[] | undefined>(
		(tui, theme, keybindings, done) => {
			const mdTheme = getMarkdownTheme();
			const md = new Markdown(content, 2, 0, mdTheme);
			const editorTheme: EditorTheme = { borderColor: (s) => theme.fg("accent", s), selectList: getSelectListTheme() };
			let scrollOffset = 0;
			let cursorLine = 0;
			let allLines: string[] | undefined;
			let lastWidth = 0;
			/** Document rows shown at the last render; Ctrl+U/D move half of it. */
			let lastVisibleLines = 10;
			let focused = false;
			const comments: ReviewComment[] = [];
			let codeBlocks: CodeBlock[] = [];
			/** Keys of an unfinished yank (`y`, `yi`), shown under the document like vim's showcmd. */
			let pendingYank = "";
			/** A yank's confirmation, shown under the document until the next key. */
			let flash: string | undefined;
			/** Bumped on every key, so a copy that finishes after the next key does not flash. */
			let keyCount = 0;

			const copy = (text: string, confirmation: string) => {
				const key = keyCount;
				copyToClipboard(text).then(
					() => {
						if (key === keyCount) flash = theme.fg("success", ` \u2713 ${confirmation}`);
						tui.requestRender();
					},
					(error: unknown) => {
						if (key === keyCount) flash = theme.fg("error", ` Copy failed: ${error instanceof Error ? error.message : String(error)}`);
						tui.requestRender();
					},
				);
			};
			const lineCount = (text: string) => {
				const n = text ? text.split("\n").length : 0;
				return `${n} line${n === 1 ? "" : "s"}`;
			};
			const blockAt = (row: number) => codeBlocks.find((b) => row >= b.open && row <= b.close);
			const notice = (message: string) => {
				flash = theme.fg("warning", ` ${message}`);
			};

			/** yi`: the code block holding the cursor, else the first inline code span on the cursor row. */
			const yankBlock = () => {
				const block = blockAt(cursorLine);
				if (block) return copy(block.text, `Copied ${lineCount(block.text)}`);
				const span = inlineCode(allLines?.[cursorLine] ?? "", mdTheme);
				if (span) return copy(span, `Copied \`${truncateToWidth(span, 40)}\``);
				notice("No code block here");
			};

			/** yy: in a code block the whole source line shown on the row, elsewhere the row's text. */
			const yankLine = () => {
				const block = blockAt(cursorLine);
				const inCode = block && cursorLine > block.open && cursorLine < block.close;
				const text = inCode
					? (block.rowLines[cursorLine - block.open - 1] ?? stripAnsi(allLines?.[cursorLine] ?? "").trim())
					: stripAnsi(allLines?.[cursorLine] ?? "").trim();
				if (!text.trim()) return notice("Blank line, nothing copied");
				copy(text, `Copied "${truncateToWidth(text.trim(), 40)}"`);
			};

			/** The open comment box: which comment it edits (none for a new one), where it points, its overlay. */
			let editing:
				| { existing: ReviewComment | undefined; general: boolean; row: number; box: OverlayHandle }
				| undefined;

			const lineComment = (row: number) => comments.find((c) => !c.general && c.lineIndex === row);
			const generalComment = () => comments.find((c) => c.general);

			const closeEditor = () => {
				// Hiding the box hands the focus back to the review.
				editing?.box.hide();
				editing = undefined;
				tui.requestRender();
			};

			const save = (text: string) => {
				const open = editing;
				if (!open) return;
				const value = text.trim();
				if (open.existing) {
					if (value) open.existing.comment = value;
					else comments.splice(comments.indexOf(open.existing), 1);
				} else if (value && open.general) {
					comments.push({ lineIndex: 0, lineText: "", comment: value, general: true });
				} else if (value && allLines) {
					const lineText = stripAnsi(allLines[open.row] ?? "").trim();
					comments.push({ lineIndex: open.row, lineText, comment: value });
				}
				closeEditor();
			};

			const openEditor = (general: boolean) => {
				const existing = general ? generalComment() : lineComment(cursorLine);
				const editor = newCommentEditor(ModalEditor, tui, editorTheme, keybindings, closeEditor, (message) =>
					ctx.ui.notify(message, "warning"),
				);
				editor.onSubmit = save;
				if (existing) {
					editor.setText(existing.comment);
					// An existing comment opens in normal mode, a new one in insert mode.
					if (ModalEditor) editor.handleInput("\x1b");
				}
				const text = general ? "" : stripAnsi(allLines?.[cursorLine] ?? "").trim();
				const label = (s: string) => theme.fg("accent", theme.bold(s));
				const heading = general
					? label("General comment")
					: text
						? label("Comment on ") + theme.fg("dim", `"${truncateToWidth(text, 40)}"`)
						: label("Comment on a blank line");
				// The full line goes under the heading only when the heading cut it.
				const excerpt = visibleWidth(text) > 40 ? text : "";
				const box = commentBox(tui, theme, editor, !!ModalEditor, heading, excerpt, closeEditor);
				editing = { existing, general, row: cursorLine, box: tui.showOverlay(box, commentBoxOptions(tui)) };
			};

			/** First line of a comment, for the one-line preview under the document. */
			const preview = (c: ReviewComment) => c.comment.split("\n")[0] + (c.comment.includes("\n") ? " \u2026" : "");

			return {
				get focused() {
					return focused;
				},
				set focused(value: boolean) {
					focused = value;
				},
				render(width: number): string[] {
					const termHeight = process.stdout.rows || 40;
					if (!allLines || width !== lastWidth) {
						allLines = md.render(width - 4);
						codeBlocks = mapCodeBlocks(allLines, content, width - 4, 2, mdTheme);
						lastWidth = width;
						if (cursorLine >= allLines.length) cursorLine = Math.max(0, allLines.length - 1);
					}

					const commentCount =
						comments.length > 0
							? theme.fg("accent", ` [${comments.length} comment${comments.length > 1 ? "s" : ""}]`)
							: "";

					// bar, title, blank, document, preview, footer, bar
					const visibleLines = Math.max(5, termHeight - 8);
					lastVisibleLines = visibleLines;
					const maxScroll = Math.max(0, allLines.length - visibleLines);
					if (cursorLine < scrollOffset) scrollOffset = cursorLine;
					if (cursorLine >= scrollOffset + visibleLines) scrollOffset = cursorLine - visibleLines + 1;
					scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

					const scrollPart =
						maxScroll > 0
							? `${scrollOffset + 1}-${Math.min(scrollOffset + visibleLines, allLines.length)}/${allLines.length}`
							: "";
					const footer = theme.fg(
						"dim",
						` ${scrollPart}  j/k/^u/^d move  c comment  g general  d delete  n/N jump  yi\` copy block  s send${commentCount}  q close`,
					);

					const visible = allLines.slice(scrollOffset, scrollOffset + visibleLines);
					const styledVisible = visible.map((line, i) => {
						const globalIdx = scrollOffset + i;
						const isCursor = globalIdx === cursorLine;
						const marker = lineComment(globalIdx) ? theme.fg("accent", "\u2022 ") : "  ";
						let styledLine = marker + line;
						if (isCursor) {
							const vw = visibleWidth(styledLine);
							const padded = styledLine + " ".repeat(Math.max(0, width - vw));
							styledLine = theme.bg("selectedBg", padded);
						}
						return truncateToWidth(styledLine, width);
					});

					const here = editing ? undefined : lineComment(cursorLine);
					const general = editing ? undefined : generalComment();
					const previewLine = flash
						? flash
						: pendingYank
							? theme.fg("dim", ` ${pendingYank}`)
							: here
								? theme.fg("accent", ` \u00bb ${preview(here)}`)
								: general
									? theme.fg("dim", ` General: ${preview(general)}`)
									: "";

					const bar = theme.fg("accent", "\u2500".repeat(width));
					const titleLine = theme.fg("accent", theme.bold(` ${title}`));
					const boxLines = [bar, titleLine, "", ...styledVisible, previewLine, footer, bar];
					const topPad = Math.max(0, Math.floor((termHeight - boxLines.length) / 2));
					const blankLine = " ".repeat(width);
					const output: string[] = [];
					for (let i = 0; i < topPad; i++) output.push(blankLine);
					for (const line of boxLines) output.push(visibleWidth(line) > width ? truncateToWidth(line, width) : line);
					while (output.length < termHeight) output.push(blankLine);
					return output;
				},
				invalidate() {
					allLines = undefined;
					md.invalidate();
				},
				handleInput(data: string) {
					// The comment box holds the focus while open; a stray key here must not act on the review.
					if (editing || !allLines) return;
					keyCount++;
					flash = undefined;

					if (pendingYank) {
						const keys = pendingYank + data;
						pendingYank = "";
						if (keys === "yi") pendingYank = "yi";
						else if (keys === "yi`") yankBlock();
						else if (keys === "yy") yankLine();
						// Esc only cancels the yank; any other key cancels it and then acts as usual.
						if (pendingYank || keys === "yi`" || keys === "yy" || matchesKey(data, Key.escape)) {
							tui.requestRender();
							return;
						}
					}

					if (data === "y") {
						pendingYank = "y";
					} else if (matchesKey(data, Key.up) || data === "k") {
						if (cursorLine > 0) cursorLine--;
					} else if (matchesKey(data, Key.down) || data === "j") {
						if (cursorLine < allLines.length - 1) cursorLine++;
					} else if (matchesKey(data, Key.ctrl("d")) || matchesKey(data, Key.ctrl("u"))) {
						// Vim half page: the cursor and the view move together, clamped at the ends.
						const step = Math.max(1, Math.floor(lastVisibleLines / 2)) * (matchesKey(data, Key.ctrl("u")) ? -1 : 1);
						cursorLine = Math.max(0, Math.min(allLines.length - 1, cursorLine + step));
						scrollOffset = Math.max(0, scrollOffset + step);
					} else if (data === "n" || data === "N") {
						const rows = comments.filter((c) => !c.general).map((c) => c.lineIndex);
						const next =
							data === "n"
								? Math.min(...rows.filter((r) => r > cursorLine))
								: Math.max(...rows.filter((r) => r < cursorLine));
						if (Number.isFinite(next)) cursorLine = next;
					} else if (data === "c" || data === "g") {
						openEditor(data === "g");
					} else if (data === "d") {
						const here = lineComment(cursorLine);
						if (here) comments.splice(comments.indexOf(here), 1);
					} else if (data === "s") {
						if (comments.length > 0) done(comments);
					} else if (data === "q") {
						done(undefined);
					} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
						// A spare Esc or Enter after leaving the comment input must not discard the comments.
						if (comments.length === 0) done(undefined);
					}
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: { width: "100%", anchor: "top-left" as any, margin: 0 },
		},
	);
}
