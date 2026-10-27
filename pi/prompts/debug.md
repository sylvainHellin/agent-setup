---
description: Debug issues by investigating logs, state, and git history without editing files
argument-hint: <error description, log path, or symptom>
---

# Debug

## Context
$@

You are tasked with helping debug issues during manual testing or implementation. Investigate problems by examining logs, application state, and git history without editing files.

## Process

### Step 1: Understand the Problem

1. Read any provided context (plan or related files) fully.
2. Quick state check:
   ```bash
   git status
   git log --oneline -5
   git diff --stat
   ```

### Step 2: Investigate

Use bash (`rg`, `fd`, `git`) for parallel investigation, or dispatch a `scout` through `Agent` for a wide search:

- Check logs: `find . -name "*.log" -mtime -1 2>/dev/null | head -10`
- Check application state (database, config, cache, env)
- Git investigation: `git log --oneline -10`, `git diff HEAD~3..HEAD --stat`, `git blame [file]`
- Process state: `ps aux | grep [service]`, `lsof -i :[port]`

### Step 3: Present Findings

```markdown
## Debug Report

### Problem Summary
[Clear statement based on evidence]

### Evidence Found
- Logs: [errors/warnings with timestamps and paths]
- Application State: [database/config/cache findings]
- Git/Files: [relevant commits, uncommitted changes]

### Root Cause Analysis
[Most likely explanation]
Confidence: [High/Medium/Low]

### Recommended Actions
1. Try this first: [specific command/action]
2. If that fails: [alternative]
3. To verify the fix: [verification command]
```

## Hard rules

- Focus on investigation, not fixing.
- Read files completely, no limit/offset.
- No file editing. Suggest fixes but do not apply them.
- Never output credentials, API keys, or sensitive data.
- Hand back what you cannot reach: browser console errors, external service state, network-level issues.
  Name them explicitly rather than reporting them as checked.
