# `plane` CLI: what `--help` will not tell you

The most frequent footguns (`--label` and `--assignee` replace the set, `--desc-md` takes stdin, `jq` over `python3 -c`) sit in `SKILL.md`; this file holds the rest.
Raw endpoints for anything the CLI lacks: `api.md`.

## Instance and auth

- The instance is named by `~/.config/plane/config.toml`, not by the environment, so every context that runs the binary sees the same settings.
  `plane config show` prints each setting next to its source (`env`, `file`, `default`, or `unset`), and `plane config set <key> <value>` writes one.
- `workspace` is required; `api_base` defaults to `http://localhost:8090/api/v1`, and `web_base` adds a `url:` line to every issue printout.
- Any setting is overridable for a single call by its variable, e.g. `PLANE_API_BASE=... plane project list`.
- The binary reads the token itself (`PLANE_API_KEY`, then the `api_key` line of the config file, then the secret store described in the README), so no token goes through the shell or a temporary file.
- A 502 right after a reboot or a stack restart is usually the API still booting (about 90 s), not a fault.

## Assignees

- `--assignee` (on `create` and `update`) takes a person, not a UUID: a first name, display name, or email, matched against the project's members.
- It is repeatable and, like `--label`, replaces the set; `--assignee none` clears every assignee, and `plane issue get` shows the `assigned:` line.
- Only project members are assignable, since Plane offers no one else in its dropdown and the API rejects the rest.
- A workspace member added later is not assignable until they are added to the project too, a raw `POST /projects/<id>/members/` ([api.md](api.md)).

## Descriptions, comments, attachments

- `plane issue update --desc-md` replaces the whole description, since Plane has no append, so carry over any existing text you want to keep.
- Comments take markdown on the way in, so a follow-up usually belongs in `plane issue comment` rather than in an edited description.
- `plane issue attach` is not transactional.
  Each file is an independent upload, reported as it lands, and a failure halfway names the ones already attached, so retry only the files still missing; re-running the whole list attaches the earlier ones twice.

## Modules and sub-issues

- A module attach is invisible from the issue record: CE keeps the relation in a join table and keeps answering `"module": null`.
  Verify from the module side with `plane issue list PROJ --module M` rather than re-attaching.
- `--module` on `update` adds a module rather than moving between them, so the issue then shows on both boards.
  Dropping the old relation is a raw `DELETE` on `module-issues` ([api.md](api.md)); re-list both modules after a move.
- `--from-note` reads `plane_project_id` and `plane_module_id` from the note's frontmatter; a note with no module id creates at project level instead of failing.
- Sub-issues are a raw `PATCH` of the `parent` field ([api.md](api.md)), since the CLI has no flag for it.
  A parent issue keeps a work stream of more than three steps legible on a board sized in the dozens.

## Projects

- Project names cannot contain `-` `.` `,` `:` `(` `)` `&`; Plane rejects them with "Project name cannot contain special characters".
  Slashes, underscores, digits and umlauts pass, and module names have no such restriction.
- An issue's project is immutable: a `PATCH` with a new project UUID returns 200 and keeps the old value.
  Moving an issue to another project means recreating it there and deleting the original ([api.md](api.md)).
