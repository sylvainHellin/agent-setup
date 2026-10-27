// Process-scope per-pi-session CDP Session map.
//
// `browser_execute` looks up a `Session` keyed by the pi session id (from
// `ctx.sessionManager.getSessionId()`) so that a `session.connect(...)` made
// inside one snippet persists across later snippets in the same pi session:
// the agent connects once, drives many. The Session is a single CDP transport
// (one WebSocket); the agent is the source of truth for which browser is on the
// other end.
//
// Lifetime: Sessions live for the life of the pi process. The underlying
// WebSocket closes naturally when the browser exits. The agent can also close
// explicitly from a snippet (`await session.close()`), for instance before
// reconnecting to a different browser.
//
// `evict(sessionID)` is exposed for cleanup; production code does not need to
// call it, since sessions are cheap and the process will exit eventually.
//
// Ported from browser-use/browsercode `src/session-store.ts` (MIT); the only
// change is keying by the pi session id instead of the opencode session id.

import { Session } from "./cdp/session.ts";

const sessions = new Map<string, Session>();

export const get = (sessionID: string): Session => {
  const existing = sessions.get(sessionID);
  if (existing) return existing;
  const fresh = new Session();
  sessions.set(sessionID, fresh);
  return fresh;
};

// Retire a specific Session object after a browser_execute timeout. The
// expected Session is always invalidated; the identity check only guards the
// map delete, so a stale caller can never evict a successor Session that a
// newer call is already using.
export const invalidate = (sessionID: string, expected: Session, error: Error): void => {
  if (sessions.get(sessionID) === expected) sessions.delete(sessionID);
  expected.invalidate(error);
};

export const evict = async (sessionID: string): Promise<void> => {
  const entry = sessions.get(sessionID);
  if (!entry) return;
  sessions.delete(sessionID);
  entry.close();
};

// Close every live Session and clear the map. Called from the extension's
// session_shutdown handler so a headless `pi -p --browser` run whose snippet
// left a CDP WebSocket open still exits cleanly instead of hanging on the
// socket that keeps the event loop alive. Only reached once the CDP layer has
// already been loaded, so it never defeats the lazy import.
export const closeAll = (): void => {
  for (const [id, entry] of sessions) {
    sessions.delete(id);
    try {
      entry.close();
    } catch {
      /* best-effort teardown */
    }
  }
};

export * as SessionStore from "./session-store.ts";
