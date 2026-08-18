from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1
DATABASE_RELATIVE_PATH = Path("tasks/tasks.sqlite3")
TASK_URI_RE = re.compile(
    r"^task:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$",
    re.IGNORECASE,
)
TASK_STATUSES = ("backlog", "todo", "in-progress", "blocked", "done")
OKF_STATUSES = ("draft", "stable", "deprecated")
TRANSITIONS = {
    "backlog": {"todo"},
    "todo": {"in-progress"},
    "in-progress": {"blocked", "done"},
    "blocked": {"in-progress", "done"},
    "done": {"in-progress"},
}
DEFAULT_ACTOR = "process:agent-vault-task-store"


class TaskStoreError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def database_path(project_path: str | Path) -> Path:
    return Path(project_path).resolve() / DATABASE_RELATIVE_PATH


def task_uri(task_id: str) -> str:
    normalized = str(uuid.UUID(task_id))
    return f"task:{normalized}"


def parse_task_uri(value: str) -> str | None:
    match = TASK_URI_RE.fullmatch(value.strip())
    return str(uuid.UUID(match.group(1))) if match else None


def _schema_path() -> Path:
    return Path(__file__).resolve().parents[1] / "reference/task-schema.sql"


def connect_path(path: str | Path, *, must_exist: bool = True) -> sqlite3.Connection:
    db_path = Path(path)
    if must_exist and not db_path.is_file():
        raise TaskStoreError(f"task database not found: {db_path}")
    connection = sqlite3.connect(db_path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def connect(project_path: str | Path) -> sqlite3.Connection:
    return connect_path(database_path(project_path))


def initialize_path(path: str | Path, project_name: str) -> Path:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = connect_path(db_path, must_exist=False)
    try:
        connection.executescript(_schema_path().read_text(encoding="utf-8"))
        with connection:
            connection.execute(
                "INSERT OR REPLACE INTO vault_metadata(key, value) VALUES ('project_name', ?)",
                (project_name,),
            )
    finally:
        connection.close()
    return db_path


def initialize(project_path: str | Path) -> Path:
    project = Path(project_path).resolve()
    return initialize_path(database_path(project), project.name)


def _json(value: Any, expected: type, field: str) -> str:
    if value is None:
        value = expected()
    if not isinstance(value, expected):
        raise TaskStoreError(f"{field} must be {expected.__name__}")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _section(body: str, heading: str) -> str | None:
    pattern = re.compile(
        rf"^##\s+{re.escape(heading)}\s*$\n(?P<body>.*?)(?=^##\s+|\Z)",
        re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(body)
    return match.group("body").strip() if match else None


def _task_values(task: dict[str, Any]) -> tuple[Any, ...]:
    task_id = str(uuid.UUID(str(task["id"])))
    task_key = str(task["task_key"]).strip()
    title = str(task["title"]).strip()
    task_status = str(task.get("task_status", "backlog"))
    okf_status = str(task.get("okf_status", "stable"))
    if not task_key:
        raise TaskStoreError("task_key must not be empty")
    if not title:
        raise TaskStoreError("title must not be empty")
    if task_status not in TASK_STATUSES:
        raise TaskStoreError(f"invalid task_status: {task_status}")
    if okf_status not in OKF_STATUSES:
        raise TaskStoreError(f"invalid okf_status: {okf_status}")
    completed_at = task.get("completed_at")
    if (task_status == "done") != bool(completed_at):
        raise TaskStoreError("done tasks require completed_at; open tasks must omit it")
    generated_at = str(task.get("generated_at") or now_iso())
    created_at = str(task.get("created_at") or generated_at)
    return (
        task_id,
        task_key,
        title,
        task.get("description"),
        okf_status,
        task_status,
        task.get("priority"),
        task.get("milestone"),
        task.get("sort_order"),
        str(task.get("body_markdown", "")),
        _json(task.get("tags"), list, "tags"),
        _json(task.get("sources"), list, "sources"),
        _json(task.get("verified"), list, "verified"),
        _json(task.get("extensions"), dict, "extensions"),
        str(task.get("generated_by") or DEFAULT_ACTOR),
        generated_at,
        created_at,
        task.get("started_at"),
        completed_at,
    )


INSERT_TASK_SQL = """
INSERT INTO tasks (
  id, task_key, title, description, okf_status, task_status, priority, milestone,
  sort_order, body_markdown, tags_json, sources_json, verified_json, extensions_json,
  generated_by, generated_at, created_at, started_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def insert_task(connection: sqlite3.Connection, task: dict[str, Any]) -> str:
    values = _task_values(task)
    try:
        connection.execute(INSERT_TASK_SQL, values)
    except sqlite3.IntegrityError as error:
        raise TaskStoreError(f"could not insert task {task.get('task_key')}: {error}") from error
    return values[0]


def create_task(connection: sqlite3.Connection, task: dict[str, Any]) -> str:
    values = dict(task)
    values.setdefault("id", str(uuid.uuid4()))
    values.setdefault("task_status", "backlog")
    values.setdefault("generated_at", now_iso())
    values.setdefault("created_at", values["generated_at"])
    with connection:
        return insert_task(connection, values)


def _decode(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["tags"] = json.loads(result.pop("tags_json"))
    result["sources"] = json.loads(result.pop("sources_json"))
    result["verified"] = json.loads(result.pop("verified_json"))
    result["extensions"] = json.loads(result.pop("extensions_json"))
    result["uri"] = task_uri(result["id"])
    return result


def find_task(connection: sqlite3.Connection, identifier: str) -> dict[str, Any]:
    task_id = parse_task_uri(identifier) or identifier
    row = connection.execute(
        "SELECT * FROM tasks WHERE id = ? OR task_key = ? COLLATE NOCASE",
        (task_id, task_id),
    ).fetchone()
    if row is None:
        raise TaskStoreError(f"task not found: {identifier}")
    return _decode(row)


def list_tasks(
    connection: sqlite3.Connection, statuses: Iterable[str] | None = None
) -> list[dict[str, Any]]:
    selected = list(statuses or TASK_STATUSES)
    invalid = [status for status in selected if status not in TASK_STATUSES]
    if invalid:
        raise TaskStoreError(f"invalid task_status: {', '.join(invalid)}")
    placeholders = ",".join("?" for _ in selected)
    rows = connection.execute(
        f"SELECT * FROM tasks WHERE task_status IN ({placeholders}) "
        "ORDER BY CASE task_status "
        "WHEN 'in-progress' THEN 0 WHEN 'blocked' THEN 1 WHEN 'todo' THEN 2 "
        "WHEN 'backlog' THEN 3 ELSE 4 END, sort_order, generated_at DESC",
        selected,
    ).fetchall()
    return [_decode(row) for row in rows]


def update_task(
    connection: sqlite3.Connection,
    identifier: str,
    changes: dict[str, Any],
    actor: str = DEFAULT_ACTOR,
) -> dict[str, Any]:
    current = find_task(connection, identifier)
    allowed = {"title", "description", "priority", "milestone", "sort_order", "body_markdown"}
    rejected = sorted(set(changes) - allowed)
    if rejected:
        raise TaskStoreError(f"unsupported task fields: {', '.join(rejected)}")
    if not changes:
        return current
    assignments = [f"{field} = ?" for field in changes]
    values = list(changes.values()) + [actor, now_iso(), current["id"]]
    with connection:
        connection.execute(
            f"UPDATE tasks SET {', '.join(assignments)}, generated_by = ?, generated_at = ? "
            "WHERE id = ?",
            values,
        )
    return find_task(connection, current["id"])


def transition_task(
    connection: sqlite3.Connection,
    identifier: str,
    destination: str,
    *,
    actor: str = DEFAULT_ACTOR,
    note: str | None = None,
    allow_wip: bool = False,
) -> dict[str, Any]:
    current = find_task(connection, identifier)
    source = current["task_status"]
    if destination not in TRANSITIONS.get(source, set()):
        raise TaskStoreError(f"invalid task transition: {source} -> {destination}")
    body = current["body_markdown"]
    if source == "backlog" and destination == "todo" and not _section(body, "Acceptance"):
        raise TaskStoreError("backlog -> todo requires a non-empty Acceptance section")
    if destination == "in-progress" and source == "todo" and not allow_wip:
        count = connection.execute(
            "SELECT count(*) FROM tasks WHERE task_status IN ('in-progress', 'blocked')"
        ).fetchone()[0]
        if count >= 2:
            raise TaskStoreError("starting this task would exceed the WIP limit; pass --allow-wip")
    if destination == "done" and not (_section(body, "Outcome") or _section(body, "Outcomes")):
        raise TaskStoreError("completion requires a non-empty Outcome section")
    today = datetime.now().astimezone().date().isoformat()
    if destination == "blocked":
        if not note:
            raise TaskStoreError("blocking a task requires --note")
        body = body.rstrip() + f"\n\n## Blocked by\n{note.strip()}\n"
    if source == "done" and destination == "in-progress":
        if not note:
            raise TaskStoreError("reopening a task requires --note")
        body = body.rstrip() + f"\n\n## Reopened {today}\n{note.strip()}\n"
    timestamp = now_iso()
    started_at = current["started_at"]
    if destination == "in-progress" and not started_at:
        started_at = timestamp
    completed_at = timestamp if destination == "done" else None
    with connection:
        connection.execute(
            "UPDATE tasks SET task_status = ?, body_markdown = ?, started_at = ?, "
            "completed_at = ?, generated_by = ?, generated_at = ? WHERE id = ?",
            (destination, body, started_at, completed_at, actor, timestamp, current["id"]),
        )
    return find_task(connection, current["id"])


def validate_database(connection: sqlite3.Connection) -> list[str]:
    errors: list[str] = []
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version != SCHEMA_VERSION:
        errors.append(f"unsupported schema version: {version}; expected {SCHEMA_VERSION}")
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        errors.append(f"integrity_check: {integrity}")
    try:
        rows = connection.execute("SELECT * FROM tasks").fetchall()
    except sqlite3.DatabaseError as error:
        return errors + [f"tasks schema unavailable: {error}"]
    for row in rows:
        try:
            _decode(row)
            uuid.UUID(row["id"])
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            errors.append(f"task {row['task_key']}: {error}")
    return errors
