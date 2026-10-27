import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "index.ts");
const CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";

const DEFAULT_BOUNDARY = 120_000;
const DEFAULT_INTERVAL = 40_000;

let tempRoot;
let commandConfigPath;
let previousConfigEnv;

beforeAll(async () => {
  previousConfigEnv = process.env[CONFIG_ENV];
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "smart-compact-command-"));
  commandConfigPath = path.join(tempRoot, "smart-compact.json");
  process.env[CONFIG_ENV] = commandConfigPath;
});

beforeEach(async () => {
  await rm(commandConfigPath, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(commandConfigPath, { recursive: true, force: true });
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
  process.env[CONFIG_ENV] = commandConfigPath;
  const extensionModule = await import(pathToFileURL(extensionPath).href);
  const mock = createMockPi();
  await extensionModule.default(mock.pi);
  const command = mock.state.commands.get("smart-boundary");
  assert.ok(command, "the extension should register the /smart-boundary command");
  assert.match(String(command.description ?? ""), /boundary|token|interval/i);
  assert.equal(typeof command.handler, "function");
  return { mock, command };
}

function getSmartCompactCommand(setup) {
  const command = setup.mock.state.commands.get("smart-compact");
  assert.ok(command, "the extension should register the /smart-compact command");
  assert.match(String(command.description ?? ""), /smart|compact|handoff/i);
  return command;
}

async function invokeSmartBoundary(input, setup = undefined, contextOverrides = { hasUI: true }) {
  const current = setup ?? (await setupExtension());
  const ctx = current.mock.createContext(contextOverrides);
  const notificationStart = current.mock.state.notifications.length;
  const result = await current.command.handler(input, ctx);
  const notifications = current.mock.state.notifications.slice(notificationStart).map((entry) => entry.message);
  const output = [typeof result === "string" ? result : "", ...notifications].filter(Boolean).join("\n");
  assert.ok(output.trim().length > 0, `/smart-boundary ${input} should provide user-facing feedback`);
  return output;
}

function assertMentionsTokens(output, tokens) {
  const compact = output.replace(/[,_\s]/g, "").toLowerCase();
  assert.ok(
    compact.includes(String(tokens)) || compact.includes(`${tokens / 1000}k`),
    `expected feedback to mention ${tokens} tokens, got: ${output}`,
  );
}

function assertErrorFeedback(output, input) {
  assert.match(output, /invalid|reject|positive|integer|whole|usage|error/i, `expected helpful rejection for ${input}: ${output}`);
}

describe("/smart-compact command", () => {
  it("requests an agent-authored handoff without compacting immediately", async () => {
    const setup = await setupExtension();
    const command = getSmartCompactCommand(setup);
    const ctx = setup.mock.createContext({ hasUI: true });

    const result = await command.handler("", ctx);

    assert.equal(result, undefined, "/smart-compact should use UI feedback when available");
    assert.equal(setup.mock.state.compactCalls.length, 0, "no-arg /smart-compact must not compact on its own");
    assert.equal(setup.mock.state.sentUserMessages.length, 1);
    assert.match(setup.mock.state.sentUserMessages[0].message, /manual smart compaction requested/i);
    assert.match(setup.mock.state.sentUserMessages[0].message, /sub-task has just resolved|trajectory is converging/i);
    assert.deepEqual(setup.mock.state.sentUserMessages[0].options, {}, "idle command requests can be sent immediately");
    assert.equal(setup.mock.state.replacementSessionCalls.length, 0);
  });

  it("sends no-arg /smart-compact as steering when the agent is not idle", async () => {
    const setup = await setupExtension();
    const command = getSmartCompactCommand(setup);
    const ctx = setup.mock.createContext({ hasUI: true, isIdle: () => false });

    await command.handler("", ctx);

    assert.deepEqual(setup.mock.state.sentUserMessages[0].options, { deliverAs: "steer" });
    assert.equal(setup.mock.state.compactCalls.length, 0);
  });

  it("rejects command arguments because the active agent must author the handoff", async () => {
    const setup = await setupExtension();
    const command = getSmartCompactCommand(setup);
    const ctx = setup.mock.createContext({ hasUI: true });

    await command.handler("Current task: user-supplied handoff text should not be accepted.", ctx);

    assert.equal(setup.mock.state.compactCalls.length, 0);
    assert.equal(setup.mock.state.sentUserMessages.length, 0);
    assert.equal(setup.mock.state.notifications.at(-1).level, "error");
  });
});

describe("/smart-boundary command", () => {
  it("shows the default boundary, the default interval, and the resulting rungs", async () => {
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup);

    assertMentionsTokens(output, DEFAULT_BOUNDARY);
    assertMentionsTokens(output, DEFAULT_INTERVAL);
    assert.match(output, /escalation rungs/i);
    assert.match(output, /160,000/);
    assert.match(output, /200,000/);
    assert.match(output, /240,000/);
  });

  it("returns feedback instead of crashing when the command context has no UI notifier", async () => {
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup, { ui: undefined });

    assertMentionsTokens(output, DEFAULT_BOUNDARY);
    assert.equal(setup.mock.state.notifications.length, 0);
  });

  it("stores k shorthand and plain integers, and survives a simulated reload", async () => {
    let setup = await setupExtension();
    assertMentionsTokens(await invokeSmartBoundary("100k", setup), 100_000);

    setup = await setupExtension();
    assertMentionsTokens(await invokeSmartBoundary("", setup), 100_000);

    assertMentionsTokens(await invokeSmartBoundary("  160000  ", setup), 160_000);
    assertMentionsTokens(await invokeSmartBoundary("", await setupExtension()), 160_000);
  });

  it("stores the escalation interval separately and resets it independently", async () => {
    const setup = await setupExtension();
    await invokeSmartBoundary("160000", setup);

    const intervalOutput = await invokeSmartBoundary("interval 20k", setup);
    assert.match(intervalOutput, /interval/i);
    assertMentionsTokens(intervalOutput, 20_000);

    const reloaded = await invokeSmartBoundary("", await setupExtension());
    assertMentionsTokens(reloaded, 160_000);
    assertMentionsTokens(reloaded, 20_000);

    await invokeSmartBoundary("interval reset", setup);
    const afterReset = await invokeSmartBoundary("", await setupExtension());
    assertMentionsTokens(afterReset, 160_000);
    assertMentionsTokens(afterReset, DEFAULT_INTERVAL);
  });

  it("resets both values back to the defaults", async () => {
    const setup = await setupExtension();
    await invokeSmartBoundary("160000", setup);
    await invokeSmartBoundary("interval 20k", setup);

    const resetOutput = await invokeSmartBoundary(" reset ", setup);
    assertMentionsTokens(resetOutput, DEFAULT_BOUNDARY);
    assert.match(resetOutput, /reset|default/i);

    const showOutput = await invokeSmartBoundary("", await setupExtension());
    assertMentionsTokens(showOutput, DEFAULT_BOUNDARY);
    assertMentionsTokens(showOutput, DEFAULT_INTERVAL);
  });

  it("accepts low positive boundaries for manual testing", async () => {
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("100", setup);

    assertMentionsTokens(output, 100);
    assert.doesNotMatch(output, /invalid|reject|error/i);
  });

  it("rejects invalid, zero, negative, and fractional values without changing the stored boundary", async () => {
    const setup = await setupExtension();
    await invokeSmartBoundary("160000", setup);

    for (const input of ["abc", "0", "-1", "1.5", "1.5k", String(Number.MAX_SAFE_INTEGER + 1), "9007199254741k", "interval abc", "interval 0"]) {
      assertErrorFeedback(await invokeSmartBoundary(input, setup), input);
      assertMentionsTokens(await invokeSmartBoundary("", setup), 160_000);
    }
  });

  it("falls back to defaults instead of crashing when config is corrupt", async () => {
    await writeFile(commandConfigPath, "{ not valid json", "utf8");
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup);

    assertMentionsTokens(output, DEFAULT_BOUNDARY);
    assert.match(output, /default|corrupt|invalid|warning|could not|failed/i);
  });

  it("falls back to defaults instead of crashing when config cannot be read as a file", async () => {
    await mkdir(commandConfigPath);
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup);

    assertMentionsTokens(output, DEFAULT_BOUNDARY);
    assert.match(output, /default|unreadable|could not|failed|warning/i);
  });
});
