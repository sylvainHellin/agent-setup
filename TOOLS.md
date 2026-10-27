# Tools

The CLIs and apps behind this setup, grouped by origin.
The skills in `pi/skills/` name the ones they call.

## Own tools

| Tool | Command | What it does |
|---|---|---|
| [web-cli](https://github.com/sylvainHellin/web-cli) | `web` | LLM-friendly web access in one Rust binary: search, fetch, sourced answers and crawls over managed APIs, with provider fallback (`web` skill). |
| [doc-cli](https://github.com/sylvainHellin/doc-cli) | `doc` | Turns documents into Markdown: Office files and born-digital PDFs parsed locally, scans routed to local or cloud OCR (`documents` skill). |
| [zot](https://github.com/sylvainHellin/zot) | `zot` | Queries and maintains a Zotero library: hybrid semantic search, fulltext, BibTeX export, and adding or editing items (`knowledge` skill). |
| [plane-cli](https://github.com/sylvainHellin/plane-cli) | `plane` | Reads and writes issues on a self-hosted Plane instance without `curl` and `jq` pipelines (`productivity` skill). |
| [mailypoppins](https://github.com/sylvainHellin/mailypoppins) | `mp` | Mail client with a CLI, a terminal UI and a macOS app, where every draft is a Markdown file the user and the agent edit together. |
| [tts-cli](https://github.com/sylvainHellin/tts-cli) | `tts` | Text to speech: a thin wrapper around the MiniMax API, with optional local CPU backends (Kokoro, StyleTTS2, Chatterbox). |
| [textfold](https://github.com/sylvainHellin/textfold) | `textfold` | Fork of TextFold (chenxiachan/textfold), which folds any text from a one-screen map down to every word. |
| [agent-cli](https://github.com/sylvainHellin/agent-cli) | `agent` | Spawns, steers and resumes background pi subagents from the shell. |
| [tex-fig](https://github.com/sylvainHellin/tex-fig) | | LaTeX/TikZ package that gives every figure in papers and slides one consistent look (`documents` skill). |
| [helix-anywhere](https://github.com/sylvainHellin/helix-anywhere) | | Edit the selected text of any macOS application in the Helix editor and paste it back. |

Not public yet:

- meetcap: two-track meeting recorder for macOS (the local microphone and the other participants as separate files).
- report: the helper that creates and opens HTML report pages; the template itself ships in this repo under `report-html/`.
- typst2pptx: compiles a Typst deck into a PDF and a PowerPoint file with per-slide speaker notes.

## Harness and terminal

| Tool | What it is for |
|---|---|
| [pi](https://github.com/earendil-works/pi-coding-agent) | The coding agent harness everything here plugs into: extensions, skills, prompts, subagent definitions. |
| [@tintinweb/pi-subagents](https://www.npmjs.com/package/@tintinweb/pi-subagents) | pi package that adds the `Agent` tool and runs the subagents defined in `pi/agents/`. |
| [pi-vim](https://github.com/lajarre/pi-vim) | pi package that gives the prompt editor a vim mode. |
| [herdr](https://github.com/ogulcancelik/herdr) | Terminal multiplexer built for agents; long-running jobs run in its tabs, and it shows each pane's agent state. |
| [Neovim](https://neovim.io) | Editor for code, notes, drafts and plan review. |
| [Ghostty](https://ghostty.org) | Terminal emulator. |

## Third-party CLIs the skills rely on

| Tool | What it is for in this setup |
|---|---|
| ripgrep (`rg`) | Content search in code and in the notes vault; the default over `grep`. |
| fd | Filename search; the default over `find`. |
| uv | Runs every Python script, tool and dependency (`code` skill). |
| pnpm | Every JavaScript and TypeScript install (`code` skill). |
| gh | GitHub CLI for repos, issues and pull requests. |
| jq | Filters the `--json` output of the CLIs above. |
| typst | Typst documents and slide decks (`documents` skill). |
| tectonic | Self-contained LaTeX engine for `.tex` documents and tex-fig renders (`documents` skill). |
| pandoc | Converts between document formats (Markdown, LaTeX, Word); not called by the skills. |
| poppler | `pdftoppm` renders PDF pages to PNG for visual checks, `pdftotext` extracts paper text. |
| ImageMagick | Contact sheets and image trimming for slide checks. |
| ffmpeg | Frames and contact sheets from videos (`web` skill, YouTube). |
| yt-dlp | YouTube transcripts and video downloads (`web` skill). |
| Rust (`rustup`) | Builds the Rust CLIs above with `cargo install --path .`. |
| stow | Symlinks a dotfiles repo into place; useful when this config lives in one. |
| lazygit | Terminal UI for git. |
| yazi | Terminal file manager. |
| zoxide | Jumps to frequently used directories. |
| [qmd](https://github.com/tobi/qmd) | Local hybrid (keyword and semantic) search over Markdown notes and session transcripts; the `knowledge` skill escalates to it when `rg` finds nothing. |
| [crawl4ai](https://github.com/unclecode/crawl4ai) | Local crawler (`crwl`) that turns pages into Markdown without API keys; not called by the skills. |
| [BrowserOS](https://github.com/browseros-ai/BrowserOS) | Agent-driven browser for clicks, forms and sign-ins (`web` skill). |
| [Superwhisper](https://superwhisper.com) | Dictation and transcription on macOS. |
| [Obsidian](https://obsidian.md) | The notes vault the `knowledge` skill reads and writes. |
| [Zotero](https://www.zotero.org) with [Better BibTeX](https://retorque.re/zotero-better-bibtex/) | Reference library and citation keys, reached through `zot`. |
| [Plane](https://plane.so) | Self-hosted task tracker behind the `productivity` skill; runs in Docker on any server. |

## Install on macOS

```sh
brew install ripgrep fd uv pnpm gh jq typst tectonic pandoc poppler imagemagick ffmpeg stow lazygit yazi zoxide neovim rustup herdr pi-coding-agent
brew install --cask ghostty obsidian zotero browseros superwhisper
uv tool install --upgrade "yt-dlp[default,curl-cffi]" --with bgutil-ytdlp-pot-provider
uv tool install crawl4ai && crawl4ai-setup
pnpm add -g @tobilu/qmd
pi install npm:@tintinweb/pi-subagents
pi install npm:pi-vim
```

Better BibTeX installs from its release page into Zotero.
Plane self-hosting follows https://developers.plane.so/self-hosting/overview.
The tools in "Own tools" install from their repos as each README describes.
