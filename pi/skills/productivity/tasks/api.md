# Plane CE: what the `plane` CLI does not cover

The binary owns issue reads and writes, labels and attachments, module and state lookups, pagination, identifier resolution, and the markdown-to-`description_html` conversion.
This file is the fallback for the operations it has no command for: creating a label, reading comments back, deletion, and project and module creation.
The endpoint facts the binary already encodes are in its README (https://github.com/sylvainHellin/plane-cli), not repeated here.

## Shape of a raw call

```bash
PAT=${PLANE_API_KEY:-$(sed -n 's/^api_key *= *"\(.*\)"$/\1/p' ~/.config/plane/config.toml)}
B=<your api base, e.g. http://localhost:8090/api/v1>
curl -s -H "X-API-Key: $PAT" "$B/workspaces/<ws>/projects/"
```

That is the key the CLI uses, so a raw write is authored by the same Plane user as a CLI write, and the token never reaches the terminal.

Trailing slashes are mandatory (`projects` returns 301, `projects/` returns 200), writes take `Content-Type: application/json`, and the limit is sixty requests per minute per token, so a bulk pass sleeps ~1.1 s between calls.
If the instance sits behind a certificate your system trusts but Python's bundle does not (a private CA, a tailnet certificate), stay on `curl`: a Python client fails with `CERTIFICATE_VERIFY_FAILED` where `curl` succeeds.

`<ws>` is the workspace slug, `<proj>` a project UUID, `<issue>` an issue UUID.

| Purpose | Call |
|---|---|
| Create a label | `POST /workspaces/<ws>/projects/<proj>/labels/` with `{"name": ..., "color": "#rrggbb"}` |
| Read comments back | `GET /workspaces/<ws>/projects/<proj>/issues/<issue>/comments/` |
| List who can be assigned | `GET /workspaces/<ws>/projects/<proj>/members/` (a bare array of user objects; assignability is project membership, not workspace membership) |
| Add a workspace member to a project | `POST /workspaces/<ws>/projects/<proj>/members/` with `{"member": "<user_id>", "role": 15}` (`role` 20 admin, 15 member, 5 guest; `<user_id>` from `GET /workspaces/<ws>/members/`) |
| Delete an issue | `DELETE /workspaces/<ws>/projects/<proj>/issues/<issue>/` (403 for a plain project member; 204 for an admin, and only on the user's explicit request) |
| Set an issue's parent, making it a sub-issue | `PATCH /workspaces/<ws>/projects/<proj>/issues/<issue>/` with `{"parent": "<parent issue uuid>"}` |
| Create a project | `POST /workspaces/<ws>/projects/` with `{"name": ..., "identifier": ...}` |
| Update / delete a project | `PATCH` / `DELETE /workspaces/<ws>/projects/<proj>/` (delete returns 204 and takes its issues with it) |
| Create / delete a module | `POST` / `DELETE /workspaces/<ws>/projects/<proj>/modules/` with `{"name": ..., "start_date": ..., "target_date": ...}` |
| Rename a module | `PATCH /workspaces/<ws>/projects/<proj>/modules/<module>/` with `{"name": ...}` |
| Check a module's issues | `GET /workspaces/<ws>/projects/<proj>/modules/<module>/module-issues/` |
| Detach an issue from a module | `DELETE /workspaces/<ws>/projects/<proj>/modules/<module>/module-issues/<issue>/` (204) |
| Clear a parent | `PATCH .../issues/<issue>/` with `{"parent": null}` |

Labels and states are UUIDs on the wire, so a raw write fetches `/labels/` or `/states/` for that project first and maps by name; a name in the body is accepted-looking and wrong.
Those UUIDs are per project, which is why shared labels have to be created once per project.
`description_html` is the stored field, so markdown written into it stays literal; convert before the write.
`created_at` cannot be set, so an imported item's real origin date belongs in the provenance line.

Sub-issues nest freely: the `parent` field is a plain FK, a grandchild is accepted, and `GET /issues/` reports it so a whole tree rebuilds from one list call by mapping `parent` uuids back to `sequence_id`.
An issue an agent cannot delete (403) gets `--state cancelled` plus a comment naming its replacement instead, which leaves the trail the user needs to clear it from the UI.

The CLI's `--module` adds a relation instead of replacing one, so moving an issue between modules is that `--module` call plus the `module-issues` `DELETE` above; skipping the second half leaves it on both boards.

## Projects and modules

A new project ships with modules and views disabled.
`POST /modules/` answers `{"non_field_errors": ["Modules are not enabled for this project"]}` until the project is patched:

```bash
curl -s -X PATCH -H "X-API-Key: $PAT" -H "Content-Type: application/json" \
  -d '{"module_view": true, "issue_views_view": true, "cycle_view": false}' \
  "$B/workspaces/<ws>/projects/<proj>/"
```

Project `name` and `identifier` are unique per workspace, so recreating a project under a name still held by an old one fails with 409 "The project name is already taken".
Rename the old one out of the way first; `PATCH`ing `identifier` re-keys its issues immediately and harmlessly.

Verify a module link from the module side, never the issue side.
`GET /issues/<issue>/` keeps reporting `"module": null` after a successful attachment, because the relation lives in a join table rather than on the issue record, so re-POSTing on the strength of that null creates duplicate work for nothing.
The `results[]` entries of `module-issues/` are the issue objects themselves (`.results[].name`, `.results[].sequence_id`), not wrappers with an `issue_detail` key.

## Writing payloads

Send anything beyond a trivial body from a file with `-d @/tmp/payload.json` rather than a quoted inline string.
Guarded shells reject a long single-quoted `-d '{...}'` form, and an issue description holding apostrophes or umlauts is exactly where inline quoting breaks.

Keep those payload files ASCII where you can: a mojibaked title is permanent.
