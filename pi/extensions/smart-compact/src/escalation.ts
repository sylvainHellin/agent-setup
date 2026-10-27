import {
  DEFAULT_ESCALATION_INTERVAL_TOKENS,
  MIN_CLAMPED_ESCALATION_INTERVAL_TOKENS,
  NATIVE_COMPACTION_RESERVE_TOKENS,
} from "./constants.js";

export interface EscalationBandInput {
  tokens: number | null | undefined;
  boundaryTokens: number;
  intervalTokens?: number;
}

export function calculateEscalationBand({
  tokens,
  boundaryTokens,
  intervalTokens = DEFAULT_ESCALATION_INTERVAL_TOKENS,
}: EscalationBandInput): number | undefined {
  if (!Number.isFinite(tokens) || tokens === null || tokens === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(boundaryTokens) || boundaryTokens <= 0) {
    return undefined;
  }

  if (!Number.isSafeInteger(intervalTokens) || intervalTokens <= 0) {
    return undefined;
  }

  if (tokens < boundaryTokens) {
    return undefined;
  }

  return Math.floor((tokens - boundaryTokens) / intervalTokens);
}

export function isHigherEscalationBand(band: number | undefined, highestSentBand: number): band is number {
  return band !== undefined && Number.isInteger(band) && band > highestSentBand;
}

export interface EscalationScheduleInput {
  boundaryTokens: number;
  intervalTokens: number;
  contextWindow?: number | null;
}

export interface EscalationSchedule {
  boundaryTokens: number;
  intervalTokens: number;
  /** True when the interval was compressed to fit under the native threshold. */
  clamped: boolean;
}

/**
 * pi's native auto-compaction fires at `contextWindow - reserveTokens`, so any
 * rung at or above that threshold can never fire: the native failsafe wins
 * first with a generic summary. On a 200k-window model the threshold is about
 * 183.6k, below the default 200k and 240k rungs, which silently degenerates
 * the ladder to bands 0 and 1.
 *
 * When the configured top rung (band 3, at boundary + 3 * interval) would land
 * at or above the native threshold, compress the interval so band 3 fires at
 * three quarters of the gap between the boundary and the threshold, leaving
 * the last quarter as room to actually finish a unit and compact.
 * A boundary already at or above the threshold is left alone: silently moving
 * a user-configured boundary would hide the misconfiguration instead of
 * surfacing it. The same applies when the gap is too narrow for a meaningful
 * ladder (under four times MIN_CLAMPED_ESCALATION_INTERVAL_TOKENS): a
 * compressed interval of a few hundred tokens would fire several steering
 * messages inside the last sliver of headroom, so the schedule stays unchanged
 * and the native failsafe wins.
 */
export function clampEscalationSchedule({
  boundaryTokens,
  intervalTokens,
  contextWindow,
}: EscalationScheduleInput): EscalationSchedule {
  const unchanged: EscalationSchedule = { boundaryTokens, intervalTokens, clamped: false };

  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return unchanged;
  }

  if (!Number.isSafeInteger(boundaryTokens) || boundaryTokens <= 0 || !Number.isSafeInteger(intervalTokens) || intervalTokens <= 0) {
    return unchanged;
  }

  const nativeThreshold = contextWindow - NATIVE_COMPACTION_RESERVE_TOKENS;
  if (nativeThreshold <= boundaryTokens) {
    return unchanged;
  }

  if (boundaryTokens + 3 * intervalTokens < nativeThreshold) {
    return unchanged;
  }

  const clampedInterval = Math.floor((nativeThreshold - boundaryTokens) / 4);
  if (clampedInterval < MIN_CLAMPED_ESCALATION_INTERVAL_TOKENS) {
    return unchanged;
  }

  return { boundaryTokens, intervalTokens: clampedInterval, clamped: true };
}
