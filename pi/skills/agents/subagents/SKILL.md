# subagents (the pi-subagents extension)

The `@tintinweb/pi-subagents` extension spawns subagents in-process through the `Agent` tool.
Each runs an isolated pi session with its own tools, system prompt, model and thinking level, set by its agent definition.

## Calling the tools

`Agent`, `get_subagent_result` and `steer_subagent` come from the extension; if you hide their declarations to save tokens, this section stands in for their schemas.
Call them as normal tool calls, or from codemode as `await tools.Agent({...})`; `describeTool("Agent")` in codemode prints every parameter with its full description.

- `Agent({ subagent_type, description, prompt, ... })`: `subagent_type` is `scout` (fast read-only codebase scout), `researcher` (web research), `reviewer` (read-only code review) or `worker` (implementation), the definitions in `pi/agents/` of this repo; `description` is 3 to 5 words for the UI; `prompt` is self-contained, since the agent has not seen this conversation.
- Optional `Agent` fields: `name` (handle for steering), `run_in_background` (boolean, default true), `resume` (agent id), `max_turns` (number), `model`, `thinking` (`off` to `max`), `isolation: "worktree"`, `inherit_context` (boolean), `isolated` (boolean, built-in tools only).
- `get_subagent_result({ agent_id, wait?, verbose? })` and `steer_subagent({ agent_id, message })` take the id or name the spawn returned.
- Results are not shown to the user, so summarize them in the reply.

## Mechanics

- Agent definitions live in `~/.pi/agent/agents/<name>.md`, with `.pi/agents/` as a per-project override; frontmatter is authoritative for model, thinking and tools.
- The builtin types (general-purpose, Explore, Plan) are disabled through `disableDefaultAgents` in `subagents.json`, so name an exact custom type.
- `worker` inherits the parent system prompt (`prompt_mode: append`), while `reviewer`, `scout` and `researcher` run standalone prompts, so anything they must know goes into the dispatch prompt.
- Workers cannot spawn agents, so a skill step that dispatches a reviewer (the `writing` skill's fresh-eyes pass) never runs inside a worker; the orchestrator dispatches that reviewer after the worker returns.
- Statuses: `completed`, `steered` (hit `max_turns`, wrapped up in grace turns), `aborted` (blew the grace period), `stopped` (user).
- Concurrency is 10 background slots and unlimited foreground ones; excess background spawns queue automatically.
- Background is the default mode; pass `run_in_background: false` to block and read the result inline.
- Background agents spawned in the same turn notify as a single grouped notification.
- Never poll or sleep while a background agent runs; continue with other work until the notification arrives.
- Never repeat searches or reads you delegated; wait for the agent's result instead.
- Finished-agent records do not outlive the session or a reconnect; after "Agent not found", the output file named in the dispatch reply still holds the run as JSONL, and `tail -n 1 <file> | jq -r '.message.content[] | select(.type=="text") | .text'` prints the final report.
- `isolation: "worktree"` checks out a bare `git worktree` under `$TMPDIR` without any ignored file: no local `.gitignore`, `node_modules`, `.env` or build tree.
  It suits light repos; in a repo set up for Worktrunk (`code` skill, Worktrees), the main session runs `wt switch --create <branch> --no-cd`, briefs the worker with the worktree's absolute path, and merges with `wt -C <path> merge main` after review.
- A worktree agent's checkout is removed when it finishes and its commits survive on an auto-created branch `pi-agent-<id>` (plus any branch it made); a resumed worktree agent has no files to edit, so follow-up code work is a fresh worktree dispatch that checks out that branch, and the merged branches are deleted only after `git log --cherry-pick --right-only main...<branch>` prints nothing.
- Two workers that commit to one checkout see each other's uncommitted edits; run them in sequence, or give all but one its own worktree.
- A worker that ends in an error (Connection error) leaves its edits uncommitted in its checkout and its full transcript, tool calls and results, in the JSONL output file named in the notification; read `git status` and that file to recover its state before redispatching.
- The user watches, steers and stops agents from the widget, the fleet list below the editor, and `/agents`.

## Pre-install dependencies before dispatching

Detached subagents run headless, so an approval hook firing inside one, a `pnpm add` or any package or tool install, stalls the job until a human happens to look.
Resolve a work unit's dependencies in the main session where the user sees and clears the hook, then state in the prompt that installs are out of scope.
A child that still finds a dependency missing reports the package and the reason instead of installing it.
A sign-in stalls a child the same way: one that lands on a login page finishes what it can and reports `login needed` instead of waiting; the main session asks the user to log in and redispatches.

## Name the artifact destination

A child resolves relative paths against its working directory, and a prompt naming no destination lets it pick the project root.
Every dispatch that produces a file carries its exact destination, since the child cannot see this skill:

- `.agents/research/<YYYY-MM-DD-topic>.md` for research notes, scouting reports and evidence dumps
- `.agents/handoff/<YYYY-MM-DD_slug>.md` for handoffs and synthesis summaries
- `.agents/workflow/<slug>/` for multi-step scratch and tracking files

For an advisory or review pass that should persist nothing, say so: report in the final message, create no files.
`.agents/` is gitignored, so these artifacts stay out of version control by design.

## Check with fresh eyes

An agent's self-report that its own work is done is not evidence.
When an agent writes or edits files, check the actual changes before reporting the work as done.
Dispatch a separate `reviewer` with a task-specific angle: acceptance criteria with pass/fail evidence, or a security angle covering injection, authz gaps, secret handling and unsafe input.
Give it the diff or commit range and the unit's contract, never the worker's report or a summary of it, which anchor the reviewer on the claim it should test.
When a second model family is configured, run it as a pair: two background `reviewer` calls in the same turn with the identical prompt, one on its default model, one with `model: "<provider>/<model>"` from the other family.
Merge the two reports, judge each finding once against the blocking bar, and note which model raised it.
To see over time what the second family adds, append one line per review to a log such as `.agents/research/reviewer-comparison.jsonl`:
`{"date":"YYYY-MM-DD","repo":"<name>","unit":"<one line>","kind":"code|plan","a_only":N,"b_only":N,"both":N,"acted_on":{"a_only":N,"b_only":N,"both":N}}`
Load the `code/review` skill first and tell the reviewer in its prompt the full path of `code/review/SKILL.md` in your skills folder, since a child cannot see the parent's loaded skills.

## Orchestrator mode

When the task is large enough that the main session's context is the scarce resource, read `orchestrator-mode.md` before dispatching anything.
When the user asks for a workflow, read `workflows.md` first.
