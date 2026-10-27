---
description: Author a narrative Codiff walkthrough of the current change and open it in the Codiff app
argument-hint: "[target: commit | HEAD | base...head | repo path]"
---
Needs the Codiff app (https://github.com/nkzw-tech/codiff) with its `codiff` command on PATH.

Author a narrative walkthrough of a code change as a JSON document, then open Codiff pointed at it. You write the JSON yourself, since you already hold the context that produced the change. Codiff owns the format and validates the document on load, so this is just the handoff: fetch the guide, author the document, launch Codiff.

## 1. Get the current authoring guide from Codiff

Run this and follow exactly what it says (it prints the data model, the authoring guidance, and the JSON schema for the installed Codiff version):

```bash
codiff --walkthrough-guide
```

The guide is the source of truth. Everything below is only the handoff around it.

## 2. Pick the change

Argument: `$@`

- If an argument was given, use it as the target. Codiff accepts a commit (`HEAD`, a SHA), a branch, a ref range (`base...head` for the merge-base diff, `base..head` for the direct diff), a pull request (`#123` or a GitHub URL), or a repository path.
- If no argument was given, default to the staged diff (`git diff --staged`). If nothing is staged, fall back to the working tree (`git diff`) and say so in one line.

Anchor the document's segments against whichever diff you chose.

## 3. Author the JSON

Write the document per the guide to a temporary file outside the repository so it never clutters the working tree. Use a unique absolute path in the system temp dir, e.g. `"$TMPDIR/codiff-walkthrough-$(date +%s).json"` on macOS. Set the document's `$schema` as the guide instructs. Remember the path for the next step.

## 4. Open Codiff

Launch Codiff with the walkthrough file, forwarding the target if one was given:

```bash
codiff -w --agent claude --walkthrough-file <tmp-path> [target]
```

`--agent claude` is Codiff's closest available backend (Codiff only supports `codex` and `claude`; pi cannot be slotted in). Omit `[target]` when reviewing staged or working-tree changes; pass it verbatim when the user named one. Codiff validates and repairs anchors against the live diff, so a slightly-off anchor is pinned to a real section rather than dropped.

Emit JSON only into the temp file. Do not summarize the change back to me; this is a handoff into Codiff.
