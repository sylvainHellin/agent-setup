import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const parserPath = path.join(root, "src", "smart-boundary-parser.ts");

async function loadParser() {
  const mod = await import(pathToFileURL(parserPath).href);
  const parse =
    mod.parseSmartBoundaryInput ??
    mod.parseSmartBoundaryCommand ??
    mod.parseSmartBoundary ??
    mod.default;

  assert.equal(typeof parse, "function", "smart-boundary parser must export a parse function");
  return parse;
}

function normalizeParseResult(result) {
  assert.ok(result && typeof result === "object", "parser should return a structured result object");

  const rawAction = result.action ?? result.type ?? result.kind;
  const action = typeof rawAction === "string" ? rawAction.toLowerCase() : rawAction;
  const ok = result.ok !== false && action !== "error" && action !== "invalid";
  const tokens = result.tokens ?? result.boundaryTokens ?? result.intervalTokens ?? result.boundary ?? result.value;
  const message = result.message ?? result.error ?? result.reason;

  return { ok, action, target: result.target, tokens, message, raw: result };
}

async function parse(input) {
  const parser = await loadParser();
  return normalizeParseResult(await parser(input));
}

function assertShow(result) {
  assert.equal(result.ok, true, "show input should parse successfully");
  assert.match(String(result.action), /show|current|get/, "show input should be classified as a read/current-setting action");
}

function assertReset(result, expectedTarget) {
  assert.equal(result.ok, true, "reset input should parse successfully");
  assert.match(String(result.action), /reset|default/, "reset input should be classified as a reset-to-default action");
  assert.equal(result.target, expectedTarget);
}

function assertSet(result, expectedTokens, expectedTarget = "boundary") {
  assert.equal(result.ok, true, `set input should parse successfully: ${JSON.stringify(result.raw)}`);
  assert.match(String(result.action), /set|update|boundary/, "token input should be classified as a set action");
  assert.equal(result.tokens, expectedTokens);
  assert.equal(result.target, expectedTarget);
}

function assertRejected(result, label) {
  assert.equal(result.ok, false, `${label} should be rejected`);
  assert.ok(typeof result.message === "string" && result.message.trim().length > 0, `${label} should include a helpful message`);
}

describe("smart-boundary parser", () => {
  it("parses empty or whitespace input as a show-current-settings request", async () => {
    assertShow(await parse(""));
    assertShow(await parse("   \t  "));
  });

  it("parses reset with surrounding whitespace as a reset-to-default request", async () => {
    assertReset(await parse("reset"), "all");
    assertReset(await parse("  reset  "), "all");
  });

  it("accepts k shorthand, plain integers, surrounding whitespace, and low positive manual-test values", async () => {
    assertSet(await parse("120k"), 120_000);
    assertSet(await parse("120000"), 120_000);
    assertSet(await parse("  120000  "), 120_000);
    assertSet(await parse("100"), 100);
  });

  it("rejects invalid text, zero, negative values, fractional forms, and unsafe integers", async () => {
    for (const input of [
      "abc",
      "0",
      "-1",
      "-100k",
      "1.5",
      "1.5k",
      "100.0k",
      String(Number.MAX_SAFE_INTEGER + 1),
      "9007199254741k",
    ]) {
      assertRejected(await parse(input), input);
    }
  });

  it("parses the escalation-interval sub-command", async () => {
    assertShow(await parse("interval"));
    assertShow(await parse("  interval   "));
    assertReset(await parse("interval reset"), "interval");
    assertSet(await parse("interval 40k"), 40_000, "interval");
    assertSet(await parse("interval 25000"), 25_000, "interval");
  });

  it("rejects invalid escalation-interval values with an interval-specific message", async () => {
    for (const input of ["interval abc", "interval 0", "interval -1", "interval 1.5k"]) {
      const result = await parse(input);
      assertRejected(result, input);
      assert.match(result.message, /interval/i, `${input} should be rejected with interval-specific guidance`);
    }
  });
});
