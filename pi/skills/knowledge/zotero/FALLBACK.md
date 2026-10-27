# Zotero REST API Fallback

Direct access to Zotero's local REST API when the `zot` CLI is not available.
It requires the Zotero desktop app to be running.
When the app is stopped there is no API server, so use the index-backed `zot search` / `fulltext` paths instead, see [platforms.md](platforms.md).

## Base URL

```
http://localhost:23119/api/users/0
```

Mirrors the Zotero Web API v3 but requires no authentication.

## Common recipes

### Search by title/creator/year

```bash
curl -s "http://localhost:23119/api/users/0/items?q=BIM+query&qmode=titleCreatorYear&itemType=-attachment%20-note%20-annotation&limit=10" | jq '[.[] | {key, title: .data.title, type: .data.itemType, date: .data.date}]'
```

### Search all fields

```bash
curl -s "http://localhost:23119/api/users/0/items?q=LLM&qmode=everything&itemType=-attachment%20-note%20-annotation&limit=25" | jq '[.[] | {key, title: .data.title}]'
```

### Get item metadata

```bash
curl -s "http://localhost:23119/api/users/0/items/KEY" | jq '{key: .key, title: .data.title, type: .data.itemType, creators: [.data.creators[] | (.lastName + ", " + .firstName)], date: .data.date, doi: .data.DOI, abstract: .data.abstractNote}'
```

### Filter by tag

```bash
curl -s "http://localhost:23119/api/users/0/items?tag=BIM&itemType=-attachment%20-note%20-annotation" | jq '[.[] | {key, title: .data.title}]'
```

### List all tags

```bash
curl -s "http://localhost:23119/api/users/0/tags" | jq '[.[] | {tag: .tag, count: .meta.numItems}] | sort_by(.tag)'
```

### Get PDF file path

```bash
# First get children to find PDF attachment
curl -s "http://localhost:23119/api/users/0/items/KEY/children" | jq '[.[] | select(.data.contentType == "application/pdf") | .key]'

# Then get file path via 302 Location header
curl -s -D - -o /dev/null "http://localhost:23119/api/users/0/items/ATT_KEY/file" 2>/dev/null | grep Location | sed 's/Location: file:\/\///' | python3 -c "import sys,urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))"
```

### Recently added items

```bash
curl -s "http://localhost:23119/api/users/0/items?sort=dateAdded&direction=desc&itemType=-attachment%20-note%20-annotation&limit=10" | jq '[.[] | {key, title: .data.title, added: .data.dateAdded}]'
```

### Items in a collection

```bash
curl -s "http://localhost:23119/api/users/0/collections/COLLKEY/items?itemType=-attachment%20-note%20-annotation" | jq '[.[] | {key, title: .data.title}]'
```

### List collections

```bash
curl -s "http://localhost:23119/api/users/0/collections" | jq '[.[] | {key: .key, name: .data.name}]'
```

## Pagination

The API returns max 100 items per request. Use `start` offset:

```bash
# First page
curl -s "http://localhost:23119/api/users/0/items?limit=100&start=0&itemType=-attachment%20-note%20-annotation"
# Second page
curl -s "http://localhost:23119/api/users/0/items?limit=100&start=100&itemType=-attachment%20-note%20-annotation"
```

Total count is in the `Total-Results` response header:

```bash
curl -sI "http://localhost:23119/api/users/0/items?limit=0&itemType=-attachment%20-note%20-annotation" | grep Total-Results
```

## Limitations

- No semantic/hybrid search (only keyword matching via `q` parameter)
- No fulltext search (the local API's `/fulltext` endpoint is limited)
- Requires Zotero to be running
- No caching: every call hits the API
