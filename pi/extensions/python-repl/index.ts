/**
 * python: a persistent IPython kernel per pi session.
 *
 * Variables, imports and loaded data survive between calls, so an analysis
 * loads its data once and each follow-up question costs a few lines instead
 * of a fresh heredoc script that re-parses everything.
 *
 * Shape: this file spawns `bridge.py` under `uv run` with a fixed library set
 * and talks JSON lines over its stdin/stdout; the bridge drives the kernel
 * with jupyter_client. The kernel starts lazily on the first call, in the
 * session's cwd, and stops on session shutdown or `/python-reset`.
 *
 * Timeouts: the bridge interrupts the cell at `timeout` and restarts the
 * kernel if the interrupt does not land within 10 s. An aborted tool call
 * (Esc) sends SIGINT to the kernel directly. A watchdog kills the bridge if
 * it stops answering altogether.
 *
 * The library set is fixed on purpose. Add to LIBRARIES when a library is
 * needed often; one-off needs go through `uv run --with <pkg>` in bash.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  highlightCode,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const TOOL = "python";
const PYTHON_VERSION = "3.13";
const LIBRARIES = [
  "ipykernel",
  "jupyter-client",
  "polars",
  "duckdb",
  "pandas",
  "pyarrow",
  "openpyxl",
  "matplotlib",
  "pyyaml",
  "rdflib",
];
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 3600;
const START_TIMEOUT_MS = 300_000;
// Bridge-side interrupt grace (10 s) plus a kernel restart.
const WATCHDOG_SLACK_MS = 60_000;

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "bridge.py");

const parameters = Type.Object({
  code: Type.String({
    description:
      "Python source for the persistent IPython kernel. The value of the last expression is returned; print() for anything else. IPython syntax works (`!cmd`, `%timeit`).",
  }),
  timeout: Type.Optional(
    Type.Number({
      description: `Seconds before the cell is interrupted (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}). Variables survive an interrupt.`,
    }),
  ),
});

const outputSchema = Type.Object({
  status: Type.String({ description: "ok, error, timeout, or restarted (kernel state lost)" }),
  output: Type.String({ description: "stdout, stderr and displayed objects, in order" }),
  result: Type.Union([Type.String(), Type.Null()], { description: "repr of the last expression" }),
  error: Type.Union([
    Type.Object({ ename: Type.String(), evalue: Type.String(), traceback: Type.String() }),
    Type.Null(),
  ]),
  images: Type.Number({ description: "number of images attached to the model-facing result" }),
  execution_count: Type.Union([Type.Number(), Type.Null()]),
  full_output_path: Type.Union([Type.String(), Type.Null()], {
    description: "file holding the complete output when the model-facing text was truncated",
  }),
});

type BridgeReply = {
  id: number;
  status: "ok" | "error" | "timeout" | "restarted";
  execution_count: number | null;
  output: string;
  output_capped: boolean;
  result: string | null;
  images: { mime: string; data: string }[];
  error: { ename: string; evalue: string; traceback: string } | null;
  duration_ms: number;
  kernel_pid: number | null;
};

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r\n?/g, "\n");

class Kernel {
  private proc: ChildProcess;
  private pending = new Map<number, (reply: BridgeReply | Error) => void>();
  private nextId = 1;
  private stderrTail = "";
  readonly ready: Promise<void>;
  pid: number | null = null;
  exited = false;

  constructor(cwd: string) {
    const args = ["run", "--quiet", "--no-project", "--python", PYTHON_VERSION];
    for (const lib of LIBRARIES) args.push("--with", lib);
    args.push("python", BRIDGE);
    this.proc = spawn("uv", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
    });

    let markReady: () => void;
    let failStart: (err: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failStart = reject;
    });
    const startTimer = setTimeout(() => {
      failStart(new Error(`Python kernel did not start within ${START_TIMEOUT_MS / 1000}s`));
      this.kill();
    }, START_TIMEOUT_MS);

    createInterface({ input: this.proc.stdout! }).on("line", (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        this.pid = msg.kernel_pid ?? null;
        clearTimeout(startTimer);
        markReady();
        return;
      }
      if (typeof msg.kernel_pid === "number") this.pid = msg.kernel_pid;
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg as BridgeReply);
      }
    });

    const onGone = (why: string) => {
      if (this.exited) return;
      this.exited = true;
      clearTimeout(startTimer);
      const err = new Error(`Python kernel ${why}. ${this.stderrTail.trim()}`.trim());
      failStart(err);
      for (const resolve of this.pending.values()) resolve(err);
      this.pending.clear();
    };
    this.proc.on("exit", (code, signal) => onGone(`exited (${signal ?? code})`));
    this.proc.on("error", (err) => onGone(`failed to spawn: ${err.message}`));
  }

  execute(code: string, timeoutS: number, signal?: AbortSignal): Promise<BridgeReply> {
    const id = this.nextId++;
    return new Promise<BridgeReply>((resolve, reject) => {
      const onAbort = () => this.interrupt();
      const watchdog = setTimeout(() => {
        this.kill();
      }, timeoutS * 1000 + WATCHDOG_SLACK_MS);
      this.pending.set(id, (reply) => {
        clearTimeout(watchdog);
        signal?.removeEventListener("abort", onAbort);
        reply instanceof Error ? reject(reply) : resolve(reply);
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.proc.stdin!.write(JSON.stringify({ id, op: "execute", code, timeout: timeoutS }) + "\n");
    });
  }

  interrupt() {
    if (this.pid) {
      try {
        process.kill(this.pid, "SIGINT");
      } catch {}
    }
  }

  async shutdown() {
    if (this.exited) return;
    try {
      this.proc.stdin!.write(JSON.stringify({ op: "shutdown" }) + "\n");
      this.proc.stdin!.end();
    } catch {}
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.kill();
        resolve();
      }, 5000);
      this.proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  kill() {
    if (this.pid) {
      try {
        process.kill(this.pid, "SIGKILL");
      } catch {}
    }
    this.proc.kill("SIGKILL");
  }
}

// A reload replaces the extension runtime but keeps the pi process, so the live
// kernel is parked here on `session_shutdown` (reason "reload") and adopted by
// the next runtime of the same session: variables survive /reload.
type Handoff = { sessionId: string; kernel: Kernel };
const HANDOFF_KEY = Symbol.for("pi.python-repl.handoff");
const handoffSlot = globalThis as unknown as { [HANDOFF_KEY]?: Handoff };

const LOST_NOTICE = "[the previous kernel had exited; this is a fresh kernel and earlier variables are gone]";
const RESTART_NOTICE =
  "[fresh kernel: pi restarted or switched sessions since the earlier python calls in this conversation, so their variables are gone]";

export default function pythonReplExtension(pi: ExtensionAPI): void {
  let kernel: Kernel | null = null;
  // Notice to prepend to the next result when the kernel is not the one earlier calls used.
  let notice: string | null = null;

  const getKernel = async (cwd: string) => {
    if (kernel?.exited) {
      kernel = null;
      notice = LOST_NOTICE;
    }
    if (!kernel) kernel = new Kernel(cwd);
    const k = kernel;
    try {
      await k.ready;
    } catch (err) {
      if (kernel === k) kernel = null;
      throw err;
    }
    return k;
  };

  const stop = async () => {
    const k = kernel;
    kernel = null;
    notice = null;
    await k?.shutdown();
  };

  pi.registerTool({
    name: TOOL,
    label: "Python",
    description: [
      "Run Python in a persistent IPython kernel that lives for the whole session, started in the session's working directory.",
      "Variables, imports and loaded data persist between calls: load data once, then explore it in small follow-up cells.",
      "Preloaded: `pl` (polars), `pd` (pandas), `np` (numpy), `duckdb`; also installed: pyarrow, openpyxl, matplotlib (figures come back as images), pyyaml, rdflib.",
      "duckdb queries JSON/JSONL/CSV/Parquet/xlsx files directly: duckdb.sql(\"select ... from read_json_auto('x.jsonl')\").pl().",
      "The library set is fixed; for anything else use `uv run --with <pkg>` in bash.",
      `Output is truncated to the last ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; the full text is then saved to a file.`,
    ].join(" "),
    parameters,
    outputSchema,
    executionMode: "sequential",

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const code = String(args?.code ?? "").replace(/^\n+/, "").replace(/\n+$/, "");
      const lines = highlightCode(code, "python");
      const shown = context.expanded ? lines : lines.slice(0, 12);
      const more = lines.length - shown.length;
      const prompt = theme.fg("accent", theme.bold(">>>"));
      text.setText(
        [
          ...shown.map((l, i) => `${i === 0 ? prompt : theme.fg("muted", "...")} ${l}`),
          ...(more > 0 ? [theme.fg("muted", `    … ${more} more lines`)] : []),
        ].join("\n"),
      );
      return text;
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("aborted");
      const timeoutS = Math.min(Math.max(params.timeout ?? DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S);
      const k = await getKernel(ctx.cwd);
      const notices: string[] = [];
      if (notice) {
        notices.push(notice);
        notice = null;
      }
      const reply = await k.execute(params.code, timeoutS, signal);

      const output = stripAnsi(reply.output);
      const result = reply.result === null ? null : stripAnsi(reply.result);
      const error = reply.error ? { ...reply.error, traceback: stripAnsi(reply.error.traceback) } : null;

      const sections: string[] = [...notices];
      if (output.trim()) sections.push(output.replace(/\n+$/, ""));
      if (result !== null) sections.push(`Out[${reply.execution_count ?? "?"}]: ${result}`);
      if (error) sections.push(error.traceback.trim() || `${error.ename}: ${error.evalue}`);
      if (reply.status === "timeout") sections.push(`[interrupted after ${timeoutS}s; kernel state kept]`);
      if (reply.status === "restarted") {
        sections.push(`[cell did not stop after the interrupt; the kernel was restarted and all variables are gone]`);
      }
      if (reply.output_capped) sections.push("[output capped at 4M characters by the kernel bridge]");
      if (reply.images.length) sections.push(`[${reply.images.length} image(s) attached]`);
      const full = sections.join("\n") || "[no output]";

      let text = full;
      let fullOutputPath: string | null = null;
      const truncation = truncateTail(full);
      if (truncation.truncated) {
        const dir = await mkdtemp(path.join(tmpdir(), "pi-python-"));
        fullOutputPath = path.join(dir, "output.txt");
        await writeFile(fullOutputPath, full, "utf8");
        text =
          `[output truncated to the last ${truncation.outputLines} of ${truncation.totalLines} lines; full output: ${fullOutputPath}]\n` +
          truncation.content;
      }

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        { type: "text", text },
      ];
      for (const img of reply.images) content.push({ type: "image", data: img.data, mimeType: img.mime });

      return {
        content,
        details: { status: reply.status, execution_count: reply.execution_count, duration_ms: reply.duration_ms },
        isError: reply.status !== "ok",
        structuredContent: {
          status: reply.status,
          output,
          result,
          error,
          images: reply.images.length,
          execution_count: reply.execution_count,
          full_output_path: fullOutputPath,
        },
      };
    },
  });

  pi.registerCommand("python-reset", {
    description: "Stop the Python kernel; the next python call starts a fresh one",
    handler: async (_args, ctx) => {
      const had = kernel !== null;
      await stop();
      ctx.ui.notify(had ? "Python kernel stopped." : "No Python kernel was running.", "info");
    },
  });

  pi.on("session_start", async (event, ctx) => {
    const parked = handoffSlot[HANDOFF_KEY];
    delete handoffSlot[HANDOFF_KEY];
    const sessionId = ctx.sessionManager.getSessionId();
    if (parked && !parked.kernel.exited && event.reason === "reload" && parked.sessionId === sessionId) {
      kernel = parked.kernel;
      return;
    }
    await parked?.kernel.shutdown();
    // No live kernel: if this conversation already ran python, the next call must say its state is gone.
    const ranPython = ctx.sessionManager
      .getBranch()
      .some((e: any) => e.type === "message" && e.message?.role === "toolResult" && e.message?.toolName === TOOL);
    notice = ranPython ? RESTART_NOTICE : null;
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "reload" && kernel && !kernel.exited) {
      handoffSlot[HANDOFF_KEY] = { sessionId: ctx.sessionManager.getSessionId(), kernel };
      kernel = null;
      return;
    }
    await stop();
  });
}
