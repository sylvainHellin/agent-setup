/**
 * Reusable mock for pi extension tests.
 * Captures public extension API registrations and session interactions without
 * invoking a real pi runtime, provider, or LLM session.
 *
 * Vendored from @wienerberliner/pi-smart-compact 0.1.2 (MIT), with a default
 * `ctx.cwd` under the OS temp dir so handoff-file writes can never touch the
 * repository working tree.
 */
import os from "node:os";
import path from "node:path";

export const MOCK_DEFAULT_CWD = path.join(os.tmpdir(), "pi-smart-compact-mock-cwd");

export function createMockPi(options = {}) {
  const state = {
    commands: new Map(),
    tools: new Map(),
    handlers: new Map(),
    sentUserMessages: [],
    rejectedUserMessages: [],
    compactionInProgress: false,
    notifications: [],
    compactCalls: [],
    replacementSessionCalls: [],
  };

  const defaultCwd = options.cwd ?? MOCK_DEFAULT_CWD;

  const pi = {
    registerCommand(name, definition) {
      state.commands.set(name, definition);
    },
    registerTool(definition) {
      state.tools.set(definition?.name, definition);
    },
    on(eventName, handler) {
      const handlers = state.handlers.get(eventName) ?? [];
      handlers.push(handler);
      state.handlers.set(eventName, handlers);
    },
    async sendUserMessage(message, options = {}) {
      // Simulate pi's real guard: while a compaction is in flight, prompt()
      // throws "Cannot submit a prompt while compaction is in progress" and the
      // runtime swallows it. `pi.sendUserMessage` is fire-and-forget, so a
      // throw here is lost, exactly as in the runtime, and the message is not
      // recorded. Tests opt in by setting `state.compactionInProgress`.
      if (state.compactionInProgress) {
        state.rejectedUserMessages.push({ message, options });
        throw new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.");
      }
      state.sentUserMessages.push({ message, options });
    },
    // These APIs are intentionally tracked as forbidden for smart-compact's
    // same-session contract. Tests can assert the array remains empty.
    async newSession(...args) {
      state.replacementSessionCalls.push({ api: "newSession", args });
    },
    async fork(...args) {
      state.replacementSessionCalls.push({ api: "fork", args });
    },
    async switchSession(...args) {
      state.replacementSessionCalls.push({ api: "switchSession", args });
    },
  };

  function createContext(overrides = {}) {
    const ctx = {
      cwd: defaultCwd,
      ui: {
        notify(message, level = "info") {
          state.notifications.push({ message, level });
        },
      },
      // pi 0.82.1 declares both of these synchronous: compact() is
      // fire-and-forget and getContextUsage() returns a value, not a promise.
      // An async mock would hide a regression that awaits either of them.
      compact(...args) {
        state.compactCalls.push(args);
        return undefined;
      },
      getContextUsage() {
        return undefined;
      },
      ...overrides,
    };
    return ctx;
  }

  async function trigger(eventName, event = {}, ctx = createContext()) {
    const results = [];
    for (const handler of state.handlers.get(eventName) ?? []) {
      results.push(await handler(event, ctx));
    }
    return results;
  }

  return { pi, state, createContext, trigger };
}
