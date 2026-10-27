import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import {
  DEFAULT_ESCALATION_INTERVAL_TOKENS,
  DEFAULT_SMART_BOUNDARY_TOKENS,
  PACKAGE_NAME,
} from "./constants.js";

export const SMART_BOUNDARY_CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";

export type SmartCompactConfigResetTarget = "boundary" | "interval" | "all";

export interface SmartBoundaryConfigOptions {
  configPath?: string;
  path?: string;
}

export interface SmartCompactConfigResetOptions extends SmartBoundaryConfigOptions {
  target?: SmartCompactConfigResetTarget;
}

export interface SmartCompactConfigPatch {
  boundaryTokens?: number;
  intervalTokens?: number;
}

export interface SmartBoundaryConfigReadResult {
  /** Boundary token count. Kept as `tokens` for call-site compatibility with upstream. */
  tokens: number;
  boundaryTokens: number;
  intervalTokens: number;
  /** Provenance of the boundary value. */
  source: "default" | "custom";
  /** Provenance of the escalation interval value. */
  intervalSource: "default" | "custom";
  warning?: string;
}

export interface SmartBoundaryConfigStore {
  read(options?: SmartBoundaryConfigOptions): Promise<SmartBoundaryConfigReadResult>;
  write(
    patch: number | SmartCompactConfigPatch,
    options?: SmartBoundaryConfigOptions,
  ): Promise<SmartBoundaryConfigReadResult>;
  reset(options?: SmartCompactConfigResetOptions): Promise<SmartBoundaryConfigReadResult>;
}

interface OnDiskSmartCompactConfig {
  smartBoundaryTokens?: unknown;
  boundaryTokens?: unknown;
  tokens?: unknown;
  escalationIntervalTokens?: unknown;
  intervalTokens?: unknown;
}

export function createSmartBoundaryConfig(options: SmartBoundaryConfigOptions = {}): SmartBoundaryConfigStore {
  return {
    read: (overrideOptions = {}) => readSmartBoundaryConfig(mergeOptions(options, overrideOptions)),
    write: (patch, overrideOptions = {}) => writeSmartBoundaryConfig(patch, mergeOptions(options, overrideOptions)),
    reset: (overrideOptions = {}) =>
      resetSmartBoundaryConfig({ ...mergeOptions(options, overrideOptions), target: overrideOptions.target }),
  };
}

export const createConfigStore = createSmartBoundaryConfig;

export async function readSmartBoundaryConfig(
  options: SmartBoundaryConfigOptions = {},
): Promise<SmartBoundaryConfigReadResult> {
  const filePath = resolveSmartBoundaryConfigPath(options);
  const loaded = await loadOnDiskConfig(filePath);

  if (loaded.warning !== undefined) {
    return defaultResult(loaded.warning);
  }

  const parsed = loaded.config;
  if (parsed === undefined) {
    return defaultResult();
  }

  const boundaryTokens = extractBoundaryTokens(parsed);
  const intervalTokens = extractIntervalTokens(parsed);

  if (boundaryTokens === undefined && intervalTokens === undefined) {
    return defaultResult(
      `Could not read smart-compact config at ${filePath}: no positive whole-number boundary or escalation interval.`,
    );
  }

  return buildResult(boundaryTokens, intervalTokens);
}

export async function writeSmartBoundaryConfig(
  patch: number | SmartCompactConfigPatch,
  options: SmartBoundaryConfigOptions = {},
): Promise<SmartBoundaryConfigReadResult> {
  const normalized = typeof patch === "number" ? { boundaryTokens: patch } : patch;

  if (normalized.boundaryTokens !== undefined) {
    assertPositiveWholeTokens(normalized.boundaryTokens, "Smart boundary");
  }
  if (normalized.intervalTokens !== undefined) {
    assertPositiveWholeTokens(normalized.intervalTokens, "Escalation interval");
  }

  const filePath = resolveSmartBoundaryConfigPath(options);
  const existing = (await loadOnDiskConfig(filePath)).config;

  const boundaryTokens = normalized.boundaryTokens ?? extractBoundaryTokens(existing);
  const intervalTokens = normalized.intervalTokens ?? extractIntervalTokens(existing);

  await persistConfig(filePath, boundaryTokens, intervalTokens);
  return buildResult(boundaryTokens, intervalTokens);
}

export async function resetSmartBoundaryConfig(
  options: SmartCompactConfigResetOptions = {},
): Promise<SmartBoundaryConfigReadResult> {
  const filePath = resolveSmartBoundaryConfigPath(options);
  const target = options.target ?? "all";

  if (target !== "all") {
    const existing = (await loadOnDiskConfig(filePath)).config;
    const boundaryTokens = target === "boundary" ? undefined : extractBoundaryTokens(existing);
    const intervalTokens = target === "interval" ? undefined : extractIntervalTokens(existing);

    if (boundaryTokens === undefined && intervalTokens === undefined) {
      return removeConfigFile(filePath);
    }

    try {
      await persistConfig(filePath, boundaryTokens, intervalTokens);
    } catch (error) {
      return buildResult(
        boundaryTokens,
        intervalTokens,
        `Could not update smart-compact config at ${filePath}: ${errorMessage(error)}.`,
      );
    }

    return buildResult(boundaryTokens, intervalTokens);
  }

  return removeConfigFile(filePath);
}

export function resolveSmartBoundaryConfigPath(options: SmartBoundaryConfigOptions = {}): string {
  return (
    options.configPath ??
    options.path ??
    process.env[SMART_BOUNDARY_CONFIG_ENV] ??
    nodePath.join(process.env.XDG_CONFIG_HOME ?? nodePath.join(os.homedir(), ".config"), PACKAGE_NAME, "config.json")
  );
}

async function removeConfigFile(filePath: string): Promise<SmartBoundaryConfigReadResult> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      return defaultResult(`Could not remove smart-compact config at ${filePath}: ${errorMessage(error)}. Using defaults.`);
    }
  }

  return defaultResult();
}

async function loadOnDiskConfig(
  filePath: string,
): Promise<{ config?: OnDiskSmartCompactConfig; warning?: string }> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as OnDiskSmartCompactConfig;

    if (!parsed || typeof parsed !== "object") {
      return { warning: `Could not read smart-compact config at ${filePath}: not a JSON object. Using defaults.` };
    }

    return { config: parsed };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    return { warning: `Could not read smart-compact config at ${filePath}: ${errorMessage(error)}. Using defaults.` };
  }
}

async function persistConfig(
  filePath: string,
  boundaryTokens: number | undefined,
  intervalTokens: number | undefined,
): Promise<void> {
  await mkdir(nodePath.dirname(filePath), { recursive: true });

  const tempPath = nodePath.join(
    nodePath.dirname(filePath),
    `${nodePath.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const payload = `${JSON.stringify(
    {
      ...(boundaryTokens === undefined ? {} : { smartBoundaryTokens: boundaryTokens }),
      ...(intervalTokens === undefined ? {} : { escalationIntervalTokens: intervalTokens }),
    },
    null,
    2,
  )}\n`;

  try {
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function mergeOptions(
  base: SmartBoundaryConfigOptions,
  override: SmartBoundaryConfigOptions,
): SmartBoundaryConfigOptions {
  return { ...base, ...override };
}

function extractBoundaryTokens(config: OnDiskSmartCompactConfig | undefined): number | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const candidate = config.smartBoundaryTokens ?? config.boundaryTokens ?? config.tokens;
  return isPositiveWholeNumber(candidate) ? candidate : undefined;
}

function extractIntervalTokens(config: OnDiskSmartCompactConfig | undefined): number | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const candidate = config.escalationIntervalTokens ?? config.intervalTokens;
  return isPositiveWholeNumber(candidate) ? candidate : undefined;
}

function assertPositiveWholeTokens(tokens: number, label: string): void {
  if (!isPositiveWholeNumber(tokens)) {
    throw new RangeError(`${label} must be a positive whole-number token count.`);
  }
}

function isPositiveWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function buildResult(
  boundaryTokens: number | undefined,
  intervalTokens: number | undefined,
  warning?: string,
): SmartBoundaryConfigReadResult {
  const boundary = boundaryTokens ?? DEFAULT_SMART_BOUNDARY_TOKENS;
  const interval = intervalTokens ?? DEFAULT_ESCALATION_INTERVAL_TOKENS;

  return {
    tokens: boundary,
    boundaryTokens: boundary,
    intervalTokens: interval,
    source: boundaryTokens === undefined ? "default" : "custom",
    intervalSource: intervalTokens === undefined ? "default" : "custom",
    ...(warning ? { warning } : {}),
  };
}

function defaultResult(warning?: string): SmartBoundaryConfigReadResult {
  return buildResult(undefined, undefined, warning);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
