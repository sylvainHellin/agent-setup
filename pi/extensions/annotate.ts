/**
 * Annotate extension.
 *
 * `/annotate` opens the latest assistant answers (or a file) in the review
 * overlay of plan/review.ts, over pi itself. Inline comments come back as a
 * normal user message with each quoted line, so the read-scroll-copy-paste
 * loop disappears.
 *
 * When a subagent result or a compaction wakes the agent after it already
 * answered, one prompt of yours gets several answers. Bare `/annotate` shows
 * all of them in one document, each under a numbered header, so they can be
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
 * In the overlay: c comments the cursor line (or edits its comment), g the
 * whole document, d deletes, s sends. Comments are typed in a floating box
 * with a vim input: Enter saves, Esc goes to normal mode, Esc in normal mode
 * cancels, Ctrl+U and Ctrl+D move the cursor half the input's height.
 * yi` copies the code block under the cursor (its source text, no fences) and
 * yy the cursor line to the clipboard.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { formatReviewComments } from "./plan/helpers.js";
import { showMarkdownReview } from "./plan/review.js";
import { type Answer, collectAnswers } from "./shared/session-answers.js";
import { resolveToolPath } from "./shared/tool-path.js";

// ── Building the document ───────────────────────────────────────────

interface Section {
	/** Steps back from the latest answer: 0 is the latest. */
	back: number;
}

interface Doc {
	content: string;
	sections: Section[];
}

/** One answer alone: the document is the answer verbatim. */
function singleDoc(answer: Answer, back: number): Doc {
	return { content: `${answer.text.trimEnd()}\n`, sections: [{ back }] };
}

/** Several answers, oldest first, each under a header naming its number and trigger. */
function groupDoc(group: Answer[]): Doc {
	const lines: string[] = [];
	const sections: Section[] = [];
	group.forEach((answer, i) => {
		const back = group.length - 1 - i;
		if (i > 0) lines.push("");
		lines.push(`# ─── Answer ${back} · after ${answer.trigger} ───`, "");
		sections.push({ back });
		lines.push(...answer.text.trimEnd().split("\n"));
	});
	return { content: `${lines.join("\n")}\n`, sections };
}

export default function annotateExtension(pi: ExtensionAPI): void {
	pi.registerCommand("annotate", {
		description: "Annotate the latest answers (or one answer, or a file) and send the comments back",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const arg = (args ?? "").trim();

			let filePath = "";
			let content: string;
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
				content = await fs.readFile(filePath, "utf-8");
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
				content = doc.content;
				title = doc.sections.length > 1 ? `Annotate: last ${doc.sections.length} answers` : `Annotate: answer ${doc.sections[0].back}`;
			}

			const comments = (ctx.hasUI ? await showMarkdownReview(content, title, ctx) : undefined) ?? [];

			if (comments.length === 0) {
				ctx.ui.notify("No comments. Nothing sent.", "info");
				return;
			}

			const multi = doc !== undefined && doc.sections.length > 1;
			const have = comments.length === 1 ? "I have a comment" : "I have a few comments";
			const preamble = !doc
				? `Thank you, ${have} on ${path.relative(ctx.cwd, filePath) || filePath}`
				: multi
					? `Thank you, ${have} on your last ${doc.sections.length} answers`
					: `Thank you, ${have} on this`;
			pi.sendUserMessage(formatReviewComments(comments, preamble));
		},
	});
}
