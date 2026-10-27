# Tasks

The user's todos live in a self-hosted Plane Community Edition instance (https://plane.so), not in the vault, and every read and write goes through the `plane` CLI (https://github.com/sylvainHellin/plane-cli, `cargo install --path .` from a clone).
It reads the API token itself, resolves `PROJ-12` in one call, paginates, resolves names, and converts markdown to the HTML the API stores; a raw `curl` is the exception ([api.md](api.md)).
Give the agent its own Plane user and token if you want its writes attributed to it; `PLANE_API_KEY` overrides the configured token for one call.

## Which command answers which question

`plane <cmd> --help` is the source of truth for flags.

| Need | Command |
|---|---|
| Read one ticket, from an identifier or a pasted link | `plane issue get PROJ-12` |
| See what is open in an area | `plane issue list PROJ [--state todo] [--module "<module>"] [--label waiting]` |
| Create work | `plane issue create PROJ "title" [--module M] [--state S] [--priority P] [--start YYYY-MM-DD] [--due YYYY-MM-DD] [--label L] [--desc-md -]` |
| Create from a bridged vault note | `plane issue create --from-note <note.md> "title"` |
| Change anything, closing included | `plane issue update PROJ-12 --state done`, `plane issue update PROJ-12 --label waiting`, `plane issue update PROJ-12 --desc-md - < /tmp/desc.md` |
| Assign or hand off a ticket | `plane issue update PROJ-12 --assignee <first name>` (or `--assignee none` to clear) |
| Leave a note on a ticket | `plane issue comment PROJ-12 "text"` |
| Put files on a ticket, or see what is there | `plane issue attach PROJ-12 <file> [<file> ...]`, `plane issue attachments PROJ-12` |
| Read the live structure | `plane project list`, `plane module list PROJ`, `plane state list PROJ`, `plane label list PROJ` |

`--json` is global and prints compact resolved JSON (names, no UUIDs, `identifier`, `state`, `modules`, `due`, ...), so `plane issue get PROJ-12 --json | jq -r .name` works on every command; `--raw` prints the raw API body.
State, module, priority and label names match case- and separator-insensitively (`--state in-progress` lands), and a name that matches nothing errors with the real list.
Closing is `--state done`; there is no `close` subcommand.

A pasted `<web base>/<workspace>/browse/<IDENT>-<n>/` link is a ticket: parse the identifier and run `plane issue get`, since a `web fetch` of a single-page app returns a loading spinner and a 200 for any path, real or not.

## Footguns

- `--label` and `--assignee` replace the whole set, so pass every value in one call: `--label waiting --label bug`.
  Removing every label is not expressible; `--assignee none` clears the assignees.
- `--desc-md` takes text or `-` for stdin, never a path: a path is stored verbatim and the write still reports success, so use `--desc-md - < /tmp/desc.md`.
  Write that file with the write tool, not a heredoc, so a description mentioning a destructive command does not trip a command guard.
- Post-process with `jq`, not an inline `python3 -c`.

The rest (config and auth, assignees, attachments, modules, sub-issues, project rules): [gotchas.md](gotchas.md).
Raw endpoints for what the CLI lacks: [api.md](api.md).

## The boundary with the vault

The vault (`knowledge` skill) holds what something is, what was decided and what was learned.
Plane holds what is still to do, where a project stands, and the handoff notes that go stale within weeks.

A vault area maps to a Plane project, and a vault project usually to a module.
The bridge is this frontmatter on the vault note:

```yaml
plane_workspace: <workspace-slug>
plane_project: PROJ                 # the identifier, not the display name
plane_project_id: <project uuid>
plane_module: <module name>         # omit both module keys when there is no module
plane_module_id: <module uuid>
```

`--from-note` reads those keys, so creating an issue for a note needs no UUID lookup.
The note also carries a `Tasks: [<Module or project> in Plane](<web base>/<workspace>/projects/<uuid>/modules/<uuid>/)` line (ending at `/issues/` without a module).

When a project closes in Plane, write its durable outcomes (decisions, numbers, lessons, contacts) into the vault note before archiving.
Plane Pages cannot be reached with an API token, so anything an agent must find again goes in an issue description or comment.

## Structure

One workspace can hold every area of your work, since Plane CE has no cross-workspace view.
Projects are durable areas (research, teaching, personal, ...); modules hold work with an end (a paper, an event, a thesis, a product milestone) and change as deliverables ship, so read them live with `plane module list PROJ`.
An issue with no module is standing work for the area; a new issue for a course, event or thesis almost always belongs in a module.
A module becomes its own project only past ~15 live issues or with its own collaborators.

## Conventions

State mapping, so the board means the same thing every time:

| State | When |
|---|---|
| Backlog | someday, not yet committed to |
| Todo | committed, next up |
| In Progress | actually being worked on now |
| Done / Cancelled | terminal |

Dates mark real deadlines only.
`--due` goes on an issue when something outside the user's planning fixes the date: a legal or filing period, a submission or review deadline, an event's lead time, a date promised to someone.
Use that real date, not a self-set buffer.
A start date is the day the work must begin: either it cannot begin earlier, or the due date needs that much lead time.
Everything else stays undated and is ranked by priority, so an overdue issue always means a real consequence.
Every open issue carries a priority; `none` means not yet triaged.
Clearing a date is `plane issue update REF --due none` / `--start none`.

Keep a small label set, identical in every project, for example:

| Label | Means |
|---|---|
| `waiting` | the ball is with someone else |
| `bug` | a defect in software you maintain |
| `feature` | a new capability asked of software you maintain |

Labels are per project in Plane, so a new label is created in every project or cross-project filtering silently breaks ([api.md](api.md)).

Waiting on someone else is Todo plus the `waiting` label, with `Waiting for: <who and what>` as the first line of the description.
It is not a separate state, because the ball is still the user's to chase.

Priority `urgent` is reserved for real fires.
Reaching for it to mean "important" destroys the signal; use `high`.

An issue an agent creates ends its description with an italic provenance line saying where it came from (the vault note, the meeting, the conversation), so the origin survives when the context does not.
Vault wikilinks do not resolve in Plane, so flatten `[[Note|alias]]` to its text before sending and keep the link on the vault side of the bridge.
