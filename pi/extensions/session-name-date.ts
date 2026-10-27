/**
 * Session name date prefix
 *
 * `/name 2026 roadmap` names the session `2026-10-23 2026 roadmap`: every
 * session name gets today's local date in front, unless it already starts
 * with a YYYY-MM-DD date.
 *
 * The built-in /name is dispatched by the editor before any extension hook,
 * so its text cannot be rewritten on the way in; this reacts to the rename
 * instead. The re-set name fires the event again and
 * stops at the date check.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DATED = /^\d{4}-\d{2}-\d{2}(\s|$)/;

function today(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_info_changed", async (event, _ctx) => {
		const name = event.name?.trim();
		if (!name || DATED.test(name)) return;
		pi.setSessionName(`${today()} ${name}`);
	});
}
