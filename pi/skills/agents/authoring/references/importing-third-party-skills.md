# Importing a third-party skill (install + adapt)

The "import" mode for skills: a third-party skill (usually written for Claude Code, sometimes for another harness or a Mac-only toolchain) needs to land in your skills folder (`<skills-dir>/<name>/`) and actually work here. Do not just `cp -r` the upstream repo and call it done.

This file is the full procedure. `SKILL.md` points here when an "import a skill from skills.sh / GitHub" request fires.

## Why this is a real mode, not just a one-off

Skills.sh aggregates many repos under common names (`deep-research`, `pdf`, `commit`, `github`), and an upstream skill arrives with its `name:` frontmatter verbatim. The same name will collide with anything already installed. Importing without auditing tool names and paths leaves the user with a skill that loads, "looks fine," and silently misfires the first time it's invoked.

## Procedure

### 1. Name-collision check before install

`ls <skills-dir>/` and `rg -n '^name:' <skills-dir>/*/SKILL.md` for the candidate name. Skills.sh returns up to 10 hits for common names; one will almost certainly already be installed. Pick a disambiguation strategy and surface it to the user in one line before proceeding:

- Rename the existing skill to `<name>-handoff` / `<name>-v2` (preserves both).
- Replace it (only if the user explicitly asked to replace).
- Pick a more specific name for the import (e.g. `claude-deep-research-pipeline` instead of `deep-research`).

Never install two skills with the same `name:` frontmatter: the loader cannot disambiguate them.

### 2. Tool-name audit

Grep the upstream `SKILL.md`, every `reference/*.md`, and every Python script for harness-specific tool names and map them to pi: `Read`/`Write`/`Edit`/`Bash` to `read`/`write`/`edit`/`bash`, `Glob`/`Grep` to `fd`/`rg` through `bash`, `WebSearch`/`WebFetch` to the `web` CLI (`web` skill), `Task` to the `Agent` tool (`agents/subagents` skill), and `mcp__*` tools to the matching CLI or to pi's built-in MCP support (`docs/mcp.md` in the pi docs). Patch every occurrence; `reference/*.md` is loaded into context on demand, so a stale `WebSearch` there will silently misfire when the model follows the instructions.

### 3. Path audit

Grep for hardcoded paths: `~/.claude/`, `~/.claude/skills/`, `/usr/local/share/claude`, `~/Documents/`, `<repo>/.claude/`.
A skill's own files are addressed relative to the skill directory, never through an absolute skills root, because the root differs between machines and harnesses.
Working output goes to the project's `.agents/` folder or `/tmp`.

Both in markdown and in any Python script that constructs `Path.home() / ".claude" / ...`. A hardcoded path inside `__init__` silently writes to the wrong place and the user does not notice until files go missing.

### 4. Optional-dependency audit

Open `requirements.txt` / `package.json` / `brew install` instructions and separate "needed for the skill to load" from "needed for one optional output format". For each genuinely optional dep, mark it as opt-in in the adapted SKILL.md with a cross-platform install command. Never silently depend on `brew install`-only tooling when the same skill also runs on Linux.

### 5. Smoke-test before declaring done

- Compile every Python script: `python3 -m py_compile scripts/*.py` (run from the skill dir, or use `cd <skill_dir> && for f in scripts/*.py; do python3 -m py_compile "$f" && echo "OK   $f" || echo "FAIL $f"; done`).
- Run `--help` on each CLI script. If `--help` throws an `ImportError`, the script has a missing dep.
- If the skill ships `tests/fixtures/`, run its main validator on both the valid and invalid fixture. A validator that rubber-stamps both fixtures is not a validator: it only proves the happy path was shipped.
- If the upstream skill has `tests/test_*.py` pytest files, copy them too; they can be run with `python3 -m pytest tests/` if pytest is available, or inspected manually for behaviour coverage.

### 6. Check that the skill reaches the prompt

Start a fresh `pi -p "list your skills" < /dev/null` and confirm the new name and description appear; a skill on disk that is missing from the list never fires.
Resolve every missing environment variable, command, or credential file, or document the requirement in the adapted SKILL.md and decide whether the skill is still worth shipping in that state.

## Footguns

- brew-only optional deps: macOS-shaped skills assume `brew install` is available. On a Linux server, that fails silently. Either replace with a cross-platform install command or mark as opt-in. Example: a skill ships `brew tap 199-bio/tap && brew install search-cli`; on Linux this is unreachable, so the upstream "primary" tool is unreachable and the skill only works via the documented "fallback" path. Mark the fallback as primary in the adapted SKILL.md.
- Tests ship in `tests/fixtures/` but the skill never mentions them: The upstream SKILL.md often omits `tests/` from its install instructions. Always copy `tests/` and use the fixtures to smoke-test the validator scripts. A validator that only ships the happy path is theatre.
- Auto-continuation patterns: Some skills use Claude Code's `Task` recursion to spawn "continuation agents" that pick up where a long report left off. In pi the equivalent is a background `Agent` call collected with `get_subagent_result`. Patches to `continuation.md` are non-trivial; verify by reading the file before and after.

## Verification checklist

- [ ] No other skill in the tree carries the same `name:` frontmatter.
- [ ] All upstream tool names (`WebSearch`, `WebFetch`, `Task`, `Bash`, `Read`, `Write`) have been translated. The translated names appear in both `SKILL.md` and every loaded file under `reference/`.
- [ ] All upstream paths (`~/.claude/...`, `~/Documents/...`) have been remapped. Check both markdown and Python `Path()` constructions.
- [ ] `python3 -m py_compile scripts/*.py` succeeds for every script.
- [ ] At least one validator script was run end-to-end against both a valid and an invalid fixture (if fixtures ship).
- [ ] A fresh pi session lists the skill, and missing env vars, commands, or credential files are resolved or documented in the adapted SKILL.md.
- [ ] The user was told about any rename of an existing skill, before the rename happened, in one line.
