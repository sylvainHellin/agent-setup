import type { ReviewComment } from "./types.js";

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

export function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\]8;[^;]*;[^\x1b]*\x1b\\|\x1b[^[\]].?/g, "");
}

// Mirror the nvim annotations plugin's `export_markdown` (the `<leader>cx`
// output) so annotate feedback reads identically: a plain `Re L<n>:` label,
// then a blockquote holding only the source line, then the comment as its own
// flush-left paragraph. Single-line content uses a code-span fence sized past
// any backtick run in the source; multi-line content uses a fenced code block.
function codeSpanFence(s: string): { fence: string; pad: string } {
	let longest = 0;
	for (const run of s.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
	const fence = "`".repeat(longest + 1);
	const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
	return { fence, pad };
}

export function formatReviewComments(
	comments: ReviewComment[],
	preamble = "I've reviewed the plan. Here are my comments:",
	/** Where a comment points, e.g. "answer 1, L5"; defaults to "L<line>". */
	locate: (c: ReviewComment) => string = (c) => `L${c.lineIndex}`,
): string {
	const lines = [preamble, ""];
	// General comments first, under a plain label with no quoted source line.
	for (const c of comments.filter((c) => c.general)) lines.push("General:", "", c.comment, "");
	for (const c of comments.filter((c) => !c.general)) {
		const trimmed = c.lineText.trim();
		lines.push(`Re ${locate(c)}:`);
		if (trimmed.includes("\n")) {
			lines.push("> ```");
			for (const cl of trimmed.split("\n")) lines.push(`> ${cl}`);
			lines.push("> ```");
		} else {
			const { fence, pad } = codeSpanFence(trimmed);
			lines.push(`> ${fence}${pad}${trimmed}${pad}${fence}`);
		}
		lines.push("");
		lines.push(c.comment);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
