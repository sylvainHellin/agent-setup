/**
 * Annotate extension.
 *
 * `/annotate` drops the latest assistant answers into a scratch markdown file
 * and opens it in a review surface: nvim in a tmux or herdr split with the
 * annotations plugin from `plan/nvim/`, else a TUI overlay. Set
 * PI_ANNOTATE_OVERLAY=1 to always use the overlay. Inline
 * comments come back as a normal user message with each quoted source line, so
 * the read-scroll-copy-paste loop disappears.
 *
 * When a subagent result or a compaction wakes the agent after it already
 * answered, one prompt of yours gets several answers. Bare `/annotate` shows
 * all of them in one file, each under a numbered header, so they can be
 * commented together and sent back in a single message.
 *
 * Usage:
 *   /annotate        - every answer since your last message, oldest first
 *   /annotate 0      - only the latest answer
 *   /annotate N      - only the answer N steps back (the number in its header)
 *   /annotate <path> - annotate an arbitrary file
 *
 * Only turn-ending answers count; mid-turn narration is skipped (see
 * shared/session-answers.ts).
 *
 * In nvim: <leader>ca to comment a line (or a visual range), <leader>cg for a
 * general comment on the whole file, then `:wq`. In the overlay: c and g.
 * Nothing needs exporting; the comments are read straight from
 * `<scratchdir>/.nvim/annotations.json` and cleared afterwards.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatReviewComments } from "./plan/helpers.js";
import { reviewWithHerdr, reviewWithNeovim, showMarkdownReview } from "./plan/review.js";
import type { ReviewComment } from "./plan/types.js";
import { type Answer, collectAnswers } from "./shared/session-answers.js";
import { resolveToolPath } from "./shared/tool-path.js";

// ── Building the scratch document ───────────────────────────────────

interface Section {
	/** Steps back from the latest answer: 0 is the latest. */
	back: number;
	/** 1-based line of the first body line in the scratch file. */
	bodyStart: number;
}

interface Doc {
	content: string;
	sections: Section[];
	label: string;
}

/** One answer alone: the file is the answer verbatim, as before. */
function singleDoc(answer: Answer, back: number): Doc {
	return { content: `${answer.text.trimEnd()}\n`, sections: [{ back, bodyStart: 1 }], label: `answer-${back}` };
}

/** Several answers, oldest first, each under a header naming its number and trigger. */
function groupDoc(group: Answer[]): Doc {
	const lines: string[] = [];
	const sections: Section[] = [];
	group.forEach((answer, i) => {
		const back = group.length - 1 - i;
		if (i > 0) lines.push("");
		lines.push(`# ─── Answer ${back} · after ${answer.trigger} ───`, "");
		sections.push({ back, bodyStart: lines.length + 1 });
		lines.push(...answer.text.trimEnd().split("\n"));
	});
	return { content: `${lines.join("\n")}\n`, sections, label: "answers" };
}

/** "answer 1, L5" for a source line inside a multi-answer file. */
function locator(doc: Doc): (c: ReviewComment) => string {
	return (c) => {
		const section = [...doc.sections].reverse().find((s) => c.lineIndex >= s.bodyStart - 2);
		if (!section) return `L${c.lineIndex}`;
		const local = c.lineIndex - section.bodyStart + 1;
		return local >= 1 ? `answer ${section.back}, L${local}` : `answer ${section.back}`;
	};
}

// ── Scratch file ────────────────────────────────────────────────────
//
// The nvim annotations plugin keys its store by path relative to nvim's cwd,
// and the plan reviewer launches nvim with cwd set to the file's own directory.
// A per-session scratch dir therefore keeps `.nvim/annotations.json` out of the
// project tree entirely.

async function scratchPath(ctx: ExtensionContext, label: string): Promise<string> {
	const sessionId = ctx.sessionManager.getSessionId?.() ?? String(process.pid);
	const dir = path.join(tmpdir(), "pi-annotate", sessionId);
	await fs.mkdir(dir, { recursive: true });
	return path.join(dir, `${label}.md`);
}

// ── Review surface dispatch ─────────────────────────────────────────

/** Comments, plus whether their line numbers are source lines (nvim) or rendered rows (overlay). */
async function review(
	filePath: string,
	title: string,
	ctx: ExtensionContext,
): Promise<{ comments: ReviewComment[]; sourceLines: boolean }> {
	const overlayOnly = process.env.PI_ANNOTATE_OVERLAY === "1";
	if (process.env.TMUX && !overlayOnly) return { comments: await reviewWithNeovim(filePath, ctx.cwd), sourceLines: true };
	if (process.env.HERDR_ENV === "1" && !overlayOnly) return { comments: await reviewWithHerdr(filePath, ctx.cwd), sourceLines: true };
	if (ctx.hasUI) {
		const content = await fs.readFile(filePath, "utf-8");
		return { comments: (await showMarkdownReview(content, title, ctx)) ?? [], sourceLines: false };
	}
	return { comments: [], sourceLines: false };
}

export default function annotateExtension(pi: ExtensionAPI): void {
	pi.registerCommand("annotate", {
		description: "Annotate the latest answers (or one answer, or a file) in nvim and send the comments back",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const arg = (args ?? "").trim();

			let filePath: string;
			let title: string;
			let doc: Doc | undefined;

			// Anything but a bare number is a path (~, @ and file:// resolved like pi's tools).
			const asFile = arg && !/^\d+$/.test(arg) ? resolveToolPath(arg, ctx.cwd) : "";
			if (asFile) {
				if (!existsSync(asFile)) {
					ctx.ui.notify(`No such file: ${arg}`, "error");
					return;
				}
				filePath = asFile;
				title = `Annotate: ${path.basename(filePath)}`;
			} else {
				const answers = collectAnswers(ctx.sessionManager.getBranch() as any[]);
				const latest = answers.at(-1);
				if (!latest) {
					ctx.ui.notify("Nothing to annotate: no assistant answer in this branch.", "warning");
					return;
				}
				if (/^\d+$/.test(arg)) {
					const back = Number.parseInt(arg, 10);
					const answer = answers[answers.length - 1 - back];
					if (!answer) {
						ctx.ui.notify(`Only ${answers.length} answer(s) in this branch (0 to ${answers.length - 1}).`, "warning");
						return;
					}
					doc = singleDoc(answer, back);
				} else {
					const group = answers.filter((a) => a.userTurn === latest.userTurn);
					doc = group.length > 1 ? groupDoc(group) : singleDoc(latest, 0);
				}
				filePath = await scratchPath(ctx, doc.label);
				await fs.writeFile(filePath, doc.content, "utf-8");
				title = doc.sections.length > 1 ? `Annotate: last ${doc.sections.length} answers` : `Annotate: answer ${doc.sections[0].back}`;
			}

			const { comments, sourceLines } = await review(filePath, title, ctx);

			if (comments.length === 0) {
				ctx.ui.notify("No comments. Nothing sent.", "info");
				if (doc) await fs.rm(filePath, { force: true });
				return;
			}

			const multi = doc !== undefined && doc.sections.length > 1;
			const have = comments.length === 1 ? "I have a comment" : "I have a few comments";
			const preamble = !doc
				? `Thank you, ${have} on ${path.relative(ctx.cwd, filePath) || filePath}`
				: multi
					? `Thank you, ${have} on your last ${doc.sections.length} answers`
					: `Thank you, ${have} on this`;
			pi.sendUserMessage(formatReviewComments(comments, preamble, doc && multi && sourceLines ? locator(doc) : undefined));

			if (doc) await fs.rm(filePath, { force: true });
		},
	});
}
