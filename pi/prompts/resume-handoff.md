---
description: Resume work from a handoff document created in a previous session
argument-hint: "[handoff-path]"
---
# Resume Work from Handoff Document

## Handoff Path
$1

You are tasked with continuing work from a handoff document that captures context, learnings, and next steps from a previous session.

If a path is provided above, read that file immediately and completely, then proceed to Step 1.

If no path is provided, list recent handoffs and ask the user which to resume:

```bash
ls -lt "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"/.agents/handoff/*.md | head -10
```

## Process Steps

### Step 1: Read and Analyze Handoff

1. Read the complete handoff document (no limit/offset)
2. Extract key information:
   - Task statuses (completed, in progress, planned)
   - Recent changes made
   - Learnings and patterns discovered
   - Artifacts produced
   - Action items and next steps

3. Read all linked documents:
   - Implementation plans referenced
   - Research documents referenced
   - Any other critical files mentioned

### Step 2: Verify Current State

Verify the current state matches the handoff:

- Verify Recent Changes: Check if the changes mentioned in the handoff still exist. Verify the code is as described and hasn't been modified since.
- Validate Artifacts: Verify all artifacts from handoff exist and contain expected content.

### Step 3: Confirm and Propose

Keep this brief. Do not produce a verbose synthesis. In a few lines:

1. Confirm you read the handoff and the linked files (name them).
2. Flag only real discrepancies (recent changes missing, artifacts absent, state diverged). Skip if none.
3. If anything is ambiguous or blocking, ask your questions now.
4. Otherwise, propose the next actions for the user to approve.

Example:

```markdown
Read the handoff plus `plan.md` and `src/auth/flow.ts`. State matches; no discrepancies.

Proposed next actions:
1. [First priority action]
2. [Second priority action]

Shall I start with [first action]?
```

### Step 4: Begin Work

After user confirmation:
1. Follow the action items from the handoff
2. Reference the learnings throughout implementation
3. Follow patterns documented in the handoff
4. Update artifacts as needed

## Important Guidelines

1. Read the entire handoff first: never start work without understanding the full context.
2. Verify before assuming: the codebase may have changed since the handoff.
3. Confirm reading, ask questions, then propose: keep it concise and get user approval before acting.
4. Leverage documented wisdom: reference the learnings to avoid repeating mistakes.
5. Adapt if needed: if the state has diverged, propose an updated approach.
