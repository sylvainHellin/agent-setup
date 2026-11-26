// Worktrunk activity tracking extension for Pi (earendil-works/pi).
//
// Tracks agent activity per branch, showing status markers in `wt list`:
//   🤖 : agent is working
//   💬 : agent is waiting for input
//
// Fork of the file `wt config plugins pi install` writes (wt v0.81): that
// command overwrites this file, so do not run it; after a `wt` upgrade, diff
// its output against this file by hand.
// The one change: a repo without a remote gets no marker. `wt` stores the
// marker in `.git/config`, and a repo without a remote is often a local
// folder whose `.git` a file-sync tool mirrors between machines, where a
// session on each machine turns every marker write into a conflict copy.
//
// Pi loads user extensions from `~/.pi/agent/extensions/*.ts` (or
// `$PI_CODING_AGENT_DIR/extensions/`) and hands each factory an
// `ExtensionAPI`. oh-my-pi is a different agent with a different loader and
// API; see `dev/omp-hook.ts` and `wt config plugins omp install`.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function worktrunkActivity(pi: ExtensionAPI): void {
  // Asked once per directory: a session does not gain or lose a remote often
  // enough to pay a `git remote` on every agent turn.
  const tracked = new Map<string, Promise<boolean>>();
  const hasRemote = (cwd: string): Promise<boolean> => {
    let answer = tracked.get(cwd);
    if (!answer) {
      answer = pi
        .exec("git", ["remote"], { cwd, timeout: 5000 })
        .then((r) => r.code === 0 && r.stdout.trim() !== "")
        .catch(() => false);
      tracked.set(cwd, answer);
    }
    return answer;
  };

  const run = async (
    cwd: string,
    args: ["set", string] | ["clear"],
  ): Promise<void> => {
    try {
      if (!(await hasRemote(cwd))) return;
      await pi.exec("wt", ["config", "state", "marker", ...args], { cwd });
    } catch {
      // Activity tracking must never interrupt the host Pi session.
    }
  };

  pi.on("agent_start", async (_event, ctx) => {
    await run(ctx.cwd, ["set", "🤖"]);
  });

  // `agent_end` is not the end: Pi may auto-retry, auto-compact and retry, or
  // pick up a queued follow-up message. `agent_settled` is the event Pi
  // documents for status integrations: it fires once Pi will not continue
  // running on its own.
  pi.on("agent_settled", async (_event, ctx) => {
    await run(ctx.cwd, ["set", "💬"]);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await run(ctx.cwd, ["clear"]);
  });
}
