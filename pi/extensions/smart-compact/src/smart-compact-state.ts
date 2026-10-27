export interface PendingSmartCompactionState {
  id: string;
  handoff: string;
  startedAt: number;
  status: "pending" | "expired";
  /** Absolute path of the durable on-disk copy, when the write succeeded. */
  handoffPath?: string;
}

/**
 * A pending compaction that fell back to pi's own summary, remembered so the
 * next `session_compact` can still wake the agent.
 */
export interface FallbackSmartCompactionState {
  id: string;
  handoffPath?: string;
  reason: string;
}

export interface SmartCompactRuntimeState {
  highestEscalationBandSent: number;
  activeBoundaryTokens?: number;
  activeIntervalTokens?: number;
  pendingSmartCompaction?: PendingSmartCompactionState;
  /** Set when the handoff was NOT used as the summary; consumed by session_compact. */
  fallbackSmartCompaction?: FallbackSmartCompactionState;
  nextPendingSmartCompactionId: number;
}

export function createSmartCompactRuntimeState(): SmartCompactRuntimeState {
  return { highestEscalationBandSent: -1, nextPendingSmartCompactionId: 1 };
}

export function resetEscalationState(state: SmartCompactRuntimeState): void {
  state.highestEscalationBandSent = -1;
  state.activeBoundaryTokens = undefined;
  state.activeIntervalTokens = undefined;
}

/**
 * Reset the band ladder whenever the boundary or the interval changes, so a
 * reconfigured schedule always starts from its own band 0.
 */
export function syncEscalationSettings(
  state: SmartCompactRuntimeState,
  boundaryTokens: number,
  intervalTokens: number,
): void {
  if (state.activeBoundaryTokens !== boundaryTokens || state.activeIntervalTokens !== intervalTokens) {
    state.highestEscalationBandSent = -1;
    state.activeBoundaryTokens = boundaryTokens;
    state.activeIntervalTokens = intervalTokens;
  }
}

export function markEscalationBandSent(state: SmartCompactRuntimeState, band: number): void {
  state.highestEscalationBandSent = band;
}

export function getPendingSmartCompaction(state: SmartCompactRuntimeState): PendingSmartCompactionState | undefined {
  return state.pendingSmartCompaction?.status === "pending" ? state.pendingSmartCompaction : undefined;
}

export function beginPendingSmartCompaction(
  state: SmartCompactRuntimeState,
  handoff: string,
): PendingSmartCompactionState | undefined {
  if (getPendingSmartCompaction(state)) {
    return undefined;
  }

  const pending: PendingSmartCompactionState = {
    id: `smart-compact-${state.nextPendingSmartCompactionId}`,
    handoff,
    startedAt: Date.now(),
    status: "pending",
  };
  state.nextPendingSmartCompactionId += 1;
  state.pendingSmartCompaction = pending;
  return pending;
}

export function setPendingHandoffPath(state: SmartCompactRuntimeState, id: string, handoffPath: string): void {
  const pending = state.pendingSmartCompaction;
  if (!pending || pending.id !== id || pending.status !== "pending") {
    return;
  }

  pending.handoffPath = handoffPath;
}

export function markSmartCompactionFallback(
  state: SmartCompactRuntimeState,
  fallback: FallbackSmartCompactionState,
): void {
  state.fallbackSmartCompaction = fallback;
}

export function takeSmartCompactionFallback(
  state: SmartCompactRuntimeState,
): FallbackSmartCompactionState | undefined {
  const fallback = state.fallbackSmartCompaction;
  state.fallbackSmartCompaction = undefined;
  return fallback;
}

/**
 * Milliseconds after which a pending compaction that never completed and never
 * errored is assumed dead. Two real host paths reach that state: another
 * extension's `session_before_compact` result winning (pi keeps the last
 * non-undefined one), and pi failing to re-find the appended entry by exact
 * summary string, in which case no `session_compact` is ever emitted. While
 * pending is stuck, escalation monitoring returns early on every turn and every
 * later `smart_compact` refuses, so the extension is silently dead for the rest
 * of the session. Generous, because a slow compaction is normal and expiring a
 * live one would inject a false alarm.
 */
export const PENDING_SMART_COMPACTION_TTL_MS = 10 * 60 * 1000;

/** Returns the pending compaction if it has outlived the TTL, without clearing it. */
export function findStalePendingSmartCompaction(
  state: SmartCompactRuntimeState,
  now: number = Date.now(),
  ttlMs: number = PENDING_SMART_COMPACTION_TTL_MS,
): PendingSmartCompactionState | undefined {
  const pending = getPendingSmartCompaction(state);
  if (!pending) {
    return undefined;
  }

  return now - pending.startedAt >= ttlMs ? pending : undefined;
}

export function expirePendingSmartCompaction(state: SmartCompactRuntimeState, id?: string): void {
  const pending = state.pendingSmartCompaction;
  if (!pending || (id !== undefined && pending.id !== id)) {
    return;
  }

  pending.status = "expired";
  state.pendingSmartCompaction = undefined;
}

export function clearPendingSmartCompaction(state: SmartCompactRuntimeState, id?: string): void {
  const pending = state.pendingSmartCompaction;
  if (!pending || (id !== undefined && pending.id !== id)) {
    return;
  }

  state.pendingSmartCompaction = undefined;
}
