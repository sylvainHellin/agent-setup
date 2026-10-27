/**
 * Resolve a tool-call path exactly the way pi's built-in edit/write tools do
 * (core/tools/path-utils.js resolveToCwd -> utils/paths.js resolvePath with
 * normalizeUnicodeSpaces + stripAtPrefix). pi does not export it, so it is
 * mirrored here. Any extension that checks or keys on a path the model sent
 * must use this, or `~/x`, `@x` and `file://x` diverge from what the tool
 * actually touched.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export function resolveToolPath(input: string, cwd: string): string {
	let p = input.replace(UNICODE_SPACES, " ");
	if (p.startsWith("@")) p = p.slice(1);
	if (p === "~") p = homedir();
	else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
	else if (/^file:\/\//.test(p)) p = fileURLToPath(p);
	return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}
