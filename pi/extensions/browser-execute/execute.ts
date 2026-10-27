// browser_execute snippet runner (rewritten from browser-use/browsercode
// `src/browser-execute.ts`, MIT).
//
// Executes a JavaScript snippet in-process against a per-pi-session `Session`
// (the CDP transport from `./cdp/session.ts`). No subprocess, no daemon, no
// Unix socket: the snippet is wrapped with `new AsyncFunction("session",
// "console", code)` and run.
//
// Snippet scope:
//   `session`: the live CDP `Session`, persistent across calls.
//   `console`: a per-call capture object shadowing the global via the
//                function's parameter list. JavaScript's scope chain resolves
//                `console.log(...)` to that parameter before reaching the
//                global, so overlapping calls each get their own buffer with no
//                shared state to clobber. This is what makes concurrent calls
//                safe. Do not "improve" it into a global handler.
//   standard JS globals.
//
// Cancellation: JS Promises are not preemptively cancellable. A snippet with
// no `await` yield-point (`for (let i=0;i<1e9;i++){}`) runs to completion
// before the timeout is observed. A yielding snippet keeps running as an orphan
// after timeout, so each call runs inside a scoped execution view: the view
// rejects CDP methods after its deadline while the real Session and its tabs
// remain available to the next call.
//
// Rewrite notes vs upstream:
//   - `effect` (Effect / Schema) dropped; this is plain async/await.
//   - Bun builtins replaced with `node:` builtins.
//   - Browser Use cloud auto-connect (Way 3 / Way 4, V4_RUN_ID, BU_CDP_WS
//     provisioning) removed. Way 1 (attach to running Chrome) and Way 2
//     (attach to a Chrome launched with --remote-debugging-port) remain.
//   - Screenshots are returned to the caller, which attaches each
//     `Page.captureScreenshot` result to the tool result as an inline image.

import { mkdir } from "node:fs/promises";
import { withSessionExecution } from "./cdp/session.ts";
import { SessionStore } from "./session-store.ts";

export const DEFAULT_TIMEOUT_MS = 60 * 1000;
export const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_OUTPUT_BYTES = 8 * 1024;
const TIMEOUT_OUTPUT_TRUNCATED = "[partial console output truncated; showing final bytes]\n";

// Tail-cap the captured output for the timeout error: last 8 KiB, snapped
// forward to a UTF-8 sequence start so multibyte characters survive the cut.
const timeoutOutput = (output: string): string => {
  const bytes = Buffer.from(output, "utf8");
  if (bytes.length <= MAX_TIMEOUT_OUTPUT_BYTES) return output;
  let start = bytes.length - (MAX_TIMEOUT_OUTPUT_BYTES - Buffer.byteLength(TIMEOUT_OUTPUT_TRUNCATED));
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return TIMEOUT_OUTPUT_TRUNCATED + bytes.subarray(start).toString("utf8");
};

export interface RunParams {
  code: string;
  timeout?: number;
  description?: string;
}

export interface RunContext {
  // Identifies the per-pi-session CDP Session to bind into the snippet.
  readonly sessionID: string;
  // Per-cwd workspace dir: <cwd>/.pi/browser-workspace/. Created on first call.
  // A scratch space for notes and draft scripts written with the `write` tool.
  // Note: a snippet's own `await import(...)` fails under pi's jiti-static
  // loader (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING), so these files are a
  // copy-paste source, not an import target. Reuse comes from the persistent
  // `session`, not from re-importing code. See the web/cdp skill.
  readonly workspaceDir: string;
  // pi's abort signal, so Esc cancels the snippet like a timeout does.
  readonly signal?: AbortSignal;
  // Optional progress callback invoked per output chunk (combined console
  // streams). Receives the fully accumulated output so far.
  readonly onChunk?: (output: string) => void;
}

export interface CollectedScreenshot {
  readonly mime: "image/png" | "image/jpeg" | "image/webp";
  readonly base64: string;
}

export interface ExecuteResult {
  readonly output: string;
  // The snippet's `return` value, JSON-serialized when possible. `undefined`
  // serializes as `null`. Non-serializable values fall back to `String(v)`.
  readonly result: string;
  // Every successful `Page.captureScreenshot` made by the snippet, in the order
  // the CDP responses came back. Empty when the snippet took no screenshots.
  readonly screenshots: readonly CollectedScreenshot[];
}

// A failure that still carries data: the console output captured before it
// and any screenshots already taken. `message` is the exact text the model has
// always received for this failure; the caller returns it as an `isError`
// result with the data in `structuredContent`. Cancellation (Esc) and syntax
// errors stay plain `Error`s.
export class SnippetFailure extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "threw",
    // The full captured output (the message carries only its last 8 KiB on timeout).
    readonly output: string,
    readonly screenshots: readonly CollectedScreenshot[],
    // The snippet's error (stack when available), or the timeout notice.
    readonly detail: string,
    readonly timeoutMs?: number,
  ) {
    super(message);
    this.name = "SnippetFailure";
  }
}

const SCREENSHOT_FORMAT_TO_MIME: Record<string, CollectedScreenshot["mime"]> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const screenshotMime = (format: unknown): CollectedScreenshot["mime"] =>
  SCREENSHOT_FORMAT_TO_MIME[typeof format === "string" ? format : "png"] ?? "image/png";

// AsyncFunction is not a global: pull it off an async arrow's constructor.
const AsyncFunction = (async () => {}).constructor as new (
  ...args: string[]
) => (...injected: unknown[]) => Promise<unknown>;

const serialize = (v: unknown): string => {
  if (v === undefined) return "null";
  try {
    return (
      JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2) ?? "null"
    );
  } catch {
    return JSON.stringify(String(v));
  }
};

// Sentinels so the timeout / abort races are distinguishable from a snippet
// that threw. Rejecting with a tagged instance lets the catch below decide.
class TimeoutSignal {
  constructor(readonly ms: number) {}
}
class AbortSignalRejection {}

/**
 * Run one snippet. The CDP Session is resolved per-call from `SessionStore`
 * keyed on `ctx.sessionID`. Local sessions connect explicitly from inside the
 * snippet (`await session.connect(...)`); there is no auto-connect.
 *
 * On timeout or abort the scoped execution view is deactivated (later CDP calls
 * from the orphaned snippet throw), but the real Session and its tabs are left
 * untouched for the next call. The store entry is not evicted.
 */
export async function runSnippet(args: RunParams, ctx: RunContext): Promise<ExecuteResult> {
  const session = SessionStore.get(ctx.sessionID);
  const captured = { active: true, output: "" };
  const sessionExecution = { active: true };
  const timeout = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  await mkdir(ctx.workspaceDir, { recursive: true });

  let wrapped: (...injected: unknown[]) => Promise<unknown>;
  try {
    wrapped = new AsyncFunction("session", "console", args.code);
  } catch (err) {
    throw new Error(`syntax error in browser_execute snippet: ${err}`);
  }

  const tee = (...a: unknown[]) => {
    if (!captured.active) return;
    captured.output += a.map((x) => (typeof x === "string" ? x : serialize(x))).join(" ") + "\n";
    ctx.onChunk?.(captured.output);
  };
  // Prototype-chain to the real `console` so uncommon methods (`dir`, `trace`,
  // `table`, `group`, …) don't throw when a snippet calls them. The five
  // "log line" methods are tee'd into our capture; anything else falls through
  // to the real console, written but not captured.
  const snippetConsole = Object.assign(Object.create(console), {
    log: tee,
    error: tee,
    warn: tee,
    info: tee,
    debug: tee,
  });

  // Screenshot tap. Subscribes to the Session's call-result stream for the
  // duration of this call; every successful `Page.captureScreenshot` is
  // collected so the caller can attach it as an inline image.
  const screenshots: CollectedScreenshot[] = [];
  const unsubscribe = session.onCallResult((method, params, result) => {
    if (method !== "Page.captureScreenshot") return;
    const r = result as { data?: unknown };
    if (typeof r?.data !== "string") return;
    const p = (params ?? {}) as { format?: unknown };
    screenshots.push({ mime: screenshotMime(p.format), base64: r.data });
  });

  // Timeout and abort races. A snippet that yields keeps running as an orphan
  // after either fires; deactivating `sessionExecution` makes its later CDP
  // calls throw without touching the persistent Session.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutSignal(timeout)), timeout);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const sig = ctx.signal;
    if (!sig) return;
    if (sig.aborted) {
      reject(new AbortSignalRejection());
      return;
    }
    sig.addEventListener("abort", () => reject(new AbortSignalRejection()), { once: true });
  });

  const runPromise = (async () =>
    withSessionExecution(sessionExecution, () => wrapped(session, snippetConsole)))();
  // Pre-observe so an orphaned run that later rejects doesn't crash the process
  // with an unhandled rejection after we've already returned/thrown.
  runPromise.catch(() => {});

  try {
    const ran = await Promise.race([runPromise, timeoutPromise, abortPromise]);
    return { output: captured.output, result: serialize(ran), screenshots };
  } catch (err) {
    if (err instanceof TimeoutSignal) {
      captured.active = false;
      sessionExecution.active = false;
      const output = timeoutOutput(captured.output);
      const notice = `browser_execute timed out after ${err.ms} ms; this call can no longer issue CDP commands, but the next browser_execute call receives the unchanged CDP session`;
      throw new SnippetFailure(
        [notice, output.trim() ? `Partial console output before timeout:\n${output.trimEnd()}` : ""]
          .filter(Boolean)
          .join("\n\n"),
        "timeout",
        captured.output,
        [...screenshots],
        notice,
        err.ms,
      );
    }
    if (err instanceof AbortSignalRejection) {
      captured.active = false;
      sessionExecution.active = false;
      const output = timeoutOutput(captured.output);
      throw new Error(
        [
          "browser_execute cancelled; this call can no longer issue CDP commands, but the next browser_execute call receives the unchanged CDP session",
          output.trim() ? `Partial console output before cancel:\n${output.trimEnd()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    throw new SnippetFailure(
      `browser_execute snippet threw: ${detail}`,
      "threw",
      captured.output,
      [...screenshots],
      detail,
    );
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}
