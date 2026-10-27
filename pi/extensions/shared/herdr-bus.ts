/**
 * herdr blocked-state bridge (shared registry).
 *
 * Lets shared interactive-flow helpers (quiet-ui) flip the herdr sidebar pane
 * state to "blocked" while a tool waits for user input, so herdr fires its
 * native toast / sound with tab-aware suppression.
 *
 * herdr-agent-state.ts (the herdr-managed integration) listens on the pi event
 * bus channel "herdr:blocked" with payload { active: boolean; label?: string }
 * and reports the state over the herdr unix socket. This module only holds a
 * reference to that same event bus so code without a `pi` handle (e.g.
 * shared/quiet-ui.ts) can emit on it.
 *
 * The bus is registered by herdr-blocked-bridge.ts, only when running inside
 * herdr (HERDR_ENV=1) and only from the TUI root session's session_start, so
 * in-process subagent sessions cannot replace it with their own bus. Outside herdr nothing registers a bus, so the
 * emit helper no-ops and tmux / bare-terminal behavior is unchanged.
 *
 * Storage is on globalThis, not a module-level variable: pi loads each
 * extension through its own jiti instance with moduleCache disabled, so this
 * file is instantiated as a separate module copy per extension. A plain module
 * singleton set by the bridge would not be visible to the copy imported by
 * shared/quiet-ui inside the guardrails extension. globalThis is the
 * one namespace shared across all of them in the same Node process. pi.events
 * itself is already a single shared bus instance across extensions.
 *
 * Not an extension: no default export. Lives in shared/ so pi's
 * auto-discovery skips it.
 */

interface MiniBus {
	emit(channel: string, data: unknown): void;
}

const KEY = "__herdrBlockedBus";

export function registerHerdrBus(eventBus: MiniBus): void {
	(globalThis as Record<string, unknown>)[KEY] = eventBus;
}

function getBus(): MiniBus | undefined {
	return (globalThis as Record<string, unknown>)[KEY] as MiniBus | undefined;
}

/**
 * Raise (active=true) or clear (active=false) the herdr "blocked" state for
 * this pane. No-ops when not running inside herdr. Calls are ref-counted on
 * the consumer side, so balanced active/inactive pairs nest safely.
 */
export function emitHerdrBlocked(active: boolean, label?: string): void {
	getBus()?.emit("herdr:blocked", { active, label });
}
