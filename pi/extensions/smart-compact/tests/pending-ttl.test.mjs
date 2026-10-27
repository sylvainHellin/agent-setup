import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const modulePath = path.join(root, "src", "smart-compact-state.ts");

async function load() {
  return import(pathToFileURL(modulePath).href);
}

describe("pending compaction TTL", () => {
  it("leaves a fresh pending compaction alone", async () => {
    const state = await load();
    const runtime = state.createSmartCompactRuntimeState();
    const pending = state.beginPendingSmartCompaction(runtime, "handoff");

    assert.ok(pending, "a pending compaction should start");
    assert.equal(
      state.findStalePendingSmartCompaction(runtime, pending.startedAt + 1000),
      undefined,
      "a compaction one second old is still in flight",
    );
  });

  it("reports a pending compaction as stale once the TTL elapses", async () => {
    const state = await load();
    const runtime = state.createSmartCompactRuntimeState();
    const pending = state.beginPendingSmartCompaction(runtime, "handoff");

    const stale = state.findStalePendingSmartCompaction(
      runtime,
      pending.startedAt + state.PENDING_SMART_COMPACTION_TTL_MS,
    );

    assert.equal(stale?.id, pending.id, "at the TTL boundary the compaction is assumed dead");
  });

  it("does not clear the pending state on its own", async () => {
    const state = await load();
    const runtime = state.createSmartCompactRuntimeState();
    const pending = state.beginPendingSmartCompaction(runtime, "handoff");

    state.findStalePendingSmartCompaction(runtime, pending.startedAt + 10 * state.PENDING_SMART_COMPACTION_TTL_MS);

    assert.equal(
      state.getPendingSmartCompaction(runtime)?.id,
      pending.id,
      "detection and expiry stay separate, so the caller decides whether to warn",
    );
  });

  it("reports nothing when no compaction is pending", async () => {
    const state = await load();
    const runtime = state.createSmartCompactRuntimeState();

    assert.equal(state.findStalePendingSmartCompaction(runtime, Date.now() + 10 ** 9), undefined);
  });
});

describe("fallback bookkeeping", () => {
  it("hands the fallback over exactly once", async () => {
    const state = await load();
    const runtime = state.createSmartCompactRuntimeState();

    state.markSmartCompactionFallback(runtime, {
      id: "smart-compact-1",
      handoffPath: "/tmp/handoff.md",
      reason: "the host did not provide a usable compaction preparation",
    });

    const first = state.takeSmartCompactionFallback(runtime);
    assert.equal(first?.handoffPath, "/tmp/handoff.md");
    assert.equal(
      state.takeSmartCompactionFallback(runtime),
      undefined,
      "a second session_compact must not re-notify the agent",
    );
  });
});
