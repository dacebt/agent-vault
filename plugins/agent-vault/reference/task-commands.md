# Task commands

`bin/task-db.py` is the SQLite task helper bundled with agent-vault. Resolve its
absolute path from the installed plugin location in either Claude Code or Codex.
Commands return JSON on stdout; errors go to stderr with a nonzero exit status.
Subcommand `--help` lists the accepted arguments.

## Locate the project and task

Run `bin/resolve-project.sh` from the source checkout to resolve its vault project.
The database is `<project-path>/tasks/tasks.sqlite3`. `bin/find-vault.sh` resolves
the containing vault root from `AGENT_VAULT` or `~/agent-vault`.

Task arguments accept a UUID, a `task:<uuid>` URI, or a case-insensitive display
key. Use `list` to find a task by its content when its identifier is unknown.
The UUID and task URI remain stable through edits and status changes.

## Operations

Each operation below follows `python3 <plugin-root>/bin/task-db.py`.

| Operation and arguments | Behavior |
|---|---|
| `init <project>` | Initialize the task database; does not scaffold the rest of the vault. |
| `create <project> --key <key> --title <title>` | Create a backlog task with a generated UUID. Optional: `--description`, `--priority`, `--tags <csv>`, `--body-file <path>`. |
| `list <project> [--status <status>]` | List all tasks, or filter by status. Repeat `--status` to include several statuses. |
| `show <project> <task>` | Read one complete task record. |
| `update <project> <task> [fields]` | Edit `--title`, `--description`, `--priority`, `--milestone`, `--sort-order`, `--tags <csv>`, or `--body-file <path>`. Omitted fields are preserved. |
| `transition <project> <task> <status> [--note <text>]` | Move directly to any supported status; optionally append context to the task body. |
| `validate <project>` | Check the supported schema version, SQLite integrity, and task record decoding. |

For `create` and `update`, `--body-file -` reads Markdown from stdin. A body update
replaces the whole body: read the existing record when preserving or appending
content. `--tags ''` clears tags. On `update`, repeat `--clear <field>` to set
`description`, `priority`, `milestone`, or `sort_order` to SQL NULL. Setting and
clearing the same field in one call is an argument error.

`create`, `update`, and `transition` accept `--actor` for provenance. They maintain
timestamps automatically. `task_key` and UUID are identifiers, not editable fields.

## Status changes

Supported statuses are `backlog`, `todo`, `in-progress`, `blocked`, and `done`.
Any status can move directly to any other. Acceptance text, outcome notes,
blocker or reopening reasons, and active-task counts never block a move.
Moving to the current status is a no-op, including when `--note` is supplied.

Entering `in-progress` records the first start time. Entering `done` records
completion time; reopening clears completion time while preserving the original
start time. Optional notes are appended on a change; without one the task body
is preserved. Moving a card does not assert that its original scope was implemented.

The helper writes the database; it does not commit or push. The existing durability
helper is `bin/vault-commit.sh <message> <changed-file>...`; for a task-only change,
the changed file is `<project-path>/tasks/tasks.sqlite3`.
