export const PACKAGE_NAME = "pi-smart-compact";

/** First advisory rung. Claude MRCR degradation inflects between 64k and 128k. */
export const DEFAULT_SMART_BOUNDARY_TOKENS = 120_000;

/** Distance between escalation rungs: 120k / 160k / 200k / 240k at the defaults. */
export const DEFAULT_ESCALATION_INTERVAL_TOKENS = 40_000;

/**
 * pi auto-compacts once context exceeds `contextWindow - reserveTokens`
 * (`core/compaction/compaction.js`), and `reserveTokens` defaults to 16384
 * (`core/settings-manager.js`). The setting is not readable from an extension,
 * so the default is assumed when clamping the escalation ladder under the
 * native threshold. A user who raises `reserveTokens` gets a slightly
 * optimistic clamp, which is still far better than rungs that never fire.
 */
export const NATIVE_COMPACTION_RESERVE_TOKENS = 16_384;

/**
 * Smallest interval the native-threshold clamp will produce. Below this the
 * gap between the boundary and the native threshold is too narrow to ladder:
 * four steering messages inside a few thousand tokens of headroom would spend
 * the very context they protect, and rungs would land back at or above the
 * threshold. In that case the configured schedule is left alone and the native
 * failsafe simply wins, which is the documented fallback.
 */
export const MIN_CLAMPED_ESCALATION_INTERVAL_TOKENS = 4_000;

export const SMART_BOUNDARY_COMMAND_NAME = "smart-boundary";
export const SMART_COMPACT_COMMAND_NAME = "smart-compact";
export const SMART_COMPACT_TOOL_NAME = "smart_compact";

/** Durable handoff location, relative to the project cwd. */
export const HANDOFF_DIR_SEGMENTS = [".agents", "handoff"] as const;
export const HANDOFF_FILE_SUFFIX = "-compaction-handoff.md";
