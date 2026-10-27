import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "index.ts");
const contextFilterPath = path.join(root, "src", "context-filter.ts");
const promptsPath = path.join(root, "src", "prompts.ts");

const { neutralizeStaleSteeringMessages, STALE_STEERING_PLACEHOLDER } = await import(pathToFileURL(contextFilterPath).href);
const {
  buildEscalationPrompt,
  buildManualSmartCompactRequestPrompt,
  buildPostCompactionContinuationPrompt,
  SMART_COMPACT_STEERING_PREFIXES,
  SMART_COMPACT_INJECTED_PREFIXES,
} = await import(pathToFileURL(promptsPath).href);

const COMPACTION_AT = 1_000_000;

function summaryMessage(timestamp = COMPACTION_AT) {
  return { role: "compactionSummary", summary: "handoff text", tokensBefore: 120_000, timestamp };
}

function advisoryMessage(timestamp, text = buildEscalationPrompt({ tokens: 120_540, boundaryTokens: 120_000, band: 0, intervalTokens: 40_000 })) {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

function plainUserMessage(timestamp, text = "please continue") {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

describe("neutralizeStaleSteeringMessages", () => {
  it("returns undefined when no compaction summary is present, even with advisories", () => {
    const messages = [plainUserMessage(1), advisoryMessage(2)];
    assert.equal(neutralizeStaleSteeringMessages(messages), undefined, "pre-compaction requests must pass through untouched");
  });

  it("replaces stale steering text in place, preserving message count and position", () => {
    const stale = advisoryMessage(COMPACTION_AT - 10);
    const messages = [summaryMessage(), stale, plainUserMessage(COMPACTION_AT - 5)];
    const neutralized = neutralizeStaleSteeringMessages(messages);
    assert.ok(neutralized, "a stale advisory must trigger neutralization");
    assert.equal(neutralized.length, 3, "the message is replaced, never removed: dropping it makes the neighboring assistant turns adjacent, and that reshaped request still refused (P7/P8)");
    assert.equal(neutralized[1].role, "user");
    assert.deepEqual(neutralized[1].content, [{ type: "text", text: STALE_STEERING_PLACEHOLDER }]);
    assert.equal(neutralized[1].timestamp, COMPACTION_AT - 10, "other fields survive the replacement");
    assert.equal(neutralized[2], messages[2], "non-steering messages are passed through by reference");
  });

  it("keeps steering messages sent after the compaction verbatim", () => {
    const fresh = advisoryMessage(COMPACTION_AT + 10);
    const messages = [summaryMessage(), advisoryMessage(COMPACTION_AT - 10), fresh];
    const neutralized = neutralizeStaleSteeringMessages(messages);
    assert.ok(neutralized.includes(fresh), "a post-compaction advisory still steers and must survive untouched");
  });

  it("neutralizes every steering flavor: advisory, escalation rungs, manual request", () => {
    const texts = [
      buildEscalationPrompt({ tokens: 120_540, boundaryTokens: 120_000, band: 0, intervalTokens: 40_000 }),
      buildEscalationPrompt({ tokens: 161_000, boundaryTokens: 120_000, band: 1, intervalTokens: 40_000 }),
      buildEscalationPrompt({ tokens: 201_000, boundaryTokens: 120_000, band: 2, intervalTokens: 40_000 }),
      buildEscalationPrompt({ tokens: 241_000, boundaryTokens: 120_000, band: 3, intervalTokens: 40_000 }),
      buildManualSmartCompactRequestPrompt(),
    ];
    const messages = [summaryMessage(), ...texts.map((text, i) => advisoryMessage(COMPACTION_AT - 100 + i, text))];
    const neutralized = neutralizeStaleSteeringMessages(messages);
    assert.equal(neutralized.length, messages.length);
    for (const message of neutralized.slice(1)) {
      assert.deepEqual(message.content, [{ type: "text", text: STALE_STEERING_PLACEHOLDER }], "every stale steering flavor must be neutralized");
    }
  });

  it("treats an undatable steering message as stale", () => {
    const undated = advisoryMessage(undefined);
    const neutralized = neutralizeStaleSteeringMessages([summaryMessage(), undated]);
    assert.ok(neutralized, "no timestamp means the refusal risk wins");
    assert.deepEqual(neutralized[1].content, [{ type: "text", text: STALE_STEERING_PLACEHOLDER }]);
  });

  it("keeps ordinary user messages and string-content messages", () => {
    const messages = [
      summaryMessage(),
      { role: "user", content: "plain string user message", timestamp: COMPACTION_AT - 10 },
      plainUserMessage(COMPACTION_AT - 5),
    ];
    assert.equal(neutralizeStaleSteeringMessages(messages), undefined, "nothing to neutralize, so the event stays untouched");
  });
});

describe("steering prefixes stay in sync with the built prompts", () => {
  it("every built steering prompt starts with a registered prefix", () => {
    const prompts = [
      buildEscalationPrompt({ tokens: 120_540, boundaryTokens: 120_000, band: 0, intervalTokens: 40_000 }),
      buildEscalationPrompt({ tokens: 161_000, boundaryTokens: 120_000, band: 1, intervalTokens: 40_000 }),
      buildEscalationPrompt({ tokens: 201_000, boundaryTokens: 120_000, band: 2, intervalTokens: 40_000 }),
      buildEscalationPrompt({ tokens: 241_000, boundaryTokens: 120_000, band: 3, intervalTokens: 40_000 }),
      buildManualSmartCompactRequestPrompt(),
    ];
    for (const prompt of prompts) {
      assert.ok(
        SMART_COMPACT_STEERING_PREFIXES.some((prefix) => prompt.startsWith(prefix)),
        `prompt must start with a registered steering prefix, got: ${prompt.slice(0, 60)}`,
      );
    }
  });

  it("the post-compaction continuation starts with a registered injected prefix", () => {
    for (const prompt of [buildPostCompactionContinuationPrompt(), buildPostCompactionContinuationPrompt("/tmp/h.md")]) {
      assert.ok(
        SMART_COMPACT_INJECTED_PREFIXES.some((prefix) => prompt.startsWith(prefix)),
        `continuation must start with a registered injected prefix, got: ${prompt.slice(0, 60)}`,
      );
    }
  });
});

describe("context event registration", () => {
  it("the extension neutralizes stale advisories through the context event", async () => {
    const extensionModule = await import(pathToFileURL(extensionPath).href);
    const mock = createMockPi();
    await extensionModule.default(mock.pi);

    const stale = advisoryMessage(COMPACTION_AT - 10);
    const results = await mock.trigger("context", { messages: [summaryMessage(), stale, plainUserMessage(COMPACTION_AT + 5)] });
    const replacement = results.find((result) => result && Array.isArray(result.messages));
    assert.ok(replacement, "the context handler must return a neutralized message list");
    assert.equal(replacement.messages.length, 3);
    assert.deepEqual(replacement.messages[1].content, [{ type: "text", text: STALE_STEERING_PLACEHOLDER }]);
  });

  it("the context handler leaves untouched requests alone", async () => {
    const extensionModule = await import(pathToFileURL(extensionPath).href);
    const mock = createMockPi();
    await extensionModule.default(mock.pi);

    const results = await mock.trigger("context", { messages: [plainUserMessage(1), advisoryMessage(2)] });
    assert.ok(
      results.every((result) => result === undefined || result === null || result.messages === undefined),
      "no compaction summary means no replacement",
    );
  });
});
