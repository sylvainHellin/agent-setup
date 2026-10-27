/**
 * browser_execute: one browser primitive, off by default.
 *
 * The agent writes a JavaScript snippet that runs in the pi process with a
 * long-lived Chrome DevTools Protocol `session` bound into scope. One tool call
 * drives a whole multi-step sequence (navigate, click, type, read, screenshot)
 * at raw CDP level, instead of one CLI round-trip per action, for example to
 * repair a browser automation script after a site's DOM drifts in one call
 * rather than twenty snapshot-click round-trips, each dumping an accessibility
 * tree into context. Ported from browser-use/browsercode (MIT); see cdp/PROVENANCE.md.
 *
 * Deactivation contract:
 *   1. `browser_execute` is registered unconditionally, so it always shows in
 *      `pi.getAllTools()`.
 *   2. On `session_start` it is removed from the active set, so a normal
 *      session never carries its schema or pays for it in the prompt.
 *   3. `/browser` shows state, `/browser on` re-adds just this one name to the
 *      active set for the session, `/browser off` removes it again. Only ever
 *      this one name is mutated, so other extensions' tools are never clobbered.
 *   4. `--browser` skips the session_start deactivation so `pi --browser -p '…'`
 *      works headlessly, where a slash command cannot run. Keep `--browser`
 *      before `-p` or pi reads it as the prompt value (`pi -p '…' --browser`
 *      also works).
 *
 * Prompt-cost rule: the tool carries only a `description`, no `promptSnippet`
 * and no `promptGuidelines`. Activating a tool with either rebuilds the system
 * prompt and invalidates the provider's cached prefix; the usage guidance lives
 * in a `cdp` skill instead.
 *
 * Lazy-load: the CDP layer (cdp/generated.ts is ~14k lines / 655 KB) is never
 * imported at module scope. `./execute.ts` is dynamically imported inside the
 * tool's `execute()` on first call only, then cached, so an inactive session
 * pays nothing for it.
 */

import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JsonObject, JsonValue } from "@earendil-works/pi-ai";

const TOOL = "browser_execute";

// Field order matters: providers stream tool-call args in schema-declared
// order, so the model commits to whichever field comes first. `code` is the
// substantive output; `description` is a summary written after the code exists,
// mirroring the shell tool's `command` → … → `description` shape.
const parameters = Type.Object({
  code: Type.String({
    description:
      "The JavaScript snippet to execute. `session` (CDP Session) and `console` are in scope; see the `web/cdp` skill for the snippet model.",
  }),
  timeout: Type.Optional(
    Type.Number({
      description: `Optional timeout in milliseconds (default ${60 * 1000}, max ${10 * 60 * 1000})`,
    }),
  ),
  description: Type.String({
    description:
      "Clear, concise description of what this snippet does in 3-7 words. Examples:\nInput: code that connects to local Chrome\nOutput: Connect to local Chrome\n\nInput: scrape product titles from current page\nOutput: Scrape product titles\n\nInput: capture a screenshot of the homepage\nOutput: Screenshot homepage",
  }),
});

// What programmatic callers such as codemode scripts receive instead of the
// text content: the model still gets `content`. Returned on success and, with
// `isError: true`, when the snippet threw or timed out. Screenshots are image
// blocks a codemode script can pass straight to `image()`.
const outputSchema = Type.Object({
  output: Type.String({
    description: "Captured console.log/info/warn/error/debug output, untruncated",
  }),
  result: Type.Optional(
    Type.Unknown({
      description: "The snippet's return value as JSON (undefined becomes null); absent on error",
    }),
  ),
  screenshots: Type.Array(
    Type.Object({
      type: Type.Literal("image"),
      data: Type.String({ description: "Base64 image data" }),
      mimeType: Type.Union([
        Type.Literal("image/png"),
        Type.Literal("image/jpeg"),
        Type.Literal("image/webp"),
      ]),
    }),
    { description: "Every Page.captureScreenshot result of this call, in order; pass one to image()" },
  ),
  error: Type.Optional(
    Type.Object(
      {
        kind: Type.Union([Type.Literal("timeout"), Type.Literal("threw")]),
        message: Type.String({ description: "The snippet's error with stack, or the timeout notice" }),
        timeout_ms: Type.Optional(Type.Number()),
      },
      { description: "Present when the snippet threw or timed out" },
    ),
  ),
});

const imageBlocks = (shots: readonly { mime: string; base64: string }[]) =>
  shots.map((s) => ({ type: "image" as const, data: s.base64, mimeType: s.mime }));

// The runner serializes the return value to JSON text; hand scripts the value.
const parseResult = (serialized: string): JsonValue => {
  try {
    return JSON.parse(serialized);
  } catch {
    return serialized;
  }
};

// Lazily imported CDP snippet runner. Kept out of module scope so the 655 KB
// generated CDP bindings are only parsed once the tool is actually called.
let executeModule: typeof import("./execute.ts") | undefined;
async function loadExecute(): Promise<typeof import("./execute.ts")> {
  if (!executeModule) {
    executeModule = await import("./execute.ts");
  }
  return executeModule;
}

export default function browserExecuteExtension(pi: ExtensionAPI): void {
  pi.registerFlag("browser", {
    description: "Activate the browser_execute tool for this run (also usable headlessly with -p).",
    type: "boolean",
    default: false,
  });

  pi.registerTool({
    name: TOOL,
    label: "Browser Execute",
    description:
      "Run a JavaScript snippet in-process against a long-lived Chrome DevTools Protocol `session` bound into scope, driving a whole multi-step browser sequence (connect, navigate, click, type, read, screenshot) in one call. If a `cdp` skill is installed, read it before the first call in a session.",
    parameters,
    outputSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const { runSnippet, SnippetFailure } = await loadExecute();
      const sessionID = ctx.sessionManager.getSessionId();
      const workspaceDir = path.join(ctx.cwd, ".pi", "browser-workspace");

      let res: Awaited<ReturnType<typeof runSnippet>>;
      try {
        res = await runSnippet(
          { code: params.code, timeout: params.timeout, description: params.description },
          {
            sessionID,
            workspaceDir,
            signal,
            onChunk: (output) => {
              onUpdate?.({ content: [{ type: "text", text: output }], details: {} });
            },
          },
        );
      } catch (err) {
        if (!(err instanceof SnippetFailure)) throw err;
        const structuredContent: JsonObject = {
          output: err.output,
          screenshots: imageBlocks(err.screenshots),
          error: {
            kind: err.kind,
            message: err.detail,
            ...(err.timeoutMs !== undefined ? { timeout_ms: err.timeoutMs } : {}),
          },
        };
        // Same content and details pi builds for a thrown error, so the model
        // and the renderer see no change; scripts also get the partial data.
        return {
          content: [{ type: "text", text: err.message }],
          details: {},
          isError: true,
          structuredContent,
        };
      }

      const sections: string[] = [];
      if (res.output.trim()) sections.push(res.output.trimEnd());
      sections.push(`Return value: ${res.result}`);
      if (res.screenshots.length > 0) {
        sections.push(
          `Attached ${res.screenshots.length} screenshot${res.screenshots.length === 1 ? "" : "s"} inline.`,
        );
      }

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text: sections.join("\n\n") }];
      for (const shot of res.screenshots) {
        content.push({ type: "image", data: shot.base64, mimeType: shot.mime });
      }

      const structuredContent: JsonObject = {
        output: res.output,
        result: parseResult(res.result),
        screenshots: imageBlocks(res.screenshots),
      };
      return { content, details: { screenshots: res.screenshots.length }, structuredContent };
    },
  });

  // Off by default: drop just this one tool from the active set at the start of
  // every session, unless --browser was passed (a slash command cannot run in a
  // headless `pi -p` run, so the flag is the headless escape hatch).
  pi.on("session_start", async () => {
    if (pi.getFlag("browser")) return;
    const active = pi.getActiveTools();
    if (active.includes(TOOL)) {
      pi.setActiveTools(active.filter((name) => name !== TOOL));
    }
  });

  // Close any CDP sockets when the session shuts down, so a headless
  // `pi -p --browser` run whose snippet left a browser connected still exits
  // cleanly instead of hanging on the open WebSocket. Guarded on the CDP layer
  // already being loaded, so an unused session never imports it here either.
  pi.on("session_shutdown", async () => {
    if (!executeModule) return;
    const store = await import("./session-store.ts");
    store.closeAll();
  });

  pi.registerCommand("browser", {
    description: "Show or toggle the browser_execute tool for this session. Subcommands: on, off.",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
      const sub = (args ?? "").trim().toLowerCase();
      const isRegistered = () => pi.getAllTools().some((t) => t.name === TOOL);

      if (sub === "on") {
        if (!isRegistered()) {
          ctx.ui.notify("browser_execute is not registered; the extension did not load.", "warning");
          return;
        }
        const active = pi.getActiveTools();
        if (active.includes(TOOL)) {
          ctx.ui.notify("browser_execute is already on for this session.", "info");
          return;
        }
        pi.setActiveTools([...active, TOOL]);
        ctx.ui.notify("browser_execute on for this session. Read the web/cdp skill first.", "info");
        return;
      }

      if (sub === "off") {
        const active = pi.getActiveTools();
        if (!active.includes(TOOL)) {
          ctx.ui.notify("browser_execute is already off.", "info");
          return;
        }
        pi.setActiveTools(active.filter((name) => name !== TOOL));
        ctx.ui.notify("browser_execute off for this session.", "info");
        return;
      }

      if (sub === "") {
        const on = pi.getActiveTools().includes(TOOL);
        ctx.ui.notify(
          on
            ? "browser_execute is on for this session. /browser off to disable."
            : "browser_execute is off. /browser on to enable, or start with pi --browser -p '…'.",
          "info",
        );
        return;
      }

      ctx.ui.notify(
        [
          "Usage: /browser [on|off]",
          "",
          "  /browser       Show state",
          "  /browser on    Enable for this session",
          "  /browser off   Disable for this session",
        ].join("\n"),
        "info",
      );
    },
  });
}
