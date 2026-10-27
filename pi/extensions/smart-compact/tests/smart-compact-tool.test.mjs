import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, chmod } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "smart-compact-tool-"));
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
  await chmod(tempRoot, 0o700).catch(() => undefined);
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
  assert.ok(tool, "the extension should register a smart_compact tool for agent-authored handoffs");
  assert.equal(typeof tool.execute, "function");
  return tool;
}

async function invokeSmartCompact(tool, params, ctx) {
  return tool.execute("call-smart-compact", params, new AbortController().signal, () => {}, ctx);
}

function toolResultText(result) {
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result?.content)) {
    return result.content.map((part) => (part?.type === "text" ? part.text : String(part))).join("\n");
  }
  return JSON.stringify(result ?? "");
}

function validHandoff(label = "initial") {
  return [
    `Progress/current task: ${label} implementation is paused at a safe boundary.`,
    "Decisions made: keep compaction same-session and cooperative.",
    "Files/artifacts: index.ts and tests/smart-compact-tool.test.mjs are relevant.",
    "Validation status: targeted tests have been run or are pending as noted.",
    "Risks/blockers: no replacement session APIs may be used.",
    "Next steps: resume with the next implementation step.",
  ].join("\n");
}

function assertStartedAndTerminates(result) {
  const text = toolResultText(result);
  assert.match(text, /compact|compaction/i, "tool result should communicate compaction status");
  assert.match(text, /start|started|underway|begun/i, "tool result should say compaction has started");
  assert.match(text, /no\s+further\s+action|wait|continuation|continue/i, "tool result should tell the agent to wait");
  assert.equal(result?.terminate, true, "smart_compact must be a terminal tool result for the current mini-phase");
}

async function readHandoffFiles(cwd) {
  const dir = path.join(cwd, ".agents", "handoff");
  const entries = await readdir(dir).catch(() => []);
  return Promise.all(
    entries.sort().map(async (name) => ({ name, contents: await readFile(path.join(dir, name), "utf8") })),
  );
}

describe("smart_compact tool and pending handoff state", () => {
  it("registers smart_compact with a required handoff parameter and lean, rubric-free static guidance", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);

    assert.equal(tool.name, "smart_compact");

    const handoffProperty = tool.parameters?.properties?.handoff;
    assert.ok(handoffProperty, "smart_compact parameters should include a handoff string");
    assert.ok(
      Array.isArray(tool.parameters?.required) && tool.parameters.required.includes("handoff"),
      "handoff should be required by the public tool schema",
    );

    const guidance = [
      tool.description,
      tool.promptSnippet,
      ...(Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines : []),
      handoffProperty?.description,
    ]
      .filter(Boolean)
      .join("\n");

    assert.match(guidance, /progress|current\s+task/i);
    assert.match(guidance, /decision/i);
    assert.match(guidance, /file|artifact/i);
    assert.match(guidance, /validation|test/i);
    assert.match(guidance, /risk|blocker/i);
    assert.match(guidance, /next\s+step/i);
    // Delivery-point change (2026-08-14, startup context budget): the fire /
    // suppress / wrap-up rubric, the handoff template, and the break-even ride
    // the band-0 boundary advisory (asserted in escalation.test.mjs), the only
    // moment they are actionable. The static guidance must stay rubric-free so
    // the ~900 tokens are not spent on every first message of every session.
    assert.doesNotMatch(guidance, /sub-task has just resolved|trajectory is converging/i, "static guidance must not carry the fire rubric");
    assert.doesNotMatch(guidance, /mid-derivation|mid-debugging/i, "static guidance must not carry the suppress rubric");
    assert.doesNotMatch(guidance, /## Current task/i, "static guidance must not carry the handoff template");
    assert.doesNotMatch(guidance, /roughly a tenth of the context it replaces/i, "static guidance must not carry the break-even");
    assert.match(
      guidance,
      /boundary advisory[\s\S]{0,120}(rubric|template)/i,
      "static guidance should point to the boundary advisory as the rubric's delivery point",
    );
    assert.match(guidance, /\.agents\/handoff\//, "guidance should mention the durable on-disk copy");
    assert.match(guidance, /alone|only\s+tool|final\s+action|last\s+action/i);
    assert.match(
      guidance,
      /terminates the turn immediately[\s\S]{0,120}lost/i,
      "guidance should say why smart_compact must be the last action",
    );
    assert.doesNotMatch(guidance, /\u2014/, "guidance must not contain em-dashes");
    assert.doesNotMatch(guidance, / -- /, "guidance must not use a double hyphen as an em-dash");
    assert.doesNotMatch(guidance, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u, "guidance must not contain emojis");
  });

  it("accepts a valid handoff, starts same-session compaction once, and returns a terminating started result", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    const result = await invokeSmartCompact(tool, { handoff: validHandoff() }, ctx);

    assert.equal(mock.state.compactCalls.length, 1, "a valid handoff should call ctx.compact() exactly once");
    assertStartedAndTerminates(result);
    assert.equal(mock.state.replacementSessionCalls.length, 0, "smart_compact must preserve same-session identity");
  });

  it("writes the handoff to <cwd>/.agents/handoff/ before compacting and reports the path", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const written = [];
    const ctx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      // ctx.compact() is fire-and-forget, so this must observe the filesystem
      // synchronously to prove the durable copy exists before compaction starts.
      compact(...args) {
        const dir = path.join(projectCwd, ".agents", "handoff");
        for (const name of readdirSync(dir).sort()) {
          written.push({ name, contents: readFileSync(path.join(dir, name), "utf8") });
        }
        mock.state.compactCalls.push(args);
      },
    });

    const result = await invokeSmartCompact(tool, { handoff: validHandoff("durable copy") }, ctx);

    assert.equal(written.length, 1, "exactly one handoff file should exist when ctx.compact is called");
    assert.match(
      written[0].name,
      /^\d{4}-\d{2}-\d{2}T[\d-]+Z-smart-compact-\d+-compaction-handoff\.md$/,
      "file name should be an ISO timestamp plus the compaction id",
    );
    assert.match(written[0].contents, /durable copy/, "the file should contain the agent-authored handoff text");
    assert.match(written[0].contents, /Compaction id: smart-compact-\d+/, "the file should record the compaction id");
    assert.match(
      toolResultText(result),
      new RegExp(path.join(projectCwd, ".agents", "handoff").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the tool result should tell the agent where the durable copy lives",
    );
  });

  it("still compacts when the durable handoff write fails", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const readOnlyCwd = await mkdtemp(path.join(tempRoot, "readonly-"));
    await chmod(readOnlyCwd, 0o500);
    const ctx = mock.createContext({ hasUI: true, cwd: readOnlyCwd });

    const result = await invokeSmartCompact(tool, { handoff: validHandoff("unwritable") }, ctx);

    await chmod(readOnlyCwd, 0o700);
    assert.equal(mock.state.compactCalls.length, 1, "a failed durable write must never block compaction");
    assertStartedAndTerminates(result);
    assert.match(toolResultText(result), /no durable handoff file/i, "the agent should be told the durable copy is missing");
    assert.ok(
      mock.state.notifications.some(({ level }) => level === "warning"),
      "a failed durable write should surface a warning",
    );
  });

  it("rejects a whitespace-only handoff without compacting or writing a file", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    const result = await invokeSmartCompact(tool, { handoff: " \n\t  " }, ctx);

    assert.equal(mock.state.compactCalls.length, 0, "blank handoffs must not trigger compaction");
    assert.deepEqual(await readHandoffFiles(projectCwd), [], "blank handoffs must not write a durable copy");
    assert.match(toolResultText(result), /handoff|non-empty|required|blank|empty|invalid/i);
  });

  it("does not silently overwrite an already-pending smart-compaction handoff", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, cwd: projectCwd });

    const first = await invokeSmartCompact(tool, { handoff: validHandoff("first") }, ctx);
    assertStartedAndTerminates(first);

    const second = await invokeSmartCompact(tool, { handoff: validHandoff("second") }, ctx);

    assert.equal(mock.state.compactCalls.length, 1, "a second call while pending must not start another compaction");
    assert.equal((await readHandoffFiles(projectCwd)).length, 1, "a rejected second call must not write another file");
    assert.match(toolResultText(second), /pending|already|in\s+progress|underway|wait|retry/i);
  });

  it("clears failed pending state when compaction start throws and does not send continue", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    let failNextCompact = true;
    const ctx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      compact(...args) {
        mock.state.compactCalls.push(args);
        if (failNextCompact) {
          failNextCompact = false;
          throw new Error("simulated compact failure");
        }
      },
    });

    const failed = await invokeSmartCompact(tool, { handoff: validHandoff("failed") }, ctx);

    assert.equal(mock.state.compactCalls.length, 1);
    assert.match(toolResultText(failed), /fail|error|could\s+not|unable/i);
    assert.equal(mock.state.sentUserMessages.length, 0, "failed smart compaction must not send an automatic continue");

    const retry = await invokeSmartCompact(tool, { handoff: validHandoff("retry after failure") }, ctx);

    assert.equal(mock.state.compactCalls.length, 2, "failed pending state should be cleared so a later handoff can retry");
    assertStartedAndTerminates(retry);
    assert.equal(mock.state.sentUserMessages.length, 0);
  });

  it("wakes the agent when onError fires after the terminating tool result was returned", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    let capturedOnError;
    const ctx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      isIdle: () => true,
      compact(...args) {
        mock.state.compactCalls.push(args);
        capturedOnError = args[0]?.onError;
      },
    });

    const result = await invokeSmartCompact(tool, { handoff: validHandoff("async onError") }, ctx);

    assertStartedAndTerminates(result);
    assert.equal(mock.state.sentUserMessages.length, 0, "nothing should be sent while compaction is still in flight");
    assert.equal(typeof capturedOnError, "function", "ctx.compact should receive an onError callback");

    // The real ctx.compact() is fire-and-forget, so onError lands only after the
    // tool result was already delivered and the agent stopped on terminate: true.
    capturedOnError(new Error("simulated async compact failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(mock.state.sentUserMessages.length, 1, "a late failure must reach the agent, not only the UI");
    const [sent] = mock.state.sentUserMessages;
    assert.match(sent.message, /smart compaction failed/i);
    assert.match(sent.message, /simulated async compact failure/);
    assert.match(sent.message, /reassess/i);
    assert.match(sent.message, /retry smart_compact|continue/i);
    assert.match(
      sent.message,
      new RegExp(path.join(projectCwd, ".agents", "handoff").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the agent should be told where the durable handoff copy lives",
    );
    assert.equal(sent.options?.deliverAs, undefined, "an idle session should be woken by a plain user message");

    const streamingCtx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      isIdle: () => false,
      compact(...args) {
        mock.state.compactCalls.push(args);
        capturedOnError = args[0]?.onError;
      },
    });

    await invokeSmartCompact(tool, { handoff: validHandoff("async onError while streaming") }, streamingCtx);
    capturedOnError(new Error("second simulated async compact failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(mock.state.sentUserMessages.length, 2);
    assert.equal(
      mock.state.sentUserMessages[1].options?.deliverAs,
      "followUp",
      "a still-streaming session must queue the notice instead of throwing",
    );
  });

  it("survives a throwing sendUserMessage when onError fires late", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    mock.pi.sendUserMessage = () => {
      throw new Error("simulated sendUserMessage failure");
    };
    let capturedOnError;
    const ctx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      isIdle: () => true,
      compact(...args) {
        mock.state.compactCalls.push(args);
        capturedOnError = args[0]?.onError;
      },
    });

    await invokeSmartCompact(tool, { handoff: validHandoff("throwing sendUserMessage") }, ctx);
    capturedOnError(new Error("simulated async compact failure"));

    const retry = await invokeSmartCompact(tool, { handoff: validHandoff("retry after throwing notice") }, ctx);

    assert.equal(mock.state.compactCalls.length, 2, "a throwing notice must not block expiry of the pending state");
    assertStartedAndTerminates(retry);
  });

  it("expires pending state when ctx.compact reports failure synchronously through onError", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    let failNextCompact = true;
    const ctx = mock.createContext({
      hasUI: true,
      cwd: projectCwd,
      compact(...args) {
        mock.state.compactCalls.push(args);
        if (failNextCompact) {
          failNextCompact = false;
          args[0]?.onError?.(new Error("simulated async compact failure"));
        }
      },
    });

    await invokeSmartCompact(tool, { handoff: validHandoff("callback failure") }, ctx);

    assert.equal(mock.state.compactCalls.length, 1);
    assert.equal(
      mock.state.sentUserMessages.length,
      0,
      "a synchronous onError is already reported by the tool result, so nothing extra is sent",
    );

    const retry = await invokeSmartCompact(tool, { handoff: validHandoff("retry after callback failure") }, ctx);

    assert.equal(mock.state.compactCalls.length, 2, "onError should expire failed pending state");
    assertStartedAndTerminates(retry);
  });
});
