# Web fallbacks

What still works when keys or the binary are missing. Config schema, key URLs, and
build steps are in the CLI README (https://github.com/sylvainHellin/web-cli); this
file covers degraded-mode behavior only.

## Binary missing

If `which web` finds nothing, a clone of the repo rebuilds it (`cargo install --path .`),
but that is the user's call: flag it rather than rebuilding unprompted.

## Zero-key floor (no config at all)

With no `~/.config/web-cli/config.json` and no env vars:

- `web fetch <url>` works: Jina Reader keyless at 20 requests a minute, then a raw
  GET if Jina comes back empty or fails. Exa `/contents` is skipped without
  `exaApiKey`.
- `web search`, `web crawl` and `web answer` error naming the key they need
  (`braveApiKey` or `exaApiKey`, `firecrawlApiKey`, `exaApiKey` or
  `perplexityApiKey`).

Manual fallback, the one sanctioned raw-`curl` web exception, reserved for the case
where the `web` binary itself is missing or broken and cannot be rebuilt:

```bash
# crude fetch
curl -sL "https://r.jina.ai/https://example.com"   # Jina, keyless, returns markdown
curl -sL "https://example.com"                     # raw HTML
```

If the `web` binary works at all, use it instead of these.

To add a key, edit `~/.config/web-cli/config.json` (schema and provider links in the
README). Never write a key into any other file.

## Provider-down behaviour

- `fetch`: Jina, then Exa contents, then raw GET. Something almost always returns, though a
  raw GET with a non-2xx status fails the command instead of returning the error page
  as content.
- `search`: Brave, then Exa. `--provider firecrawl` is a deliberate opt-in (paid per
  result), not a rescue path.
- `answer`: the chosen provider, then the other one (exa or perplexity) if its key
  exists.
- `crawl`: Firecrawl v2 with no fallback, for plain crawls, `--map` and `--depth`
  alike. If a job times out (5 min cap), try `--map` first to confirm the site is
  reachable, or fetch individual URLs.
