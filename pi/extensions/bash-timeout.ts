/**
 * Bash Timeout Extension
 *
 * Re-registers the built-in `bash` tool with a default timeout so no command can
 * hang a session forever. The built-in already kills the process tree on timeout
 * and returns whatever the command printed before the kill, plus a
 * "Command timed out after N seconds" notice; it just has no default.
 *
 * An explicit `timeout` in the tool call always wins, so genuinely long jobs
 * (large test suites, transfers, model runs) stay possible.
 */

import {
	createBashToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	formatSize,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 300;

// Our own full text instead of the built-in's plus a note: shorter, and it
// states the default timeout the built-in does not have. The limits come from
// pi's exported constants, so a change there still reaches the description.
const DESCRIPTION =
	`Run a bash command in the working directory; returns stdout and stderr.` +
	` Output past ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} keeps the tail and saves the full text to a temp file.` +
	` Default timeout ${DEFAULT_TIMEOUT_SECONDS} s, after which the process tree is killed and the partial output returned;` +
	` pass a larger \`timeout\` for long jobs.`;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const base = createBashToolDefinition(ctx.cwd);

		// Patch the schema description too: the built-in advertises "no default timeout".
		const parameters = {
			...base.parameters,
			properties: {
				...base.parameters.properties,
				timeout: {
					...base.parameters.properties.timeout,
					description: `Timeout in seconds (optional, default ${DEFAULT_TIMEOUT_SECONDS})`,
				},
			},
		};

		pi.registerTool({
			...base,
			description: DESCRIPTION,
			parameters,
			execute(toolCallId, params, signal, onUpdate, toolCtx) {
				return base.execute(
					toolCallId,
					{ ...params, timeout: params.timeout ?? DEFAULT_TIMEOUT_SECONDS },
					signal,
					onUpdate,
					toolCtx,
				);
			},
		});
	});
}
