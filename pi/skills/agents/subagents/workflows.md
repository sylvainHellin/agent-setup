# Scripted workflows (SubagentWorkflow)

Use a workflow only when the user explicitly asks for multi-agent orchestration; for anything else, the `Agent` tool is enough.

The `SubagentWorkflow` tool comes with `@tintinweb/pi-subagents` when `workflowsEnabled` is true in `subagents.json`, and its own description carries the API.
The full guide is `docs/workflows.md` inside the installed package (`~/.pi/agent/npm/node_modules/@tintinweb/pi-subagents/` by default); read it before a non-trivial script.
A script worth keeping goes to `.pi/workflows/<name>.js` in the project, and runs again by `name`.
