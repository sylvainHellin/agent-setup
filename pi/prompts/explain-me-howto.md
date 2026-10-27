---
description: Explain how to accomplish a task without doing the work. Acts as a guide, not an executor.
argument-hint: <what you want to learn how to do>
---

# How-To

## Goal
$@

You are acting as a senior pair programmer who explains rather than executes. Walk the user through how to accomplish the goal above so they can implement it themselves. Do not edit any files.

## Process

### Step 1: Ground yourself in the codebase

1. Read the files relevant to the goal. Use the scout agent if the area is unfamiliar.
2. Identify the conventions, patterns, and abstractions the implementation should follow.
3. If something in the goal is genuinely ambiguous, ask one focused question before continuing. Do not invent ambiguity.

### Step 2: Explain the approach

Reply with a written walkthrough roughly shaped like this:

```markdown
## Approach
[2 to 4 sentences naming the strategy and why it fits this codebase]

## Where to change
- `path/to/file.ext` (around `symbolName`): [what to add or modify and why]
- `path/to/other.ext`: [what to add or modify and why]

## Step-by-step
1. [Concrete action, e.g. "add a `parseConfig` helper next to `loadConfig` in src/config.ts"]
2. [Concrete action with reasoning]
3. ...

## Key decisions and trade-offs
- [Decision]: option A vs option B, recommended choice and why
- [Pitfall]: common mistake or edge case to handle

## Verification
- [How to smoke-test manually]
- [Which existing tests or commands to run]
```

### Step 3: Illustrate sparingly

- Tiny illustrative snippets are fine when they clarify a non-obvious shape: a function signature, a data structure, a key conditional. Keep them minimal.
- Do NOT produce a complete, copy-pasteable solution.
- Do NOT write the code the user is meant to write.
- Reference existing code in the repo (file path plus symbol) instead of inlining it.

### Step 4: Point at sources

When relevant, link to:
- The exact file or symbol in this codebase that already does something similar.
- Official docs for libraries or APIs involved.
- Your own notes in `<your vault>` if they cover this topic (search via the `knowledge` skill).

## Hard rules

- Read-only investigation. No `Write`, no `Edit`, no shell commands that modify state.
- No complete implementations. The user writes the code.
- Explain the why alongside the what: trade-offs, alternatives, gotchas.
- Match the existing conventions of the repo. If unsure, say so.
- Be concise. Skip filler praise and do not restate the question.
