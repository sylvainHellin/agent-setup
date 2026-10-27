/**
 * /branch [name]
 *
 * Opens a side quest: forks the current session (`pi --fork <session file>`)
 * into a new herdr tab in the current workspace, in the same cwd, so a tangent
 * gets the full context without landing in the main conversation.
 * The fork restores model, thinking level and extension state from the
 * session entries, so no flags are passed for them.
 * The optional argument becomes the new session name (`--name`) and the tab
 * label, and, slugged, the herdr agent name shown in the sidebar.
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_AGENT = "branch";

/** herdr agent names: lowercase letter first, then [a-z0-9_-], 1-32 chars. */
function slug(text: string): string {
	let s = text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");
	if (!/^[a-z]/.test(s)) s = s ? `b-${s}` : DEFAULT_AGENT;
	return s.slice(0, 32).replace(/[-_]+$/, "");
}

function parseJson(text: string): any {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	const herdr = (args: string[], timeout = 15000) => pi.exec("herdr", args, { timeout });

	async function uniqueAgentName(base: string): Promise<string> {
		const res = await herdr(["agent", "list"]);
		const taken = new Set<string>(
			(parseJson(res.stdout)?.result?.agents ?? []).map((a: any) => a.name).filter(Boolean),
		);
		if (!taken.has(base)) return base;
		for (let i = 2; ; i++) {
			const suffix = `-${i}`;
			const candidate = base.slice(0, 32 - suffix.length) + suffix;
			if (!taken.has(candidate)) return candidate;
		}
	}

	pi.registerCommand("branch", {
		description: "Fork this session into a new herdr tab for a side quest; optional arg names it",
		handler: async (args, ctx) => {
			const fail = (msg: string) => ctx.ui.notify(`/branch: ${msg}`, "error");

			if (process.env.HERDR_ENV !== "1") return fail("not running inside a herdr pane.");
			const sm = ctx.sessionManager;
			const file = sm.getSessionFile();
			if (!file || !existsSync(file)) {
				return fail("this session has no file on disk yet (ephemeral, or nothing answered so far).");
			}

			const given = args.trim();
			const parentName = sm.getSessionName();
			// Without --name the fork inherits the parent's name, which makes the two indistinguishable in /resume.
			const sessionName = given || (parentName ? `${parentName} (branch)` : undefined);
			const agentName = await uniqueAgentName(given ? slug(given) : DEFAULT_AGENT);

			const workspace = process.env.HERDR_WORKSPACE_ID;
			const tab = await herdr([
				"tab",
				"create",
				...(workspace ? ["--workspace", workspace] : []),
				"--cwd",
				ctx.cwd,
				"--label",
				sessionName ?? agentName,
				"--focus",
			]);
			const created = parseJson(tab.stdout)?.result;
			const tabId: string | undefined = created?.tab?.tab_id;
			const paneId: string | undefined = created?.root_pane?.pane_id;
			if (tab.code !== 0 || !paneId) {
				return fail(`tab create failed: ${(tab.stderr || tab.stdout || `exit ${tab.code}`).trim()}`);
			}

			const piArgs = ["--fork", file, ...(sessionName ? ["--name", sessionName] : [])];
			const start = await herdr(["agent", "start", agentName, "--kind", "pi", "--pane", paneId, "--", ...piArgs], 60000);
			if (start.code !== 0 || parseJson(start.stdout)?.error) {
				await herdr(tabId ? ["tab", "close", tabId] : ["pane", "close", paneId]);
				return fail(`could not start pi: ${(start.stderr || start.stdout || `exit ${start.code}`).trim()}`);
			}

			const busy = ctx.isIdle() ? "" : " The current turn is still running; the branch starts from its last saved message.";
			ctx.ui.notify(`/branch: side quest "${sessionName ?? agentName}" open in tab ${tabId ?? paneId}.${busy}`, "info");
		},
	});
}
