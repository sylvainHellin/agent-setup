/**
 * Where this pi sits in the Herdr desktop app, and a small `execFile` wrapper.
 *
 * Inside the app every pane is an hc terminal, so pi knows its own address
 * from `HC_TERMINAL_ID`, and `hc get` gives the `herdr.space` and `herdr.tab`
 * labels that place it. Outside the app (plain terminal, ssh session) or in a
 * hidden hc terminal without the labels, `ownPlace` resolves undefined.
 */

import { execFile } from "node:child_process";

/** Whether pi runs in an hc terminal, the precondition for an app placement. */
export function inHcTerminal(): boolean {
	return Boolean(process.env.HC_TERMINAL_ID);
}

export function run(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
			error ? reject(error) : resolve(stdout),
		);
	});
}

/** The app space and tab showing this pi, from its terminal's labels; undefined outside the app. */
export async function ownPlace(): Promise<{ space: string; tab: string } | undefined> {
	const self = process.env.HC_TERMINAL_ID;
	if (!self) return undefined;
	try {
		const labels = JSON.parse(await run("hc", ["get", self, "--json"]))?.labels ?? {};
		const space = labels["herdr.space"];
		const tab = labels["herdr.tab"];
		return space && tab ? { space, tab } : undefined;
	} catch {
		return undefined;
	}
}
