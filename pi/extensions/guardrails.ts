/**
 * Guardrails Extension
 *
 * Three-tier model for intercepting bash commands:
 *   1. Hard block: bare pip/pip3 install/uninstall (always wrong given uv workflow)
 *   2. Prompt for confirmation: all other package management operations
 *   3. Prompt for confirmation: destructive file/system operations
 *      (rm -rf, chmod -R 777, dd to disk, mkfs, diskutil, rsync --delete,
 *      find -delete, docker volume/prune, rclone/aws purge, tmutil delete,
 *      git push --force, crontab -r, etc.)
 *
 * Unrecoverable git working-tree operations (reset --hard, clean -f,
 * checkout --, restore without --staged) are hard-blocked in tier 1.
 * An `rm` whose targets all sit under /tmp, /var/tmp or $TMPDIR passes
 * without a prompt. Without a UI (unattended subagent runs), destructive
 * commands and global installs are blocked; project-local installs run.
 */

import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withQuietSpinner } from "./shared/quiet-ui.js";

// Ask the user to approve a command. Any failure of the UI itself, most often
// a session-bound ctx gone stale after a session replacement, which makes
// ctx.ui throw, returns "unavailable" so the caller can fail closed instead
// of turning the guardrail into a hard tool error.
interface ConfirmCtx {
	hasUI: boolean;
	ui: {
		select(prompt: string, options: string[], opts?: { timeout?: number }): Promise<string | undefined>;
		setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
	};
}

// `hasUI` is session-bound and throws once the ctx is stale, so a plain read is
// not safe inside the hook.
function hasUI(ctx: ConfirmCtx): boolean {
	try {
		return ctx.hasUI;
	} catch {
		return false;
	}
}

// An unanswered prompt is rejected after this long, so an agent never sits for
// hours on an approval nobody is there to give. pi's select() shows the
// countdown in the prompt title and resolves undefined on expiry, the same
// value Escape produces, so expiry is told apart by the time elapsed.
// `PI_GUARDRAILS_CONFIRM_TIMEOUT_MS` overrides it, for live tests.
const CONFIRM_TIMEOUT_MS = Number(process.env.PI_GUARDRAILS_CONFIRM_TIMEOUT_MS) || 5 * 60 * 1000;
const CONFIRM_TIMEOUT_LABEL =
	CONFIRM_TIMEOUT_MS >= 60_000 ? `${Math.round(CONFIRM_TIMEOUT_MS / 60_000)} minutes` : `${Math.round(CONFIRM_TIMEOUT_MS / 1000)} seconds`;

async function confirm(
	ctx: ConfirmCtx,
	prompt: string,
	toolName: string,
): Promise<"yes" | "no" | "timeout" | "unavailable"> {
	const started = Date.now();
	let choice: string | undefined;
	try {
		choice = await withQuietSpinner(
			ctx,
			async () =>
				(choice = await ctx.ui.select(prompt, ["Yes", "No"], { timeout: CONFIRM_TIMEOUT_MS })),
			{ toolName },
		);
		if (choice === "Yes") return "yes";
		// The countdown ticks once a second and only ever runs late, so a 1 s
		// margin cannot mistake an Escape for an expiry.
		if (choice === undefined && Date.now() - started >= CONFIRM_TIMEOUT_MS - 1000) return "timeout";
		return "no";
	} catch (err) {
		// console.error is swallowed by the TUI, so keep a durable trace: which
		// call threw, after how long, and whether an answer had already come back.
		const entry = {
			ts: new Date().toISOString(),
			waitedMs: Date.now() - started,
			answered: choice ?? null,
			toolName,
			error: err instanceof Error ? err.stack : String(err),
		};
		appendFile(CONFIRM_ERROR_LOG, `${JSON.stringify(entry)}\n`).catch(() => {});
		return "unavailable";
	}
}

const CONFIRM_ERROR_LOG = join(homedir(), ".pi", "agent", "guardrails-confirm-errors.jsonl");

const UI_UNAVAILABLE_REASON =
	"blocked: the confirmation prompt could not be shown, so approval could not be obtained. " +
	"This usually means the session context went stale after a session replacement; run /reload, " +
	"or run the command yourself in a shell.";

const TIMEOUT_REASON =
	`blocked: the user did not answer the approval prompt within ${CONFIRM_TIMEOUT_LABEL}, so they are probably not ` +
	"at the computer at the moment. The command was not run. Do not retry it right away: " +
	"carry on with any work that does not depend on it, then end your turn by telling the user the exact " +
	"command still waiting for their approval.";

// Notifications (bell + desktop toast, or herdr's focus-aware toast inside
// herdr) are fired by withQuietSpinner -> notifyInputNeeded on entry; the
// toolName passed below becomes the notification body.

// Tier 1, hard block: bare pip/pip3 outside uv context.
// Negative lookbehind excludes "uv pip install" etc.
const BLOCKED_PATTERN = /(?<!uv )pip3?\s+(install|uninstall)\b/i;

// Tier 1, hard block: unrecoverable git working-tree operations.
// These destroy uncommitted/untracked work that git never recorded, so there
// is no reflog or remote to recover from. Never routine for an agent; blocked
// regardless of UI.
const GIT_BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
	{
		pattern: /git\s+reset\s+--hard(\s|$)/i,
		reason: "git reset --hard blocked: discards uncommitted changes unrecoverably.",
	},
	{
		pattern: /git\s+clean\s+[^;&|]*-[a-z]*f/i,
		reason: "git clean -f blocked: deletes untracked files unrecoverably (use -n to preview).",
	},
	{
		pattern: /git\s+checkout\s+--(\s|$)/i,
		reason: "git checkout -- blocked: discards uncommitted worktree changes unrecoverably.",
	},
];

// Tier 3, plain file deletion: prompt unless every target is under a tmp root.
const DELETION_PATTERNS: RegExp[] = [
	// Recursive / forced file deletion
	/\brm\s+.*-[a-zA-Z-]*r[a-zA-Z-]*f[a-zA-Z-]*(\s|$)/,    // rm -rf, rm -fr, rm -r -f, rm --recursive --force
	/\brm\s+.*-[a-zA-Z-]*f[a-zA-Z-]*r[a-zA-Z-]*(\s|$)/,    // rm -fr variant
	/\brm\s+--recursive\b/,
	/\brm\s+--force\s+--recursive\b/,
	// find recursive deletion: misses the rm patterns above entirely.
	/\bfind\b[^;&|]*-delete\b/i,
	/\bfind\b[^;&|]*-exec\s+rm\b/i,
];

// Tier 3, destructive file/system operations: always prompt.
const DESTRUCTIVE_PATTERNS: RegExp[] = [
	// Wide-open recursive permission changes
	/\bchmod\s+-R\s+(0?777|a+rwx)\b/,
	/\bchown\s+-R\s+\S+\s+\//,                       // chown -R ... /
	// Disk / block device operations
	/\bdd\s+.*of=\/(dev|disk)\b/,
	/\bmkfs\.\w+\s+\//,
	/\bwipefs\s+-[aA]\s+\//,
	/\bshred\s+/,
	// macOS disk management: any diskutil verb except read-only inspection
	// (list, info, activity). Catches eraseDisk, partitionDisk, reformat,
	// zeroDisk, apfs deleteContainer, etc. that can wipe a drive.
	/\bdiskutil\s+(?!(list|info|activity)\b)\S+/i,
	// macOS volume erase/reformat siblings of diskutil/mkfs.
	/\basr\s+(restore|erase)\b/i,
	/\bnewfs_(apfs|hfs)\b/i,
	// `srm` only in command position. A plain \b also matched flag clusters such
	// as `uname -srm`, which blocked harmless commands.
	/(?<![-\w])srm(?=\s|$)/,
	// Time Machine backup deletion: destroys the recovery path.
	/\btmutil\s+delete\b/i,
	// rsync mirror deletion: --delete[-after|-before|-excluded] can wipe a
	// destination tree if the source path is wrong.
	/\brsync\b[^;&|]*--delete/i,
	// Docker persistent-data destruction (named volumes, not throwaway state).
	/\bdocker\s+system\s+prune\b[^;&|]*--volumes\b/i,
	/\bdocker\s+volume\s+rm\b/i,
	/\bdocker(\s+compose|-compose)\s+down\b[^;&|]*(-v\b|--volumes\b)/i,
	// Cloud/remote purge: can empty a remote as fast as a local tree.
	/\brclone\s+(delete|purge|sync)\b/i,
	/\baws\s+s3\s+rm\b[^;&|]*--recursive\b/i,
	/\baws\s+s3\s+rb\b/i,
	// Remote history rewrite (--force also matches --force-with-lease).
	/\bgit\s+push\b[^;&|]*(--force|-f)\b/i,
	// crontab -r wipes the entire crontab, one key away from crontab -e.
	/\bcrontab\s+-[a-z]*r[a-z]*\b/i,
];

// Narrow exemption for Tier 3: an `rm` (including rm -rf) whose targets ALL
// resolve strictly UNDER a throwaway tmp root passes without the destructive
// prompt. Deliberately conservative: on any doubt (relative paths, variables
// other than $TMPDIR, globs, `..` traversal, quoting/escaping, or command
// chaining/redirection) it returns false and the normal gate applies.
function isExemptTmpRm(command: string): boolean {
	const cmd = command.trim();
	// Single, unchained rm only: reject anything that could chain, pipe,
	// redirect, substitute, or expand beyond a plain rm invocation.
	if (/[;&|`\n]|\$\(|<|>/.test(cmd)) return false;
	if (!/^rm\b/.test(cmd)) return false;

	// Allowed throwaway roots. $TMPDIR is honoured only when set to an
	// absolute path; no other variable is trusted.
	const roots = ["/tmp", "/var/tmp"];
	const tmpdir = process.env.TMPDIR;
	if (tmpdir && tmpdir.startsWith("/")) roots.push(tmpdir.replace(/\/+$/, ""));

	// Everything after `rm` that is not a flag is a delete target.
	const targets = cmd
		.split(/\s+/)
		.slice(1)
		.filter((t) => t !== "" && !t.startsWith("-"));
	if (targets.length === 0) return false; // nothing concrete to delete -> gate it

	for (const raw of targets) {
		// Reject any char we will not resolve: variables, globs, brace/home
		// expansion, quotes, backslash escapes.
		if (/[$*?\[\]{}~'"\\]/.test(raw)) return false;
		if (!raw.startsWith("/")) return false; // must be absolute
		const path = raw.replace(/\/+$/, "") || "/";
		if (path.split("/").some((seg) => seg === "..")) return false; // no traversal
		// Must sit strictly UNDER a root, never equal the root itself.
		const under = roots.some((root) => path !== root && (path + "/").startsWith(root + "/"));
		if (!under) return false;
	}
	return true;
}

// Whitelist: commands that match Tier 2 or Tier 3 patterns but are safe to allow.
// Global installs (pnpm/npm -g) are deliberately not listed, so adopting a
// global tool always prompts for approval (Tier 2).
const WHITELIST_PATTERNS: RegExp[] = [
	/\bcargo\s+install\s+--path\s+\.\s*/,
];

// Machine-global installs: blocked outright in unattended (no-UI) runs.
// Project-local installs (uv add / pip install in a venv, npm/pnpm without
// -g) stay allowed there.
const GLOBAL_INSTALL_PATTERNS: RegExp[] = [
	/\bpnpm\s+(add|install)\b[^;&|]*(\s-g\b|--global\b)/i,
	/\bnpm\s+(install|i)\b[^;&|]*(\s-g\b|--global\b)/i,
	/\byarn\s+global\s+add\b/i,
	/\bbun\s+(add|install)\b[^;&|]*(\s-g\b|--global\b)/i,
	/\buv\s+tool\s+install\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bcargo\s+install\b/i,
	/\bapt(-get)?\s+(install|remove|purge)\b/i,
	/\bgem\s+install\b/i,
	/\bgo\s+install\b/i,
];

// Tier 2, prompt for confirmation: all other package managers.
const PROMPT_PATTERNS: RegExp[] = [
	/\bnpm\s+(install|ci|link|uninstall|update)\b/i,
	/\bpnpm\s+(add|install|remove)\b/i,
	/\byarn\s+(add|remove|install)\b/i,
	/\bbun\s+(add|install|remove)\b/i,
	/\buv\s+(add|pip\s+install|pip\s+uninstall)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bcargo\s+install\b/i,
	/\bapt(-get)?\s+(install|remove|purge)\b/i,
	/\bgem\s+install\b/i,
	/\bgo\s+install\b/i,
];

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		if (!command) return undefined;

		// Tier 1, hard block: no prompt, no override.
		if (BLOCKED_PATTERN.test(command)) {
			return {
				block: true,
				reason: "Bare pip/pip3 install blocked. Use uv instead.",
			};
		}

		// Tier 1, hard block: unrecoverable git ops. No prompt, no override.
		// `git restore` is blocked unless it targets the index (--staged).
		for (const { pattern, reason } of GIT_BLOCKED_PATTERNS) {
			if (pattern.test(command)) return { block: true, reason };
		}
		if (/git\s+restore(\s|$)/i.test(command) && !/git\s+restore\s+.*--staged/i.test(command)) {
			return {
				block: true,
				reason: "git restore blocked: discards uncommitted worktree changes unrecoverably (use --staged to unstage).",
			};
		}

		// Whitelist: skip confirmation for known-safe commands.
		if (WHITELIST_PATTERNS.some((p) => p.test(command))) return undefined;

		// Tier 2: prompt for confirmation.
		const isPkg = PROMPT_PATTERNS.some((p) => p.test(command));
		if (isPkg) {
			// No UI (unattended subagent run): block anything that installs
			// outside the project; project-local installs (venv, node_modules)
			// run unattended.
			if (!hasUI(ctx)) {
				if (GLOBAL_INSTALL_PATTERNS.some((p) => p.test(command))) {
					return {
						block: true,
						reason:
							"Global package installation blocked for unattended runs: it changes the machine " +
							"beyond the project. Report the need to the main agent instead; project-local " +
							"installs (venv, node_modules) are allowed.",
					};
				}
				return undefined;
			}

			const choice = await confirm(
				ctx,
				`Package management:\n\n  ${command}\n\nAllow?`,
				"guardrail: confirm package install",
			);

			if (choice === "unavailable") {
				return { block: true, reason: `Package management ${UI_UNAVAILABLE_REASON}` };
			}
			if (choice === "timeout") {
				return { block: true, reason: `Package management ${TIMEOUT_REASON}` };
			}
			if (choice !== "yes") {
				return { block: true, reason: "Package management blocked by user" };
			}

			return undefined;
		}

		// Tier 3, destructive file/system operations: always prompt.
		const isOtherDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
		const isDeletion = DELETION_PATTERNS.some((p) => p.test(command));
		if (isOtherDestructive || isDeletion) {
			// Exemption: throwaway-tmp rm passes without approval.
			if (isExemptTmpRm(command)) return undefined;

			if (!hasUI(ctx)) {
				return { block: true, reason: "Destructive command blocked (no UI for confirmation)." };
			}

			const choice = await confirm(
				ctx,
				`Destructive command:\n\n  ${command}\n\nAllow?`,
				"guardrail: confirm destructive command",
			);

			if (choice === "unavailable") {
				return { block: true, reason: `Destructive command ${UI_UNAVAILABLE_REASON}` };
			}
			if (choice === "timeout") {
				return { block: true, reason: `Destructive command ${TIMEOUT_REASON}` };
			}
			if (choice !== "yes") {
				return { block: true, reason: "Destructive command blocked by user" };
			}

			return undefined;
		}

		return undefined;
	});
}
