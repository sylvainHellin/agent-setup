/**
 * /branch [name]
 *
 * Opens a side quest: forks the current session (`pi --fork <session file>`)
 * into a new tab of the Herdr desktop app, in the space and cwd of this pi,
 * so a tangent gets the full context without landing in the main conversation.
 * The tab comes from `herdr-app do tab.new`, the same path as a tab the user
 * opens themselves: the app starts pi in their interactive shell, the terminal
 * has no parent (it outlives this pi and its pane), and the new tab is shown.
 * When the side quest's pi exits, the shell stays open in that tab.
 * The fork restores model, thinking level and extension state from the
 * session entries, so no flags are passed for them.
 * The optional argument becomes the new session name (`--name`) and the tab name.
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inHcTerminal, ownPlace, run } from "./shared/hc-pane.js";

const DEFAULT_NAME = "branch";

/** Open `argv` in a new app tab named `name` in this pi's space; resolves the tab id or an error. */
export async function openBranchTab(
	argv: string[],
	cwd: string,
	name: string,
): Promise<{ tab: string } | { error: string }> {
	const place = await ownPlace();
	if (!place) return { error: "this terminal is not shown in a Herdr app space." };
	try {
		const out = await run("herdr-app", [
			"do", "tab.new", JSON.stringify({ space: place.space, name, folder: cwd, argv }),
		]);
		const tab = JSON.parse(out)?.tab;
		return tab ? { tab } : { error: `unexpected reply from herdr-app: ${out.trim()}` };
	} catch (e) {
		if (noAppHere(e)) return { error: "no Herdr app on this machine (herdr-app missing or no window running)." };
		return { error: `could not open a tab: ${(e as Error).message.trim()}` };
	}
}

/** Whether a failed `herdr-app` call means this machine has no app: not installed, or no window running. */
function noAppHere(e: unknown): boolean {
	const err = e as NodeJS.ErrnoException;
	return err.code === "ENOENT" || /no Herdr window/.test(err.message ?? "");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("branch", {
		description: "Fork this session into a new Herdr app tab for a side quest; optional arg names it",
		handler: async (args, ctx) => {
			const fail = (msg: string) => ctx.ui.notify(`/branch: ${msg}`, "error");

			if (!inHcTerminal()) return fail("needs the Herdr desktop app (no HC_TERMINAL_ID here).");
			const sm = ctx.sessionManager;
			const file = sm.getSessionFile();
			if (!file || !existsSync(file)) {
				return fail("this session has no file on disk yet (ephemeral, or nothing answered so far).");
			}

			const given = args.trim();
			const parentName = sm.getSessionName();
			// Without --name the fork inherits the parent's name, which makes the two indistinguishable in /resume.
			const sessionName = given || (parentName ? `${parentName} (branch)` : undefined);
			const tabName = given || DEFAULT_NAME;

			const argv = ["pi", "--fork", file, ...(sessionName ? ["--name", sessionName] : [])];
			const res = await openBranchTab(argv, ctx.cwd, tabName);
			if ("error" in res) return fail(res.error);

			const busy = ctx.isIdle() ? "" : " The current turn is still running; the branch starts from its last saved message.";
			ctx.ui.notify(`/branch: side quest "${sessionName ?? tabName}" open in tab ${tabName}.${busy}`, "info");
		},
	});
}
