import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWriteTool } from "@earendil-works/pi-coding-agent";
import { existsSync } from "fs";
import { resolveToolPath } from "./shared/tool-path.js";

export default function (pi: ExtensionAPI) {
    const cwd = process.cwd();

    // Get original write tool
    const originalWrite = createWriteTool(cwd);

    // Override write tool
    pi.registerTool({
        name: "write",
        label: originalWrite.label,
        description: "Write content to a NEW file only. Returns an error if the file already exists. Use 'edit' for existing files.",
        parameters: originalWrite.parameters,

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            // Must match the real write tool's resolution (~, @, file://),
            // or the guard checks one path while the tool overwrites another.
            const absolutePath = resolveToolPath(params.path, ctx.cwd);

            // Check if file exists
            if (existsSync(absolutePath)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `File already exists: "${params.path}". Use the "edit" tool to modify existing files, or use "read" to review the current content first.`,
                        },
                    ],
                    details: { blocked: true, reason: "file_exists" },
                };
            }

            // File doesn't exist, delegate to original write tool
            return originalWrite.execute(toolCallId, params, signal, onUpdate);
        },
    });
}
