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

import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 300;

const TIMEOUT_NOTE =
	` Commands run with a default timeout of ${DEFAULT_TIMEOUT_SECONDS} seconds: on expiry the process tree is killed,` +
	` the output produced so far is returned, and the result says the command timed out.` +
	` Pass a larger timeout for commands that legitimately need longer.`;

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
			description: `${base.description}${TIMEOUT_NOTE}`,
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
