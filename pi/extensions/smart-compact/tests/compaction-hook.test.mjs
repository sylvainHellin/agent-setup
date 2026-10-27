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

let tempRoot;
let projectCwd;
let previousConfigEnv;
let testCounter = 0;

beforeAll(async () => {
  previousConfigEnv = process.env[CONFIG_ENV];
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "smart-compact-hooks-"));
});

beforeEach(async () => {
  testCounter += 1;
  process.env[CONFIG_ENV] = path.join(tempRoot, `smart-compact-${testCounter}.json`);
  projectCwd = await mkdtemp(path.join(tempRoot, `project-${testCounter}-`));
});

afterAll(async () => {
  if (previousConfigEnv === undefined) {
    delete process.env[CONFIG_ENV];
  } else {
    process.env[CONFIG_ENV] = previousConfigEnv;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

async function setupExtension() {
  const extensionModule = await import(pathToFileURL(extensionPath).href);
  const mock = createMockPi();
  await extensionModule.default(mock.pi);
  return mock;
}

function getSmartCompactTool(mock) {
  const tool = mock.state.tools.get("smart_compact");
  assert.ok(tool, "smart_compact should be registered so the hook can be driven through the public tool");
  return tool;
}

function getOnlyHandler(mock, eventName) {
  const handlers = mock.state.handlers.get(eventName) ?? [];
  assert.equal(handlers.length, 1, `the extension should register exactly one ${eventName} hook`);
  return handlers[0];
}

async function invokeSmartCompact(tool, params, ctx) {
  return tool.execute("call-smart-compact", params, new AbortController().signal, () => {}, ctx);
}

async function invokeBeforeCompact(mock, event, ctx) {
  return getOnlyHandler(mock, "session_before_compact")(event, ctx);
}

async function invokeSessionCompact(mock, event, ctx) {
  return getOnlyHandler(mock, "session_compact")(event, ctx);
}

// The continuation is deferred onto a macrotask so it lands after pi finishes
// the in-flight compaction (change 16). Drain the macrotask queue before
// asserting on delivery.
async function flushDeferredSends() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function validHandoff(label = "handoff") {
  return [
    `Progress/current task: ${label} is paused at a safe smart compaction boundary.`,
    "Decisions made: use same-session compaction and keep parent/subagent identity intact.",
    "Files/artifacts: tests/compaction-hook.test.mjs captures the required continuation flow.",
    "Validation status: targeted hook tests are running.",
    "Risks/blockers: stale handoff state must not leak into native compactions.",
    "Next steps: continue after compaction.",
  ].join("\n");
}

function compactionEvent(overrides = {}) {
  const signal = overrides.signal ?? new AbortController().signal;
  const preparation = Object.hasOwn(overrides, "preparation")
    ? overrides.preparation
    : {
        firstKeptEntryId: "entry-keep-42",
        messagesToSummarize: [],
        turnPrefixMessages: [],
        isSplitTurn: false,
        tokensBefore: 123456,
        previousSummary: "previous native summary",
        fileOps: { readFiles: [], modifiedFiles: [] },
        settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      };

  return { type: "session_before_compact", preparation, branchEntries: [], signal, ...overrides };
}

function compactionEntryFromResult(result, overrides = {}) {
  const compaction = result?.compaction;
  assert.ok(compaction, "expected a custom compaction result to build the session_compact event");
  return {
    type: "compaction",
    id: "saved-compaction-entry-1",
    parentId: "entry-before-compaction",
    timestamp: Date.now(),
    summary: compaction.summary,
    firstKeptEntryId: compaction.firstKeptEntryId,
    tokensBefore: compaction.tokensBefore,
    fromHook: true,
    details: compaction.details,
    ...overrides,
  };
}

function assertNoOverride(result, message) {
  assert.ok(result === undefined || result?.compaction === undefined, `${message}; got ${JSON.stringify(result)}`);
}

function sentContinueMessages(mock) {
  return mock.state.sentUserMessages.filter(({ message }) => message === "continue");
}

describe("compaction summary hook and continuation flow", () => {
  it("registers session_before_compact and session_compact hooks", async () => {
    const mock = await setupExtension();

    getOnlyHandler(mock, "session_before_compact");
    getOnlyHandler(mock, "session_compact");
  });

  it("returns no override for manual/native compaction when no smart handoff is pending", async () => {
    const mock = await setupExtension();
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    const result = await invokeBeforeCompact(mock, compactionEvent(), ctx);

    assertNoOverride(result, "native compaction without a pending handoff should fall back to pi default behavior");
    assert.equal(mock.state.sentUserMessages.length, 0);
  });

  it("uses the pending handoff as the summary, with provenance and the durable file path", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    await invokeSmartCompact(tool, { handoff: validHandoff("custom summary preservation") }, ctx);
    const result = await invokeBeforeCompact(mock, compactionEvent(), ctx);

    assert.ok(result?.compaction, "a pending handoff should override the compaction summary");
    assert.equal(result.compaction.firstKeptEntryId, "entry-keep-42", "the hook must preserve pi's prepared cut point");
    assert.equal(result.compaction.tokensBefore, 123456, "the hook must preserve pi's prepared tokensBefore");
    assert.match(result.compaction.summary, /custom summary preservation/, "the summary should carry the handoff text");
    assert.match(result.compaction.summary, /smart[_ -]?compact/i, "the summary should carry provenance");
    assert.match(
      result.compaction.summary,
      /durable copy of this handoff is on disk at .*\.agents[/\\]handoff[/\\].*-compaction-handoff\.md/i,
      "the post-compaction context must point at the durable copy",
    );

    const details = JSON.stringify(result.compaction.details ?? {});
    assert.match(details, /smart[_ -]?compact/i);
    assert.match(details, /smart-compact-\d+/, "details should carry an id for matching session_compact");
    assert.match(details, /handoffPath/, "details should record the durable file path");
  });

  it("omits the durable-copy line from the summary when the file could not be written", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: "" });

    await invokeSmartCompact(tool, { handoff: validHandoff("no durable copy") }, ctx);
    const result = await invokeBeforeCompact(mock, compactionEvent(), ctx);

    assert.ok(result?.compaction);
    assert.match(result.compaction.summary, /no durable copy/, "the in-context handoff is still the summary");
    assert.doesNotMatch(result.compaction.summary, /durable copy of this handoff is on disk/i);
  });

  it("clears pending state and sends exactly one continue when the matching compaction completes", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    await invokeSmartCompact(tool, { handoff: validHandoff("complete once") }, ctx);
    const beforeResult = await invokeBeforeCompact(mock, compactionEvent(), ctx);
    const completedEvent = {
      type: "session_compact",
      compactionEntry: compactionEntryFromResult(beforeResult),
      fromExtension: true,
    };

    await invokeSessionCompact(mock, completedEvent, ctx);
    await invokeSessionCompact(mock, completedEvent, ctx);
    await flushDeferredSends();

    assert.equal(
      mock.state.sentUserMessages.length,
      1,
      "a matching compaction should send exactly one continuation even if session_compact repeats",
    );
    // No `isIdle` on the mock ctx, so delivery falls back to the safe queueing
    // mode. A bare {} would throw inside pi when the agent is still streaming,
    // and the runtime swallows that rejection, losing the continuation silently.
    assert.deepEqual(mock.state.sentUserMessages[0].options, { deliverAs: "followUp" });
    const continuation = mock.state.sentUserMessages[0].message;
    assert.match(
      continuation,
      /just compacted to reclaim context/i,
      "the continuation must name what happened rather than sending a bare continue",
    );
    // 15 of 17 logged firings had the agent announce that smart_compact had
    // failed, because the tool ends the turn and so returns no tool result.
    assert.match(
      continuation,
      /shows no tool result[\s\S]{0,200}expected/i,
      "the continuation must say the missing tool result is expected",
    );
    assert.match(
      continuation,
      /do not call `smart_compact` again to retry/i,
      "the continuation must forbid the retry that produced duplicate compactions",
    );

    const laterManual = await invokeBeforeCompact(
      mock,
      compactionEvent({ preparation: { ...compactionEvent().preparation, firstKeptEntryId: "later-entry", tokensBefore: 777 } }),
      ctx,
    );
    assertNoOverride(laterManual, "a completed smart compaction should clear the pending handoff");
  });

  it("delivers the continuation even when pi rejects an inline send during the in-flight compaction", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    await invokeSmartCompact(tool, { handoff: validHandoff("deferred past the guard") }, ctx);
    const beforeResult = await invokeBeforeCompact(mock, compactionEvent(), ctx);
    const completedEvent = {
      type: "session_compact",
      compactionEntry: compactionEntryFromResult(beforeResult),
      fromExtension: true,
    };

    // Mirror pi's ordering: the abort controller is still set during the
    // session_compact emit, so any inline send throws and is swallowed. pi
    // clears it immediately after the handler resolves, which the macrotask
    // deferral must wait for.
    mock.state.compactionInProgress = true;
    await invokeSessionCompact(mock, completedEvent, ctx);
    mock.state.compactionInProgress = false;
    await flushDeferredSends();

    assert.equal(
      mock.state.sentUserMessages.length,
      1,
      "the continuation must survive the in-flight compaction guard by being deferred past it",
    );
    assert.match(mock.state.sentUserMessages[0].message, /just compacted to reclaim context/i);
  });

  it("does not send continue for unrelated/manual session_compact events while pending", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    await invokeSmartCompact(tool, { handoff: validHandoff("pending but unrelated completion") }, ctx);

    await invokeSessionCompact(
      mock,
      {
        type: "session_compact",
        fromExtension: false,
        compactionEntry: {
          type: "compaction",
          id: "manual-compaction-entry",
          summary: "Native/manual compaction summary",
          firstKeptEntryId: "manual-keep",
          tokensBefore: 222,
          details: { source: "native" },
        },
      },
      ctx,
    );

    assert.equal(sentContinueMessages(mock).length, 0, "an unrelated compaction completion must not resume the agent");

    const result = await invokeBeforeCompact(mock, compactionEvent(), ctx);
    assert.ok(result?.compaction, "an unrelated completion must not clear the still-pending handoff");
    assert.match(result.compaction.summary, /pending but unrelated completion/);
  });

  it("does not leak a stale handoff into a later native compaction after onError", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      compact(...args) {
        mock.state.compactCalls.push(args);
        args[0]?.onError?.(new Error("simulated compaction cancellation"));
      },
    });

    await invokeSmartCompact(tool, { handoff: validHandoff("failed stale handoff") }, ctx);
    const laterNativeResult = await invokeBeforeCompact(mock, compactionEvent(), ctx);

    assertNoOverride(laterNativeResult, "a cancelled smart compaction must expire pending state");
    assert.equal(sentContinueMessages(mock).length, 0);
  });

  it("falls back safely when preparation is missing or the hook signal is already aborted", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    await invokeSmartCompact(tool, { handoff: validHandoff("aborted or missing prep") }, ctx);
    assertNoOverride(
      await invokeBeforeCompact(mock, compactionEvent({ preparation: undefined }), ctx),
      "missing preparation should not produce a corrupt custom summary",
    );

    await invokeSmartCompact(tool, { handoff: validHandoff("aborted signal") }, ctx);
    const controller = new AbortController();
    controller.abort();
    assertNoOverride(
      await invokeBeforeCompact(mock, compactionEvent({ signal: controller.signal }), ctx),
      "an aborted compaction hook should fall back safely",
    );

    assertNoOverride(
      await invokeBeforeCompact(mock, compactionEvent(), ctx),
      "missing/aborted prep should clear the stale handoff for later native compaction",
    );
    assert.equal(sentContinueMessages(mock).length, 0);
  });
});
