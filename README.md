# agent-setup

My coding-agent setup, made generic so colleagues can borrow from it.
It runs on [pi](https://github.com/earendil-works/pi-coding-agent), a minimal, extensible terminal coding agent, and I use it daily for code, scientific writing and admin work.
Most pieces also transfer to other harnesses: the skills and instruction files are plain Markdown, and only the extensions are pi-specific.

Take what fits your work and adapt it; installing everything as it is will not match your workflow.

## What is inside

| Path | What it is |
|---|---|
| [`pi/extensions/`](pi/extensions/README.md) | 24 pi extensions: context management without lossy summaries (`prune`, `smart-compact`), a plan and annotate review loop, `/review` and `/diff` with inline comments, an orchestrator mode, a persistent Python tool, guardrails. |
| [`pi/skills/`](pi/skills/README.md) | Seven generic skills: agents (writing skills and instruction files, subagents), code and code review, writing (avoiding AI tells), documents (HTML reports, TikZ figures, document parsing), knowledge (Obsidian vault and Zotero), web, task tracking. |
| [`pi/AGENTS.md`](pi/AGENTS.md), [`pi/SYSTEM.md`](pi/SYSTEM.md) | Global instructions and a persona template, with placeholders for your own details. |
| [`pi/agents/`](pi/agents/) | Subagent types for `@tintinweb/pi-subagents`: scout, researcher, worker, reviewer. |
| [`pi/prompts/`](pi/prompts/) | Prompt templates: plan, brainstorm, debug, grill-me, research, handoffs, wrap-up, commit. |
| [`report-html/`](report-html/README.md) | The HTML report template: the agent writes long answers as a page, you comment inline in the browser and paste the exported comments back. Default and TUM themes. |
| [`TOOLS.md`](TOOLS.md) | The CLIs and apps the setup relies on, including the ones I built. |

For TikZ figures in one consistent look, see [tex-fig](https://github.com/sylvainHellin/tex-fig); the `documents` skill teaches the agent to use it.

## Install

```sh
git clone https://github.com/sylvainHellin/agent-setup.git ~/code/agent-setup
cd ~/code/agent-setup
```

pi reads its global config from `~/.pi/agent/`.
Link or copy the parts you want there:

```sh
ln -s ~/code/agent-setup/pi/extensions ~/.pi/agent/extensions
ln -s ~/code/agent-setup/pi/skills     ~/.pi/agent/skills
ln -s ~/code/agent-setup/pi/agents     ~/.pi/agent/agents
ln -s ~/code/agent-setup/pi/prompts    ~/.pi/agent/prompts
cp pi/AGENTS.md pi/agent-tool-description.md pi/subagents.json ~/.pi/agent/
cp pi/SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```

`APPEND_SYSTEM.md` adds the persona to pi's default system prompt; saved as `SYSTEM.md`, it replaces that prompt, which is how I run it.
Then fill in the placeholders in `AGENTS.md` and `APPEND_SYSTEM.md`, merge [`pi/settings.example.json`](pi/settings.example.json) into `~/.pi/agent/settings.json`, and restart pi.
`agent-tool-description.md` and `subagents.json` configure `@tintinweb/pi-subagents`.
The third-party CLIs the skills call are listed in [`TOOLS.md`](TOOLS.md), with a Homebrew install block.

## License

MIT, see [`LICENSE`](LICENSE).
Vendored code keeps its own license: `pi/extensions/smart-compact/` (MIT, fork of dasomji/pi-smart-compact) and `pi/extensions/browser-execute/cdp/` (MIT, from browser-use/browsercode).
