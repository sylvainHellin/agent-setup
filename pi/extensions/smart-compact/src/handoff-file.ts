import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import nodePath from "node:path";

import { HANDOFF_DIR_SEGMENTS, HANDOFF_FILE_SUFFIX } from "./constants.js";

export interface HandoffFileWriteInput {
  cwd: string | undefined;
  handoff: string;
  smartCompactionId: string;
  now?: Date;
}

export interface HandoffFileWriteResult {
  /** Absolute path of the written file, absent when the write did not happen. */
  path?: string;
  /** Human-readable reason the durable copy is missing. Never fatal. */
  warning?: string;
}

/** Filesystem-safe ISO 8601 stamp: 2026-08-04T13-45-12Z. */
export function buildHandoffTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

/**
 * Timestamps resolve to whole seconds, so the compaction id is part of the name:
 * two compactions inside the same second must not overwrite each other.
 *
 * The id alone only disambiguates within one process, because it is a
 * per-process counter starting at 1. Concurrent pi-subagents children share
 * the project cwd, so two children compacting in the same second would both
 * build `...-smart-compact-1-...`; the optional disambiguator (the pid, in
 * practice) separates them.
 */
export function buildHandoffFileName(
  now: Date = new Date(),
  smartCompactionId?: string,
  disambiguator?: string,
): string {
  const id = sanitizeFileNameSegment(smartCompactionId);
  const extra = sanitizeFileNameSegment(disambiguator);
  return `${buildHandoffTimestamp(now)}${id ? `-${id}` : ""}${extra ? `-${extra}` : ""}${HANDOFF_FILE_SUFFIX}`;
}

function sanitizeFileNameSegment(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * The nearest `.agents` at or above `cwd`, below the home directory, so a
 * session started in a repo subfolder writes into the repo's synced `.agents`
 * link (code-sync) instead of creating a stray one. Falls back to `cwd`.
 */
export function resolveHandoffDirectory(cwd: string): string {
  const [agents, ...rest] = HANDOFF_DIR_SEGMENTS;
  const home = homedir();
  for (let dir = nodePath.resolve(cwd); dir !== home && dir !== nodePath.dirname(dir); dir = nodePath.dirname(dir)) {
    if (existsSync(nodePath.join(dir, agents))) {
      return nodePath.join(dir, agents, ...rest);
    }
  }
  return nodePath.join(cwd, ...HANDOFF_DIR_SEGMENTS);
}

export function buildHandoffFileContents(input: {
  handoff: string;
  smartCompactionId: string;
  now?: Date;
}): string {
  const timestamp = (input.now ?? new Date()).toISOString();

  return [
    "# Compaction handoff",
    "",
    "Written by the smart-compact extension immediately before same-session compaction.",
    `Timestamp: ${timestamp}`,
    `Compaction id: ${input.smartCompactionId}`,
    "",
    input.handoff.trim(),
    "",
  ].join("\n");
}

/**
 * Write the agent-authored handoff to `.agents/handoff/` (see resolveHandoffDirectory).
 *
 * The durable copy is a best-effort belt to the compaction summary's braces:
 * a failed write is reported through `warning` and must never abort compaction.
 */
export async function writeHandoffFile(input: HandoffFileWriteInput): Promise<HandoffFileWriteResult> {
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  if (!cwd) {
    return { warning: "No project working directory was available, so no durable handoff file was written." };
  }

  const now = input.now ?? new Date();
  const directory = resolveHandoffDirectory(cwd);
  const contents = buildHandoffFileContents({ ...input, now });

  // `wx` makes every collision loud instead of a silent overwrite; the pid
  // retry then separates concurrent processes, whose per-process compaction
  // counters produce identical base names.
  const candidates = [
    buildHandoffFileName(now, input.smartCompactionId),
    buildHandoffFileName(now, input.smartCompactionId, `pid${process.pid}`),
  ];

  let filePath = nodePath.join(directory, candidates[0]);

  try {
    await mkdir(directory, { recursive: true });
    for (const [index, name] of candidates.entries()) {
      filePath = nodePath.join(directory, name);
      try {
        await writeFile(filePath, contents, { encoding: "utf8", flag: "wx" });
        return { path: filePath };
      } catch (error) {
        const lastCandidate = index === candidates.length - 1;
        if (!isFileExistsError(error) || lastCandidate) {
          throw error;
        }
      }
    }
    throw new Error("no candidate file name could be written");
  } catch (error) {
    return {
      warning: `Could not write the durable handoff file to ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    };
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}
