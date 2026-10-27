import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "index.ts");
const escalationModulePath = path.join(root, "src", "escalation.ts");
const CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";

const BOUNDARY = 120_000;
const INTERVAL = 40_000;

let tempRoot;
let previousConfigEnv;
let testCounter = 0;

beforeAll(async () => {
  previousConfigEnv = process.env[CONFIG_ENV];
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "smart-compact-escalation-"));
});

beforeEach(async () => {
  testCounter += 1;
  process.env[CONFIG_ENV] = path.join(tempRoot, `smart-compact-${testCounter}.json`);
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

function contextWithTokens(mock, tokens, overrides = {}) {
  return mock.createContext({
    hasUI: true,
    getContextUsage() {
      return tokens === undefined ? undefined : { tokens, contextWindow: 400_000, percent: tokens / 400_000 };
    },
    ...overrides,
  });
}

async function triggerUsage(mock, tokens, overrides = {}) {
  return mock.trigger("turn_end", { type: "turn_end" }, contextWithTokens(mock, tokens, overrides));
}

async function invokeCommand(mock, name, input) {
  const command = mock.state.commands.get(name);
  assert.ok(command, `expected /${name} command to be registered`);
  return command.handler(input, mock.createContext({ hasUI: true }));
}

function lastSteeringMessage(mock) {
  const sent = mock.state.sentUserMessages.at(-1);
  assert.ok(sent, "expected a steering user message to be sent");
  assert.equal(sent.options?.deliverAs, "steer", "monitoring warnings must be delivered as steering user messages");
  assert.equal(typeof sent.message, "string", "steering warning should be visible text for the agent");
  return sent.message;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** Every rung names the usage against the boundary and stays in house style. */
function assertCommonEscalationContent(message) {
  assert.match(message, /handoff|compact/i);
  assert.match(message, /smart_compact/i);
  assert.match(message, /Current estimated context usage is [\d,]+ tokens; the configured smart boundary is [\d,]+ tokens\./);
  assert.doesNotMatch(message, /\u2014/, "prompt text must not contain em-dashes");
  assert.doesNotMatch(message, / -- /, "prompt text must not use a double hyphen as an em-dash");
  assert.doesNotMatch(message, EMOJI, "prompt text must not contain emojis");
}

/** Band 0 is the one rung that still pays for the full rubric and template. */
function assertFullRubricContent(message) {
  assert.match(message, /sub-task has just wrapped up|trajectory is converging/i, "band 0 should carry the fire rubric");
  assert.match(
    message,
    /concrete result that closed it[\s\S]{0,80}passing test, a commit, an answered question/i,
    "band 0 should gate firing on concrete evidence that the sub-task finished",
  );
  assert.match(message, /mid-derivation|mid-debugging|unsaved state/i, "band 0 should carry the suppress rubric");
  assert.match(
    message,
    /only when work will continue in this session/i,
    "band 0 should carry the wrap-up rubric, so compaction is not spent as the session ends",
  );
  assert.match(message, /artifact/i);
  assert.match(message, /## Current task\s*\/\s*atomic stopping point/i, "the template should be Markdown headings");
  assert.match(message, /## Risks\s*\/\s*blockers/i);
  assert.match(message, /few hundred words of pointers/i, "band 0 should state the break-even");
  assertCallableLine(message);
  assert.match(message, /\.agents\/handoff\//, "band 0 should point at the durable on-disk copy");
  assert.match(message, /pointers over prose/i, "band 0 should warn against narrating history the files already carry");
}

/** Rungs 1+ are deltas: no rubric, no template, one pointer back to the band-0 advisory. */
function assertDeltaRung(message) {
  assert.doesNotMatch(message, /Current task\s*\/\s*atomic stopping point/i, "escalations must not re-inject the handoff template");
  assert.doesNotMatch(message, /sub-task has just resolved/i, "escalations must not re-inject the fire rubric");
  assert.doesNotMatch(message, /mid-derivation/i, "escalations must not re-inject the suppress rubric");
  assert.match(
    message,
    /rubric and the handoff template were delivered with the first boundary advisory/i,
    "escalations should point back at the tool guidelines",
  );
  assertCallableLine(message);
  assert.ok(message.split("\n").length <= 7, `escalation rungs should stay short deltas, got:\n${message}`);
}

/** hide-declarations.ts hides the tool, so every rung must say it is callable and must not offer a no-tool way out. */
function assertCallableLine(message) {
  assert.match(message, /active and callable even though the tool list leaves its declaration out/i);
  assert.match(message, /smart_compact\(\{ handoff: /);
  assert.doesNotMatch(message, /handoff-style response/i, "no fallback that lets the model skip the hidden tool");
}

describe("token monitoring and escalation steering", () => {
  it("keeps below-boundary turns as a no-op", async () => {
    const mock = await setupExtension();
    assert.ok((mock.state.handlers.get("turn_end") ?? []).length > 0, "monitoring should hook turn_end");

    await triggerUsage(mock, BOUNDARY - 1);

    assert.equal(mock.state.sentUserMessages.length, 0, "usage below the boundary should not warn");
    assert.equal(mock.state.compactCalls.length, 0, "monitoring must not force compaction below the boundary");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "monitoring must preserve same-session identity");
  });

  it("starts the ladder over once usage drops back under the boundary, as after a prune", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    await triggerUsage(mock, BOUNDARY - 50_000);
    await triggerUsage(mock, BOUNDARY + 1_000);

    assert.equal(mock.state.sentUserMessages.length, 2, "band 0 should fire again after the dip");
    assert.match(lastSteeringMessage(mock), /^Smart compaction advisory/);
  });

  it("sends an advisory marker, not a compaction request, at the 120k boundary", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);

    assert.equal(mock.state.sentUserMessages.length, 1, "the first boundary band should send one warning");
    const message = lastSteeringMessage(mock);
    assertCommonEscalationContent(message);
    assertFullRubricContent(message);
    assert.match(message, /advisory/i, "band 0 should be an advisory marker");
    assert.match(message, /No action is needed yet/i);
    assert.match(message, /Next reminder at ~160,000 tokens\./, "band 0 should preview the next rung");
    assert.equal(mock.state.compactCalls.length, 0, "monitoring warnings must not call ctx.compact()");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "monitoring warnings must not call replacement-session APIs");
  });

  it("escalates to an offload-first rung at 160k", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    const firstMessage = lastSteeringMessage(mock);
    await triggerUsage(mock, BOUNDARY + INTERVAL - 1);
    assert.equal(mock.state.sentUserMessages.length, 1, "remaining in band 0 must not duplicate the first warning");

    await triggerUsage(mock, BOUNDARY + INTERVAL);

    assert.equal(mock.state.sentUserMessages.length, 2, "crossing boundary + interval should send the next escalation");
    const secondMessage = lastSteeringMessage(mock);
    assertCommonEscalationContent(secondMessage);
    assertDeltaRung(secondMessage);
    assert.notEqual(secondMessage, firstMessage, "the second rung should be a distinct escalation");
    assert.match(secondMessage, /prefer offloading over compacting/i);
    assert.match(secondMessage, /fresh subagent/i, "band 1 should suggest fresh subagents instead of compacting");
    assert.match(secondMessage, /Next reminder at ~200,000 tokens\./, "band 1 should preview the next rung");
    assert.ok(
      secondMessage.length < firstMessage.length,
      "an escalation delta should cost fewer tokens than the band 0 advisory",
    );
    assert.equal(mock.state.compactCalls.length, 0, "escalation monitoring must still not force compaction");
  });

  it("recommends compacting at 200k and raises strong urgency at 240k", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    await triggerUsage(mock, BOUNDARY + INTERVAL);
    await triggerUsage(mock, BOUNDARY + 2 * INTERVAL);

    const thirdMessage = lastSteeringMessage(mock);
    assertCommonEscalationContent(thirdMessage);
    assertDeltaRung(thirdMessage);
    assert.match(thirdMessage, /compacting is now the recommended action/i);
    assert.match(thirdMessage, /Next reminder at ~240,000 tokens\./, "band 2 should preview the next rung");

    await triggerUsage(mock, BOUNDARY + 3 * INTERVAL);

    const fourthMessage = lastSteeringMessage(mock);
    assertCommonEscalationContent(fourthMessage);
    assertDeltaRung(fourthMessage);
    assert.match(fourthMessage, /strong urgency/i);
    assert.match(fourthMessage, /level 4/i, "the blunt rung should print its level");
    assert.match(fourthMessage, /Next reminder at ~280,000 tokens\./, "band 3 should preview the next rung");
    assert.equal(mock.state.sentUserMessages.length, 4, "each of the four rungs should fire exactly once");
    assert.equal(mock.state.compactCalls.length, 0, "no rung may force compaction");
  });

  it("does not spam duplicate warnings for repeated turns in the same band", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    await triggerUsage(mock, BOUNDARY + 1);
    await triggerUsage(mock, BOUNDARY + 10_000);
    await triggerUsage(mock, BOUNDARY + INTERVAL - 1);

    assert.equal(mock.state.sentUserMessages.length, 1, "band 0 should only warn once until a higher band is reached");
  });

  it("treats undefined context usage as a safe no-op", async () => {
    const mock = await setupExtension();

    await assert.doesNotReject(() => triggerUsage(mock, undefined));

    assert.equal(mock.state.sentUserMessages.length, 0, "missing usage data should not send a warning");
    assert.equal(mock.state.compactCalls.length, 0, "missing usage data should not trigger compaction");
  });

  it("uses a custom /smart-boundary value when calculating bands", async () => {
    const mock = await setupExtension();
    await invokeCommand(mock, "smart-boundary", "75000");

    await triggerUsage(mock, 74_999);
    assert.equal(mock.state.sentUserMessages.length, 0, "usage below the custom boundary should not warn");

    await triggerUsage(mock, 75_000);
    assert.equal(mock.state.sentUserMessages.length, 1, "usage at the custom boundary should warn");

    await triggerUsage(mock, 114_999);
    assert.equal(mock.state.sentUserMessages.length, 1, "custom band 0 should not duplicate before + interval");

    await triggerUsage(mock, 115_000);
    assert.equal(mock.state.sentUserMessages.length, 2, "custom boundary + 40000 should escalate to band 1");
  });

  it("uses a custom /smart-boundary interval when calculating bands", async () => {
    const mock = await setupExtension();
    await invokeCommand(mock, "smart-boundary", "interval 10k");

    await triggerUsage(mock, BOUNDARY);
    assert.equal(mock.state.sentUserMessages.length, 1);

    await triggerUsage(mock, BOUNDARY + 9_999);
    assert.equal(mock.state.sentUserMessages.length, 1, "a shorter interval still debounces inside a band");

    await triggerUsage(mock, BOUNDARY + 10_000);
    assert.equal(mock.state.sentUserMessages.length, 2, "band 1 should now fire 10000 tokens after the boundary");
    assert.match(lastSteeringMessage(mock), /prefer offloading over compacting/i);
    assert.match(
      lastSteeringMessage(mock),
      /Next reminder at ~140,000 tokens\./,
      "the next-rung preview should follow the configured interval",
    );

    await invokeCommand(mock, "smart-boundary", "interval reset");
    const shown = await invokeCommand(mock, "smart-boundary", "");
    assert.equal(shown, undefined, "the command reports through ctx.ui.notify when a notifier exists");
    assert.match(mock.state.notifications.at(-1).message, /40,000 tokens/);
  });

  it("suppresses escalation warnings while a smart compaction is already pending", async () => {
    const mock = await setupExtension();
    const tool = mock.state.tools.get("smart_compact");
    const ctx = mock.createContext({ hasUI: true });

    await triggerUsage(mock, BOUNDARY);
    assert.equal(mock.state.sentUserMessages.length, 1);

    await tool.execute("call-1", { handoff: "Progress: done. Next steps: continue." }, new AbortController().signal, () => {}, ctx);

    await triggerUsage(mock, BOUNDARY + INTERVAL);
    await triggerUsage(mock, BOUNDARY + 2 * INTERVAL);

    assert.equal(
      mock.state.sentUserMessages.length,
      1,
      "no further steering may be injected while the agent's own compaction is in flight",
    );
  });

  it("resets escalation state after a native compaction it did not initiate", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    await triggerUsage(mock, BOUNDARY + INTERVAL);
    assert.equal(mock.state.sentUserMessages.length, 2);

    await mock.trigger(
      "session_compact",
      {
        type: "session_compact",
        fromExtension: false,
        compactionEntry: {
          type: "compaction",
          id: "native-compaction-entry",
          summary: "native summary",
          firstKeptEntryId: "native-keep",
          tokensBefore: 210_000,
          details: { source: "native" },
        },
      },
      mock.createContext({ hasUI: true }),
    );

    assert.equal(mock.state.sentUserMessages.length, 2, "a native compaction must not send an automatic continue");

    await triggerUsage(mock, BOUNDARY);

    assert.equal(
      mock.state.sentUserMessages.length,
      3,
      "after a native compaction the band ladder must start over instead of staying silent for the session",
    );
    assert.match(lastSteeringMessage(mock), /advisory/i);
  });

  it("resets escalation state on session_start/reload", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    await triggerUsage(mock, BOUNDARY + 1);
    assert.equal(mock.state.sentUserMessages.length, 1);

    await mock.trigger("session_start", { type: "session_start" }, mock.createContext({ hasUI: true }));
    await triggerUsage(mock, BOUNDARY + 1);

    assert.equal(mock.state.sentUserMessages.length, 2, "session_start should reset in-memory band tracking safely");
  });

  it("resets escalation state on branch navigation (session_tree)", async () => {
    // navigateTree emits session_tree, not session_start. Rewinding from a
    // long branch must not leave the ladder stuck at the old branch's band.
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY + 2 * INTERVAL);
    assert.equal(mock.state.sentUserMessages.length, 1, "test precondition: the old branch reached band 2");

    await mock.trigger("session_tree", { type: "session_tree" }, mock.createContext({ hasUI: true }));
    await triggerUsage(mock, BOUNDARY);

    assert.equal(
      mock.state.sentUserMessages.length,
      2,
      "after navigating the session tree the band ladder must start over on the new branch",
    );
    assert.match(lastSteeringMessage(mock), /advisory/i, "the new branch's first warning should be band 0 again");
  });

  it("does not call compact or replacement-session APIs from any monitoring path", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY);
    await triggerUsage(mock, BOUNDARY + INTERVAL);

    assert.equal(mock.state.sentUserMessages.length, 2, "test precondition: monitoring crossed two warning bands");
    assert.deepEqual(mock.state.compactCalls, [], "token monitoring must never call ctx.compact()");
    assert.deepEqual(mock.state.replacementSessionCalls, [], "token monitoring must not replace the session");
  });

  it("clamps the ladder under the native threshold, so band 3 still fires on a 200k-window model", async () => {
    // Native auto-compaction fires near 200_000 - 16_384 = 183_616, below the
    // default 200k and 240k rungs. With the clamp, the interval compresses to
    // floor((183_616 - 120_000) / 4) = 15_904, so 170k tokens is band 3.
    const mock = await setupExtension();

    await triggerUsage(mock, 170_000, {
      getContextUsage: () => ({ tokens: 170_000, contextWindow: 200_000 }),
    });

    assert.equal(mock.state.sentUserMessages.length, 1);
    const message = lastSteeringMessage(mock);
    assert.match(message, /strong urgency/i, "the top rung must be reachable below the native threshold");
    assert.match(message, /level 4/i);
  });

  it("warns in /smart-boundary when the configured rungs sit above the native threshold", async () => {
    const mock = await setupExtension();
    const command = mock.state.commands.get("smart-boundary");
    assert.ok(command, "expected /smart-boundary command to be registered");

    await command.handler(
      "",
      mock.createContext({
        hasUI: true,
        getContextUsage: () => ({ tokens: 50_000, contextWindow: 200_000 }),
      }),
    );

    const note = mock.state.notifications.at(-1)?.message ?? "";
    assert.match(note, /native auto-compaction fires near 183,616/i, "show should name the native threshold");
    assert.match(note, /clamped to 15,904/i, "show should name the effective interval");
    assert.match(note, /135,904 tokens, 151,808 tokens, 167,712 tokens/, "show should list the effective rungs");
  });

  it("appends the native-threshold note to set confirmations, which would otherwise mislead", async () => {
    const mock = await setupExtension();
    const command = mock.state.commands.get("smart-boundary");
    const ctx200k = () =>
      mock.createContext({
        hasUI: true,
        getContextUsage: () => ({ tokens: 50_000, contextWindow: 200_000 }),
      });

    await command.handler("interval 40k", ctx200k());
    const intervalNote = mock.state.notifications.at(-1)?.message ?? "";
    assert.match(intervalNote, /Escalation interval set to 40,000/i);
    assert.match(intervalNote, /clamped to 15,904/i, "confirming an interval that will be clamped must say so");

    await command.handler("190000", ctx200k());
    const boundaryNote = mock.state.notifications.at(-1)?.message ?? "";
    assert.match(boundaryNote, /Smart boundary set to 190,000/i);
    assert.match(
      boundaryNote,
      /ladder will never fire/i,
      "a boundary at or above the native threshold must be called out, since the clamp deliberately leaves it alone",
    );
  });

  it("handles sendUserMessage failures without crashing future monitoring", async () => {
    const mock = await setupExtension();
    let attempts = 0;
    mock.pi.sendUserMessage = async (message, options = {}) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("simulated steering delivery failure");
      }
      mock.state.sentUserMessages.push({ message, options });
    };

    await assert.doesNotReject(() => triggerUsage(mock, BOUNDARY));
    assert.equal(mock.state.sentUserMessages.length, 0, "the failed first send should not record a delivered warning");

    await assert.doesNotReject(() => triggerUsage(mock, BOUNDARY + INTERVAL));

    assert.equal(mock.state.sentUserMessages.length, 1, "future monitoring should still deliver a later-band warning");
    assertCommonEscalationContent(mock.state.sentUserMessages[0].message);
    assert.equal(mock.state.compactCalls.length, 0, "send failure recovery must not fall back to forced compaction");
  });
});

describe("clampEscalationSchedule", () => {
  async function loadEscalation() {
    return import(pathToFileURL(escalationModulePath).href);
  }

  it("compresses the interval when the top rung sits at or above the native threshold", async () => {
    const { clampEscalationSchedule } = await loadEscalation();

    const schedule = clampEscalationSchedule({ boundaryTokens: 120_000, intervalTokens: 40_000, contextWindow: 200_000 });

    assert.equal(schedule.clamped, true);
    assert.equal(schedule.boundaryTokens, 120_000, "the user-configured boundary must not move");
    assert.equal(schedule.intervalTokens, 15_904, "floor((183_616 - 120_000) / 4)");
    assert.ok(
      schedule.boundaryTokens + 3 * schedule.intervalTokens < 200_000 - 16_384,
      "band 3 must fire below the native threshold",
    );
  });

  it("leaves the schedule alone when every rung already fits under the native threshold", async () => {
    const { clampEscalationSchedule } = await loadEscalation();

    const schedule = clampEscalationSchedule({ boundaryTokens: 120_000, intervalTokens: 40_000, contextWindow: 400_000 });

    assert.deepEqual(schedule, { boundaryTokens: 120_000, intervalTokens: 40_000, clamped: false });
  });

  it("leaves the schedule alone without a usable context window", async () => {
    const { clampEscalationSchedule } = await loadEscalation();

    for (const contextWindow of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const schedule = clampEscalationSchedule({ boundaryTokens: 120_000, intervalTokens: 40_000, contextWindow });
      assert.deepEqual(
        schedule,
        { boundaryTokens: 120_000, intervalTokens: 40_000, clamped: false },
        `contextWindow=${contextWindow} must not clamp`,
      );
    }
  });

  it("leaves a boundary at or above the native threshold alone instead of hiding the misconfiguration", async () => {
    const { clampEscalationSchedule } = await loadEscalation();

    const schedule = clampEscalationSchedule({ boundaryTokens: 190_000, intervalTokens: 40_000, contextWindow: 200_000 });

    assert.deepEqual(schedule, { boundaryTokens: 190_000, intervalTokens: 40_000, clamped: false });
  });

  it("clamps a top rung landing exactly on the native threshold", async () => {
    // The original bug was rungs at or above the threshold, so the boundary
    // condition must clamp: boundary + 3 * interval === 183_616 exactly.
    const { clampEscalationSchedule } = await loadEscalation();

    const schedule = clampEscalationSchedule({ boundaryTokens: 120_001, intervalTokens: 21_205, contextWindow: 200_000 });

    assert.equal(schedule.clamped, true, "equality with the native threshold must clamp, not pass");
    assert.ok(
      schedule.boundaryTokens + 3 * schedule.intervalTokens < 200_000 - 16_384,
      "band 3 must land strictly below the native threshold",
    );
  });

  it("leaves a gap too narrow to ladder unchanged instead of spamming rungs into the last headroom", async () => {
    // gap = 183_616 - 180_000 = 3_616; floor(gap / 4) = 904 is below the
    // 4_000-token minimum, so clamping would fire several steering messages
    // inside the final sliver of context. The native failsafe wins instead.
    const { clampEscalationSchedule } = await loadEscalation();

    const schedule = clampEscalationSchedule({ boundaryTokens: 180_000, intervalTokens: 40_000, contextWindow: 200_000 });

    assert.deepEqual(schedule, { boundaryTokens: 180_000, intervalTokens: 40_000, clamped: false });
  });
});

describe("prune-first recommendation", () => {
  const SESSION = "/tmp/sessions/2026-10-21T09-00-00-000Z_01a15dce-bbfe-77ff.jsonl";
  const usage = (input) => ({ input, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: input, cost: { total: 0 } });

  /** A branch whose bulk is thinking and tool output, so a prune would shrink it a lot. */
  function branch(turns, textChars = 50) {
    const entries = [{ type: "message", id: "u0", message: { role: "user", content: "start", timestamp: 0 } }];
    for (let i = 0; i < turns; i++) {
      entries.push({
        type: "message",
        id: `a${i}`,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "t".repeat(4_000) },
            { type: "text", text: "x".repeat(textChars) },
            { type: "toolCall", id: `c${i}`, name: "read", arguments: { path: `/f${i}.ts` } },
          ],
          usage: usage(i === 0 ? 10_000 : 50_000),
          timestamp: i + 1,
        },
      });
      entries.push({
        type: "message",
        id: `r${i}`,
        message: { role: "toolResult", toolCallId: `c${i}`, toolName: "read", content: [{ type: "text", text: "r".repeat(6_000) }], isError: false, timestamp: i + 1 },
      });
    }
    return entries;
  }

  const withBranch = (entries) => ({
    sessionManager: {
      getSessionFile: () => SESSION,
      getBranch: () => entries,
      buildSessionProjection: () => ({ entries: entries.map((sourceEntry) => ({ sourceEntry, messages: [] })) }),
    },
  });

  async function loadPrompts() {
    return import(pathToFileURL(path.join(root, "src", "prompts.ts")).href);
  }

  it("recommends the prune tool at the boundary when the pruned estimate is under 70% of it", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY, withBranch(branch(40)));

    const message = lastSteeringMessage(mock);
    assertCommonEscalationContent(message);
    assertFullRubricContent(message);
    assert.match(message, /A prune would bring this context to about [\d,]+ tokens \(\d+% of the boundary\)/);
    assert.match(message, /`prune` is active and callable[\s\S]*call `prune\(\{\}\)` alone, then keep working/);
    assert.doesNotMatch(message, /No action is needed yet/i, "the prune variant asks for a suggestion at the next stopping point");
    assert.ok(
      mock.state.notifications.some((n) => /a prune would leave about/.test(n.message)),
      "the UI should show the estimate too",
    );
  });

  it("keeps the smart_compact rungs when a prune would still leave too much", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, BOUNDARY, withBranch(branch(40, 4_000)));

    const message = lastSteeringMessage(mock);
    assert.doesNotMatch(message, /prune\(/, "a prune above the gate should not be recommended");
    assert.match(message, /No action is needed yet/i);
  });

  it("swaps the smart_compact action for the prune tool on later rungs", async () => {
    const { buildEscalationPrompt } = await loadPrompts();
    const base = { tokens: 200_000, boundaryTokens: BOUNDARY, intervalTokens: INTERVAL, prunedTokens: 40_000 };

    const band2 = buildEscalationPrompt({ ...base, band: 2 });
    assertCommonEscalationContent(band2);
    assert.match(band2, /^Smart compaction escalation: a prune is the recommended action now\./);
    assert.doesNotMatch(band2, /call `smart_compact\(\{ handoff \}\)`/, "band 2 should not ask for smart_compact");

    const band3 = buildEscalationPrompt({ ...base, band: 3 });
    assert.match(band3, /^Smart compaction escalation level 4: strong urgency/);
    assert.match(band3, /Call `prune\(\{\}\)` at the next safe point/);
    assert.doesNotMatch(band3, /smart_compact\(\{ handoff \}\)/, "a rung recommending prune should not also ask for smart_compact");
  });

  it("gates on 70% of the boundary and ignores unusable estimates", async () => {
    const { shouldRecommendPrune, PRUNE_GATE_RATIO } = await loadPrompts();

    assert.equal(PRUNE_GATE_RATIO, 0.7);
    assert.equal(shouldRecommendPrune(84_000, 120_000), true);
    assert.equal(shouldRecommendPrune(84_001, 120_000), false);
    for (const bad of [undefined, 0, -1, Number.NaN]) assert.equal(shouldRecommendPrune(bad, 120_000), false);
  });
});
