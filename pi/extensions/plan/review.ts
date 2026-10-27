import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Input, Key, Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { notifyInputNeeded } from "../shared/notify.js";
import { stripAnsi } from "./helpers.js";
import type { ReviewComment } from "./types.js";

// ── Neovim annotations integration ──────────────────────────────────
//
// The nvim annotations plugin stores comments in `<getcwd>/.nvim/annotations.json`,
// keyed by each file's path relative to getcwd (or absolute when outside it). To
// avoid that relative/absolute/symlink ambiguity entirely, we always launch nvim
// with its cwd set to the plan file's own directory (see launchCwd usage below).
// The plugin then writes `<plandir>/.nvim/annotations.json` keyed by the bare
// basename, and we read it back from exactly there. Bonus: plan-review comments
// no longer mix into the project-root `.nvim/annotations.json` used for code review.

function readAnnotationsForFile(planPath: string): ReviewComment[] {
	const dir = path.dirname(path.resolve(planPath));
	const base = path.basename(planPath);
	const annotPath = path.join(dir, ".nvim", "annotations.json");
	try {
		const raw = readFileSync(annotPath, "utf-8");
		const data = JSON.parse(raw);
		const anns: Array<{ line: number; content: string; comment: string }> = data?.annotations?.[base] ?? [];
		return anns.map((a) => ({
			lineIndex: a.line,
			lineText: a.content?.trim() ?? "",
			comment: a.comment ?? "",
			// <leader>cg stores the file's general comment on line 0.
			general: a.line === 0,
		}));
	} catch {
		return [];
	}
}

function clearAnnotationsForFile(planPath: string): void {
	const dir = path.dirname(path.resolve(planPath));
	const base = path.basename(planPath);
	const annotPath = path.join(dir, ".nvim", "annotations.json");
	try {
		const raw = readFileSync(annotPath, "utf-8");
		const data = JSON.parse(raw);
		if (data?.annotations?.[base]) {
			delete data.annotations[base];
			writeFileSync(annotPath, JSON.stringify(data), "utf-8");
		}
	} catch {
		// ignore
	}
}

// ── Neovim via tmux split pane ───────────────────────────────────────
//
// We deliberately avoid `tmux display-popup` here: tmux popups are scoped to
// the *client*, not the window, so they float above whichever window the
// client is currently viewing. That means switching to an unrelated tmux
// window while the agent submits a plan causes the popup to barge in and
// overlay that other work (tmux/tmux#3158, no native window-scoping).
//
// Instead, we open nvim in a split pane beside the agent's pane (mirroring the
// herdr flow). The split exists only for the duration of the review and closes
// when nvim exits. We block on a `wait-for` channel that the wrapper signals
// when nvim exits, preserving the previous synchronous flow.

function shellQuoteSingle(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function reviewWithNeovim(planPath: string, _cwd: string): Promise<ReviewComment[]> {
	// Launch nvim in the plan file's own directory so the annotations plugin keys
	// the comment by bare basename in `<plandir>/.nvim/annotations.json`.
	const launchCwd = path.dirname(path.resolve(planPath));
	const channel = `plan_review_${process.pid}_${Date.now()}`;
	// tmux runs this through the shell in the new pane, so the path is quoted;
	// the tmux invocations themselves use execFileSync, with no local shell.
	const nvimCmd = `nvim ${shellQuoteSingle(planPath)}; tmux wait-for -S ${channel}`;
	try {
		// Split the current window horizontally and open nvim in the new pane,
		// switching focus to it. When nvim exits the `;`-chained wait-for fires
		// and the pane closes on its own (the wrapper command returns).
		const newPane = execFileSync(
			"tmux",
			["split-window", "-h", "-P", "-F", "#{pane_id}", "-c", launchCwd, nvimCmd],
			{ encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"], cwd: launchCwd },
		).trim();
		// Zoom the nvim pane so the review gets the full window width; the zoom
		// dies with the pane when nvim exits.
		if (newPane) {
			try {
				execFileSync("tmux", ["resize-pane", "-Z", "-t", newPane], { stdio: "inherit", cwd: launchCwd });
			} catch {
				// zoom is cosmetic: ignore
			}
		}
		// Block until the wrapper above signals the channel (nvim exited cleanly
		// or with any non-zero status: both reach the `;`-chained wait-for).
		// Edge case: if the user kills the window via `tmux kill-window` instead
		// of quitting nvim, the wrapper never runs and this would hang. Live with it.
		execFileSync("tmux", ["wait-for", channel], { stdio: "inherit", cwd: launchCwd });
	} catch {
		// User quit / split-window failed: fine
	}
	const comments = readAnnotationsForFile(planPath);
	if (comments.length > 0) {
		clearAnnotationsForFile(planPath);
	}
	return comments;
}

// ── Neovim via herdr split pane ──────────────────────────────────────
//
// herdr (HERDR_ENV=1) is a tmux alternative with no `new-window`/`wait-for`.
// We replicate the tmux flow with its CLI: split the current pane to the
// right with --cwd set to the plan file's own directory (so the annotations
// plugin keys the comment by bare basename there), open nvim, and block until
// nvim writes a sentinel file. We poll the sentinel rather than `herdr wait
// output` because that matches the command-echo line, not nvim's exit.
//
// $HERDR_PANE_ID is the env id of the agent's own pane; `pane split` accepts
// it directly and returns the new pane id at result.pane.pane_id.

function herdr(args: string[]): string {
	return execFileSync("herdr", args, { encoding: "utf-8" });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reviewWithHerdr(planPath: string, _cwd: string): Promise<ReviewComment[]> {
	const parentPane = process.env.HERDR_PANE_ID;
	if (!parentPane) return [];

	// Launch nvim in the plan file's own directory (see readAnnotationsForFile).
	const launchCwd = path.dirname(path.resolve(planPath));
	const tmp = mkdtempSync(path.join(tmpdir(), "plan-review-"));
	const sentinel = path.join(tmp, "done");
	let newPane: string | undefined;
	try {
		const splitOut = herdr(["pane", "split", parentPane, "--direction", "right", "--cwd", launchCwd, "--focus"]);
		newPane = JSON.parse(splitOut)?.result?.pane?.pane_id;
		if (!newPane) return [];

		// Open nvim; on exit (any status) write the sentinel so we unblock.
		const nvimCmd = `nvim ${shellQuoteSingle(planPath)}; : > ${shellQuoteSingle(sentinel)}`;
		herdr(["pane", "run", newPane, nvimCmd]);

		// Zoom the nvim pane to the full tab; unzoomed again in the finally block.
		try {
			herdr(["pane", "zoom", newPane, "--on"]);
		} catch {
			// zoom is cosmetic: ignore
		}

		// Poll the sentinel. Also poll that the pane still exists, so a manually
		// closed split (no nvim exit) does not hang us forever.
		while (!existsSync(sentinel)) {
			await sleep(300);
			try {
				const info = JSON.parse(herdr(["pane", "get", newPane]));
				if (info?.result?.type === "error") break;
			} catch {
				break; // pane gone
			}
		}
	} catch {
		// split / run failed: fall through to whatever annotations exist (none)
	} finally {
		if (newPane) {
			try {
				herdr(["pane", "zoom", newPane, "--off"]);
			} catch {
				// already gone
			}
			try {
				herdr(["pane", "close", newPane]);
			} catch {
				// already closed
			}
		}
		rmSync(tmp, { recursive: true, force: true });
	}

	const comments = readAnnotationsForFile(planPath);
	if (comments.length > 0) {
		clearAnnotationsForFile(planPath);
	}
	return comments;
}

// ── TUI markdown overlay (non-tmux fallback) ─────────────────────────

export async function showMarkdownReview(
	content: string,
	title: string,
	ctx: ExtensionContext,
): Promise<ReviewComment[] | undefined> {
	if (!content.trim()) {
		ctx.ui.notify("Nothing to review: document is empty.", "info");
		return undefined;
	}

	notifyInputNeeded("plan-review");
	return await ctx.ui.custom<ReviewComment[] | undefined>(
		(tui, theme, _kb, done) => {
			const mdTheme = getMarkdownTheme();
			const md = new Markdown(content, 2, 0, mdTheme);
			let scrollOffset = 0;
			let cursorLine = 0;
			let allLines: string[] | undefined;
			let lastWidth = 0;
			let inputMode = false;
			/** The open input targets the whole document (g) instead of the cursor line (c). */
			let generalInput = false;
			const comments: ReviewComment[] = [];
			const commentedLines = new Set<number>();

			const input = new Input();
			input.onSubmit = (value: string) => {
				if (value.trim() && generalInput) {
					comments.push({ lineIndex: 0, lineText: "", comment: value.trim(), general: true });
				} else if (value.trim() && allLines) {
					const lineText = stripAnsi(allLines[cursorLine] ?? "").trim();
					comments.push({ lineIndex: cursorLine, lineText, comment: value.trim() });
					commentedLines.add(cursorLine);
				}
				inputMode = false;
				input.setValue("");
			};
			input.onEscape = () => {
				inputMode = false;
				input.setValue("");
			};

			return {
				render(width: number): string[] {
					const termHeight = process.stdout.rows || 40;
					const visibleLines = Math.max(5, termHeight - 8);
					if (!allLines || width !== lastWidth) {
						allLines = md.render(width - 4);
						lastWidth = width;
						if (cursorLine >= allLines.length) cursorLine = Math.max(0, allLines.length - 1);
						if (scrollOffset > Math.max(0, allLines.length - visibleLines)) {
							scrollOffset = Math.max(0, allLines.length - visibleLines);
						}
					}
					const maxScroll = Math.max(0, allLines.length - visibleLines);
					if (cursorLine < scrollOffset) scrollOffset = cursorLine;
					if (cursorLine >= scrollOffset + visibleLines) scrollOffset = cursorLine - visibleLines + 1;
					scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

					const visible = allLines.slice(scrollOffset, scrollOffset + visibleLines);
					const styledVisible = visible.map((line, i) => {
						const globalIdx = scrollOffset + i;
						const isCursor = globalIdx === cursorLine;
						const hasComment = commentedLines.has(globalIdx);
						const marker = hasComment ? theme.fg("accent", "\u2022 ") : "  ";
						let styledLine = marker + line;
						if (isCursor) {
							const vw = visibleWidth(styledLine);
							const padded = styledLine + " ".repeat(Math.max(0, width - vw));
							styledLine = theme.bg("selectedBg", padded);
						}
						return truncateToWidth(styledLine, width);
					});

					const bar = theme.fg("accent", "\u2500".repeat(width));
					const titleLine = theme.fg("accent", theme.bold(` ${title}`));
					const commentCount =
						comments.length > 0
							? theme.fg("accent", ` [${comments.length} comment${comments.length > 1 ? "s" : ""}]`)
							: "";
					let statusLine: string;
					if (inputMode) {
						const inputLines = input.render(width - (generalInput ? 20 : 12));
						const label = generalInput ? " General comment: " : " Comment: ";
						statusLine = theme.fg("accent", label) + (inputLines[0] ?? "");
					} else {
						const scrollPart =
							maxScroll > 0
								? `${scrollOffset + 1}-${Math.min(scrollOffset + visibleLines, allLines.length)}/${allLines.length}`
								: "";
						statusLine = theme.fg("dim", ` ${scrollPart}  j/k move  c comment  g general  s send${commentCount}  q close`);
					}

					const boxLines = [bar, titleLine, "", ...styledVisible, "", statusLine, bar];
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
					if (inputMode) {
						input.handleInput(data);
						tui.requestRender();
						return;
					}
					if (!allLines) return;
					const termHeight = process.stdout.rows || 40;
					const visibleLines = Math.max(5, termHeight - 8);
					const maxScroll = Math.max(0, allLines.length - visibleLines);

					if (matchesKey(data, Key.up) || data === "k") {
						if (cursorLine > 0) cursorLine--;
						if (cursorLine < scrollOffset) scrollOffset = cursorLine;
					} else if (matchesKey(data, Key.down) || data === "j") {
						if (cursorLine < allLines.length - 1) cursorLine++;
						if (cursorLine >= scrollOffset + visibleLines) scrollOffset = cursorLine - visibleLines + 1;
						scrollOffset = Math.min(scrollOffset, maxScroll);
					} else if (data === "c" || data === "g") {
						inputMode = true;
						generalInput = data === "g";
						input.setValue("");
					} else if (data === "s") {
						if (comments.length > 0) done(comments);
					} else if (matchesKey(data, Key.escape) || data === "q") {
						done(undefined);
					} else if (matchesKey(data, Key.enter)) {
						done(undefined);
					}
				},
			};
		},
		{
			overlay: true,
			overlayOptions: { width: "100%", anchor: "top-left" as any, margin: 0 },
		},
	);
}
