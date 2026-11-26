import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "index.ts");
const CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";
const CHANNEL = "prune:auto";
const SESSION_ID = "01a1e2a0-8fd9";

let tempRoot;
let previousConfigEnv;
let testCounter = 0;

beforeAll(async () => {
  previousConfigEnv = process.env[CONFIG_ENV];
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "smart-compact-auto-prune-"));
});

beforeEach(() => {
  testCounter += 1;
  process.env[CONFIG_ENV] = path.join(tempRoot, `smart-compact-${testCounter}.json`);
});

afterAll(async () => {
  if (previousConfigEnv === undefined) delete process.env[CONFIG_ENV];
  else process.env[CONFIG_ENV] = previousConfigEnv;
  await rm(tempRoot, { recursive: true, force: true });
});

/** The extension, with this session started and (unless `announce` is false) the prune extension announced for it. */
async function setup({ announce = true, announcedId = SESSION_ID } = {}) {
  const extensionModule = await import(pathToFileURL(extensionPath).href);
  const mock = createMockPi();
  await extensionModule.default(mock.pi);
  if (announce) mock.pi.events.emit(CHANNEL, { type: "active", sessionId: announcedId });
  await mock.trigger("session_start", { type: "session_start", reason: "startup" }, ctxWithTokens(mock, 0));
  return mock;
}

function ctxWithTokens(mock, tokens) {
  return mock.createContext({
    hasUI: true,
    getContextUsage() {
      return { tokens, contextWindow: 400_000, percent: tokens / 400_000 };
    },
    sessionManager: {
      getSessionId: () => SESSION_ID,
      getSessionFile: () => undefined,
    },
  });
}

const turnEnd = (mock, tokens) => mock.trigger("turn_end", { type: "turn_end" }, ctxWithTokens(mock, tokens));
const pruned = (mock, tokensEstimate, sessionId = SESSION_ID) =>
  mock.pi.events.emit(CHANNEL, { type: "pruned", sessionId, trigger: "seam", tokensBefore: 130_000, tokensEstimate });

describe("smart-compact beside the automatic prune", () => {
  it("holds the boundary advisory back while the prune extension prunes this session on its own", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    await turnEnd(mock, 175_000);
    assert.equal(mock.state.sentUserMessages.length, 0);
  });

  it("keeps the advisory when only another session announced the automatic prune", async () => {
    const mock = await setup({ announcedId: "some-subagent" });
    await turnEnd(mock, 130_000);
    assert.equal(mock.state.sentUserMessages.length, 1);
    assert.match(mock.state.sentUserMessages[0].message, /^Smart compaction advisory:/);
  });

  it("keeps the advisory when no prune extension announced itself", async () => {
    const mock = await setup({ announce: false });
    await turnEnd(mock, 130_000);
    assert.equal(mock.state.sentUserMessages.length, 1);
  });

  it("falls back to the handoff advisory once when an automatic prune leaves more than 60k", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    pruned(mock, 70_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mock.state.sentUserMessages.length, 1);
    const { message, options } = mock.state.sentUserMessages[0];
    assert.deepEqual(options, { deliverAs: "steer" });
    assert.match(message, /^Smart compaction advisory:/, "a steering prefix, so the context filter neutralizes it after compaction");
    assert.match(message, /automatic prune/i);
    assert.match(message, /130,000/);
    assert.match(message, /70,000/);
    assert.match(message, /smart_compact\(\{ handoff/);
    assert.match(message, /## Current task\s*\/\s*atomic stopping point/, "it carries the handoff template");
    assert.doesNotMatch(message, /prune\(\{\}\)/, "it does not recommend another prune");
    assert.doesNotMatch(message, /\u2014/);

    pruned(mock, 75_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mock.state.sentUserMessages.length, 1, "sent once until a compaction resets it");
  });

  it("stays quiet when the automatic prune recovered enough", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    pruned(mock, 40_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mock.state.sentUserMessages.length, 0);
  });

  it("ignores prune outcomes of other sessions", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    pruned(mock, 90_000, "some-subagent");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mock.state.sentUserMessages.length, 0);
  });

  it("falls back when the automatic prune found nothing worth cutting", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    mock.pi.events.emit(CHANNEL, { type: "no-gain", sessionId: SESSION_ID, trigger: "ceiling", tokensBefore: 165_000, reason: "x" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mock.state.sentUserMessages.length, 1);
    assert.match(mock.state.sentUserMessages[0].message, /^Smart compaction advisory:/);
    assert.match(mock.state.sentUserMessages[0].message, /165,000/);
  });

  it("does not repeat the advisory as band 0 on the turn after a no-gain fallback", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    mock.pi.events.emit(CHANNEL, { type: "no-gain", sessionId: SESSION_ID, trigger: "seam", tokensBefore: 130_000, reason: "x" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mock.state.sentUserMessages.length, 1);
    await turnEnd(mock, 131_000);
    assert.equal(mock.state.sentUserMessages.length, 1, "the fallback already covers band 0");
  });

  it("after the fallback, runs today's ladder without recommending a prune, until a compaction", async () => {
    const mock = await setup();
    await turnEnd(mock, 130_000);
    pruned(mock, 70_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await turnEnd(mock, 70_000);
    await turnEnd(mock, 165_000);
    assert.equal(mock.state.sentUserMessages.length, 2, "the ladder fires again");
    assert.match(mock.state.sentUserMessages[1].message, /Smart compaction/);
    assert.doesNotMatch(mock.state.sentUserMessages[1].message, /prune\(\{\}\)/);

    await mock.trigger("session_compact", { type: "session_compact", compactionEntry: { details: {} } }, ctxWithTokens(mock, 30_000));
    await turnEnd(mock, 130_000);
    assert.equal(mock.state.sentUserMessages.length, 2, "after a compaction the automatic prune leads again");
  });
});
