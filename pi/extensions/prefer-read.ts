/**
 * Prefer Read Extension
 *
 * Blocks bash commands that read a file the `read` tool should read:
 * `cat F`, `cat -n F`, `sed -n 'A,Bp' F`, `head [-n N] F`, `tail [-n N] F`,
 * alone or as one segment of a `;` / `&&` / newline chain
 * (`rg ...; sed -n 20,40p F` is blocked too).
 *
 * Left alone: anything with a pipe or heredoc (`cat F | jq`, `cat > F <<EOF`),
 * redirections, regex `sed` ranges, `tail -f`, `$VAR` paths, and commands run
 * remotely (`ssh host cat F`), since `read` cannot do those.
 *
 * The block reason tells the agent how to do it with `read`, so it retries in
 * the same turn. Before this hook, about one bash call in six was such a read,
 * despite a system-prompt rule against it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// A path argument: no shell metacharacters, no variables, no command substitution.
const ARG = String.raw`[^\s|<>&;$\x60()]+`;
const FILE = String.raw`[^\s|<>&;$\x60()-]${ARG.slice(0, -1)}*`;

const READ_SEGMENTS = [
	new RegExp(`^cat(\\s+-n)?(\\s+${ARG})+$`),
	new RegExp(`^sed\\s+-n\\s+['"]?\\d+(,\\d+)?p['"]?(\\s+${ARG})+$`),
	new RegExp(`^head(\\s+-n\\s*\\d+|\\s+-\\d+)?(\\s+${FILE})+$`),
	new RegExp(`^tail(\\s+-n\\s*\\+?\\d+|\\s+-\\d+)?(\\s+${FILE})+$`),
];

const REASON =
	"blocked by prefer-read: reading a file through cat/sed/head/tail in bash. " +
	"Use the `read` tool instead (offset/limit for a line range; paths resolve against the session cwd, so give the full path when the command used `cd`). " +
	"Read several files with parallel `read` calls, or one codemode script for many. " +
	"Run any remaining non-read part of the command (rg, git, ...) as its own bash call.";

export function hasFileRead(command: string): boolean {
	if (command.includes("<<") || /(^|[^|])\|([^|]|$)/.test(command)) return false;
	return command
		.split(/\s*(?:&&|;|\n)\s*/)
		.map((s) => s.trim())
		.some((segment) => READ_SEGMENTS.some((re) => re.test(segment)));
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return undefined;
		const command = event.input.command as string;
		if (!command || !hasFileRead(command)) return undefined;
		return { block: true, reason: REASON };
	});
}
