import assert from "node:assert/strict";
import { test } from "node:test";
import { cutLines, isBlank, isNarrow, splitRow, tablesToLists } from "../narrow.ts";

const truncate = (text: string, width: number) => text.slice(0, width);

test("narrow only below the threshold and only with a known width", () => {
	assert.equal(isNarrow(46), true);
	assert.equal(isNarrow(59), true);
	assert.equal(isNarrow(60), false);
	assert.equal(isNarrow(200), false);
	assert.equal(isNarrow(undefined), false);
	assert.equal(isNarrow(0), false);
});

test("row split keeps escaped pipes and pipes in code spans", () => {
	assert.deepEqual(splitRow("| a | `x|y` | b \\| c |"), ["a", "`x|y`", "b | c"]);
	assert.deepEqual(splitRow("a | b"), ["a", "b"]);
});

test("a table becomes a nested list led by the first column", () => {
	const md = ["Intro", "", "| Tool | Cost | Note |", "|---|:-:|---|", "| Herdr | free | |", "| Paseo | 0 | push |", "", "After"].join("\n");
	assert.equal(
		tablesToLists(md),
		["Intro", "", "- Herdr", "  - Cost: free", "- Paseo", "  - Cost: 0", "  - Note: push", "", "After"].join("\n"),
	);
});

test("tables inside code fences stay as they are", () => {
	const md = ["```", "| a | b |", "|---|---|", "| 1 | 2 |", "```"].join("\n");
	assert.equal(tablesToLists(md), md);
});

test("text with pipes but no separator row is untouched", () => {
	const md = "run `a | b` and | c";
	assert.equal(tablesToLists(md), md);
});

test("blank detection ignores colour codes", () => {
	assert.equal(isBlank("\x1b[48;5;236m      \x1b[0m"), true);
	assert.equal(isBlank("\x1b[1mread\x1b[0m"), false);
});

test("short output stays whole", () => {
	assert.deepEqual(cutLines(["one", "two"], 2, 20, truncate), ["one", "two"]);
});

test("long output keeps the first lines and ends in an ellipsis", () => {
	assert.deepEqual(cutLines(["one", "two", "three"], 2, 4, truncate), ["one", "two…"]);
});

test("a framed box keeps its padding rows around the cut", () => {
	const lines = ["   ", "head", "a", "b", "c", "   "];
	assert.deepEqual(cutLines(lines, 2, 10, truncate), ["   ", "head", "a…", "   "]);
});
