# Task records

Tasks are user-directed work, not an automatic byproduct of observations or decisions.
Read the [task-command reference](../../../reference/task-commands.md) before creating
or updating a task. Use its helper for SQLite access; do not create task Markdown
files or substitute ad-hoc SQL.

Read existing tasks before creating one. Extend the intended task when the request
concerns existing work. For a new task, retain the project's display-key prefix and
number width and choose the next unused number. If none exists, choose a short
uppercase project prefix starting at `001`. The helper supplies the immutable UUID,
backlog default, and timestamps.

Compose the body from the requested outcome and known context. When acceptance is
known, express it as natural prose that helps future work recognize a satisfactory
resolution. Preserve room for investigation and judgment; include strict requirements
only when established by the user or project. Missing acceptance, outcomes, reasons,
or links never block the requested creation, edit, or status move.

Use `create` with `--body-file` for a new record and `update` for an existing one.
A body update replaces the stored body, so read it first and preserve content outside
the requested edit. The command reference owns the arguments for metadata, tags,
field clearing, and status changes.

Link relevant motivating concepts when known; task links use `task:<uuid>`, never a
display key or status-dependent file path. The task board supplies the index for
these database concepts. Commit `tasks/tasks.sqlite3` and any Markdown records whose
relationships you actually changed, using capture's scoped durability guidance.
