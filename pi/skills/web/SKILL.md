---
name: web
description: "Load before any web fetch, search, sourced answer, crawl or YouTube video (web CLI, never curl or WebFetch), and to operate a website: clicks, forms, sign-in, screenshots (browser automation)."
---
# Web access

Reach the web through the `web` CLI (https://github.com/sylvainHellin/web-cli, `cargo install --path .` from a clone puts it in `~/.cargo/bin/web`), not raw HTTP tools.
It returns LLM-ready markdown, runs an automatic provider fallback chain, and saves output over ~30k chars to a temp file (printing the path) so a large page never floods context.
`curl`/`wget`/`WebSearch`/`WebFetch` on a public page or web API skip all of that.
Raw `curl` is still right for a local or non-web target the CLI cannot address, for example `localhost`, a unix socket, an internal RPC.

## Pick the command

| Need | Command |
| ---- | ------- |
| Content of one known URL | `web fetch <url>` |
| Find pages / links on a topic | `web search <query>` |
| A direct answer with sources | `web answer <query>` |
| Many pages from one site | `web crawl <url>` |
| A site's URLs only | `web crawl <url> --map` |

Flags and examples per command: `web <cmd> --help` (source of truth; do not memorize them here).
Typical flow: `web search` for candidates, then `web fetch` the best; or `web answer` straight for a factual question.
`--json` gives structured output on any command, and on `fetch` and `search` it names the provider that answered.

## What to know beyond `--help`

- `fetch` chains Jina Reader, then Exa `/contents`, then a raw GET.
  Jina needs no key at 20 requests a minute and says so on stderr; a 429 waits a few seconds and retries on its own, so a burst of fetches needs no sleeping by hand.
  Exa is skipped without `exaApiKey`.
  A raw GET answering non-2xx fails the command instead of handing back the error page as content, and a bot wall or error page Jina flags moves the chain on, so a blocked page exits non-zero (a 200 JS challenge page from the raw GET can still slip through).
  `--raw` skips the readers.
- `search` runs Brave, then Exa when Brave has no key or fails.
  `--provider brave|exa|firecrawl` pins one.
  Firecrawl stays opt-in because it bills per result on a small free tier.
- Every search result snippet is capped at 500 chars so a research-heavy session does not eat its own context; `--max-snippet 0` uncaps it.
  Exa has the higher recall on narrow technical strings and niche content but clusters near-duplicate URLs; Firecrawl returns leaner output with query-relevant highlights and lands better on documentation and broad organisational queries.
- `crawl` runs entirely on Firecrawl v2, `--map` and `--depth` included, and fails naming `firecrawlApiKey` when no key is configured.
  A job is capped at 5 minutes; on a timeout try `--map` first to confirm the site is reachable, or fetch the URLs individually.
- `answer` runs Exa `/answer` with Perplexity Sonar behind it, and fails loudly: a blank answer or missing citations exits non-zero rather than printing an empty success.
  `--lang <code>` (BCP-47, e.g. `de`) hints the locale for Perplexity and is a no-op on Exa.
- Clicking, filling forms and stateful logged-in sessions are out of scope for this tool, which has no local browser anywhere in the chain: read `browser.md` beside this file.

## Keys and config

`~/.config/web-cli/config.json` holds the camelCase keys `exaApiKey`, `firecrawlApiKey`, `braveApiKey`, `perplexityApiKey`, `jinaApiKey` plus a `defaults` block.
The matching upper-snake-case environment variables (`EXA_API_KEY`, `FIRECRAWL_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, `JINA_API_KEY`) override the file.
`fetch` needs no key; `search` needs `braveApiKey` or `exaApiKey`; `crawl` needs `firecrawlApiKey`; `answer` needs `exaApiKey` or `perplexityApiKey`.

## When something is missing

If `web` is absent or a command fails in a way you cannot resolve, stop and tell the user what you ran and the exact error rather than rebuilding the binary or quietly dropping to raw `curl`.
For a missing key or a missing binary, `FALLBACK.md` covers the key-free floor and the one sanctioned emergency `curl` path.

## Not covered

- GitHub repos: clone shallow into a tmp dir and explore with `read`/`bash` (`git clone --depth 1 <url> /tmp/<repo>`) rather than scraping.
- YouTube: `web fetch` gets only a bot-check page; transcripts, video and slide frames go through `yt-dlp` and `ffmpeg`, see [youtube.md](youtube.md).

Provider table, config schema, and build steps live in the CLI README; consult it only when maintaining the CLI.
