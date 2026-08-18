#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_store  # noqa: E402

MIGRATION_ACTOR = "process:agent-vault-task-markdown-migration"
STATUS_DIRECTORIES = {"backlog", "todo", "in-progress", "done"}
KNOWN_FIELDS = {
    "completed",
    "completed_at",
    "created",
    "created_at",
    "description",
    "extensions",
    "generated",
    "milestone",
    "order",
    "priority",
    "sources",
    "started",
    "started_at",
    "status",
    "tags",
    "task_status",
    "timestamp",
    "title",
    "type",
    "verified",
}
MARKDOWN_LINK_RE = re.compile(r"(?P<prefix>\[[^\]]*\]\()(?P<target>[^)]+)(?P<suffix>\))")
WIKILINK_RE = re.compile(r"\[\[(?P<target>[^\]|#]+)(?P<fragment>#[^\]|]+)?(?:\|(?P<label>[^\]]+))?\]\]")


class MigrationError(RuntimeError):
    pass


def emit(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def task_namespace(project_name: str) -> uuid.UUID:
    project_namespace = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/dacebt/agent-vault/task-import/projects")
    return uuid.uuid5(project_namespace, project_name.casefold())


def imported_task_id(project_name: str, task_key: str) -> str:
    return str(uuid.uuid5(task_namespace(project_name), task_key.casefold()))


def normalize_iso(value: Any, field: str) -> str:
    text = str(value).strip()
    if not text:
        raise MigrationError(f"{field} must not be empty")
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return datetime.combine(date.fromisoformat(text), datetime.min.time(), timezone.utc).isoformat()
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except ValueError as error:
        raise MigrationError(f"{field} is not ISO 8601: {value!r}") from error


def git_timestamp(project: Path, relative: str, *, oldest: bool = False) -> str | None:
    root = subprocess.run(
        ["git", "-C", str(project), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    if root.returncode != 0:
        return None
    git_root = Path(root.stdout.strip()).resolve()
    absolute = (project / relative).resolve()
    try:
        git_relative = absolute.relative_to(git_root).as_posix()
    except ValueError:
        return None
    command = ["git", "-C", str(git_root), "log", "--follow", "--format=%cI"]
    if oldest:
        command.append("--reverse")
    command.extend(["--", git_relative])
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines[0] if lines else None


def require_optional_list(frontmatter: dict[str, Any], field: str) -> list[Any]:
    value = frontmatter.get(field, [])
    if value is None:
        return []
    if not isinstance(value, list):
        raise MigrationError(f"{field} must be a YAML list")
    return value


def optional_text(frontmatter: dict[str, Any], field: str) -> str | None:
    value = frontmatter.get(field)
    if value is None:
        return None
    if not isinstance(value, (str, int, float)):
        raise MigrationError(f"{field} must be a scalar")
    return str(value)


def task_from_record(project: Path, record: dict[str, Any]) -> dict[str, Any]:
    relative = PurePosixPath(record["path"])
    if len(relative.parts) != 3 or relative.parts[0] != "tasks":
        raise MigrationError("task record must live directly in tasks/<status>/")
    directory_status = relative.parts[1]
    if directory_status not in STATUS_DIRECTORIES:
        raise MigrationError(f"unsupported task status directory: {directory_status}")

    frontmatter = record["frontmatter"]
    if frontmatter.get("type") != "task":
        raise MigrationError(f"type must be 'task', got {frontmatter.get('type')!r}")
    title = frontmatter.get("title")
    if not isinstance(title, str) or not title.strip():
        raise MigrationError("title must be a non-empty string")

    okf_status = frontmatter.get("status", "stable")
    if okf_status not in task_store.OKF_STATUSES:
        raise MigrationError(f"invalid lifecycle status: {okf_status!r}")
    explicit_task_status = frontmatter.get("task_status")
    task_status = explicit_task_status or directory_status
    if task_status not in task_store.TASK_STATUSES:
        raise MigrationError(f"invalid task_status: {task_status!r}")
    if task_status == "blocked":
        if directory_status != "in-progress":
            raise MigrationError("blocked task must come from tasks/in-progress/")
    elif task_status != directory_status:
        raise MigrationError(
            f"task_status {task_status!r} conflicts with directory {directory_status!r}"
        )

    generated = frontmatter.get("generated") or {}
    if not isinstance(generated, dict):
        raise MigrationError("generated must be a YAML mapping")
    generated_at_value = generated.get("at") or frontmatter.get("timestamp")
    created_value = frontmatter.get("created_at") or frontmatter.get("created")
    if generated_at_value:
        generated_at = normalize_iso(generated_at_value, "generated.at")
    elif created_value:
        generated_at = normalize_iso(created_value, "created")
    else:
        generated_at = git_timestamp(project, record["path"]) or task_store.now_iso()
    if created_value:
        created_at = normalize_iso(created_value, "created")
    else:
        created_at = git_timestamp(project, record["path"], oldest=True) or generated_at

    started_value = frontmatter.get("started_at") or frontmatter.get("started")
    completed_value = frontmatter.get("completed_at") or frontmatter.get("completed")
    started_at = normalize_iso(started_value, "started") if started_value else None
    completed_at = normalize_iso(completed_value, "completed") if completed_value else None
    if task_status == "done" and not completed_at:
        historical = git_timestamp(project, record["path"])
        if not historical:
            raise MigrationError(
                "done task has no completion timestamp and no Git history proving one"
            )
        completed_at = normalize_iso(historical, "Git completion timestamp")
    if task_status != "done" and completed_at:
        raise MigrationError("open task must not declare a completion timestamp")

    sort_order = frontmatter.get("order")
    if sort_order is not None and (not isinstance(sort_order, int) or isinstance(sort_order, bool)):
        raise MigrationError("order must be an integer")
    existing_extensions = frontmatter.get("extensions") or {}
    if not isinstance(existing_extensions, dict):
        raise MigrationError("extensions must be a YAML mapping")
    unknown = {key: value for key, value in frontmatter.items() if key not in KNOWN_FIELDS}
    migration_extension: dict[str, Any] = {"legacy_path": record["path"]}
    if unknown:
        migration_extension["legacy_frontmatter"] = unknown
    extensions = dict(existing_extensions)
    if "agent_vault_task_migration" in extensions:
        raise MigrationError("extensions.agent_vault_task_migration is reserved for the importer")
    extensions["agent_vault_task_migration"] = migration_extension

    task_key = relative.stem
    return {
        "id": imported_task_id(project.name, task_key),
        "task_key": task_key,
        "title": title.strip(),
        "description": optional_text(frontmatter, "description"),
        "okf_status": okf_status,
        "task_status": task_status,
        "priority": optional_text(frontmatter, "priority"),
        "milestone": optional_text(frontmatter, "milestone"),
        "sort_order": sort_order,
        "body_markdown": record["body_markdown"],
        "tags": require_optional_list(frontmatter, "tags"),
        "sources": require_optional_list(frontmatter, "sources"),
        "verified": require_optional_list(frontmatter, "verified"),
        "extensions": extensions,
        "generated_by": str(generated.get("by") or MIGRATION_ACTOR),
        "generated_at": generated_at,
        "created_at": created_at,
        "started_at": started_at,
        "completed_at": completed_at,
        "legacy_path": record["path"],
    }


def normalize_bundle_path(source: str, target: str) -> tuple[str | None, str]:
    raw = target.strip()
    if raw.startswith("<") and raw.endswith(">"):
        raw = raw[1:-1]
    suffix = ""
    for marker in ("#", "?"):
        if marker in raw:
            raw, remainder = raw.split(marker, 1)
            suffix = marker + remainder
            break
    if not raw.endswith(".md"):
        return None, suffix
    candidate = PurePosixPath(raw) if raw.startswith("/") else PurePosixPath(source).parent / raw
    parts: list[str] = []
    for part in candidate.parts:
        if part in ("", "/", "."):
            continue
        if part == "..":
            if not parts:
                return None, suffix
            parts.pop()
        else:
            parts.append(part)
    return "/".join(parts), suffix


def rewrite_links(
    markdown: str,
    source: str,
    path_to_uri: dict[str, str],
    key_to_uri: dict[str, str],
) -> tuple[str, int, list[str]]:
    count = 0
    errors: list[str] = []

    def markdown_replacement(match: re.Match[str]) -> str:
        nonlocal count
        target = match.group("target")
        resolved, suffix = normalize_bundle_path(source, target)
        if resolved in path_to_uri:
            count += 1
            return f"{match.group('prefix')}{path_to_uri[resolved]}{suffix}{match.group('suffix')}"
        if resolved and resolved.startswith("tasks/") and resolved not in {"tasks/index.md", "tasks/log.md"}:
            errors.append(f"{source}: unresolved legacy task link {target!r}")
        return match.group(0)

    rewritten = MARKDOWN_LINK_RE.sub(markdown_replacement, markdown)

    def wiki_replacement(match: re.Match[str]) -> str:
        nonlocal count
        target = match.group("target").strip()
        key = PurePosixPath(target).stem.casefold()
        uri = key_to_uri.get(key)
        if not uri:
            return match.group(0)
        count += 1
        label = match.group("label") or PurePosixPath(target).stem
        return f"[{label}]({uri}{match.group('fragment') or ''})"

    return WIKILINK_RE.sub(wiki_replacement, rewritten), count, errors


def load_manifest(project: Path) -> dict[str, Any]:
    parser = PLUGIN_ROOT / "bin/task-markdown-manifest.rb"
    result = subprocess.run(
        ["ruby", str(parser), str(project)], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise MigrationError(result.stderr.strip() or "Ruby task manifest parser failed")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise MigrationError("Ruby task manifest parser returned invalid JSON") from error


def build_plan(project: Path) -> dict[str, Any]:
    if task_store.database_path(project).exists():
        raise MigrationError(f"task database already exists: {task_store.database_path(project)}")
    manifest = load_manifest(project)
    errors = list(manifest.get("errors", []))
    records = manifest.get("records", [])
    if not records and not errors:
        errors.append("no legacy task Markdown records found")

    tasks: list[dict[str, Any]] = []
    for record in records:
        try:
            tasks.append(task_from_record(project, record))
        except (MigrationError, ValueError, TypeError) as error:
            errors.append(f"{record.get('path', '<unknown>')}: {error}")
    task_keys = [task["task_key"].casefold() for task in tasks]
    duplicates = sorted({key for key in task_keys if task_keys.count(key) > 1})
    if duplicates:
        errors.append(f"duplicate task keys: {', '.join(duplicates)}")
    if errors:
        raise MigrationError("preflight failed:\n- " + "\n- ".join(errors))

    path_to_uri = {task["legacy_path"]: task_store.task_uri(task["id"]) for task in tasks}
    key_to_uri = {task["task_key"].casefold(): task_store.task_uri(task["id"]) for task in tasks}
    rewrites = 0
    rewrite_errors: list[str] = []
    for task in tasks:
        body, count, task_errors = rewrite_links(
            task["body_markdown"], task["legacy_path"], path_to_uri, key_to_uri
        )
        task["body_markdown"] = body
        rewrites += count
        rewrite_errors.extend(task_errors)

    documents: dict[str, str] = {}
    source_paths = set(path_to_uri)
    for path in sorted(project.rglob("*.md")):
        relative = path.relative_to(project).as_posix()
        if relative in source_paths:
            continue
        original = path.read_text(encoding="utf-8")
        rewritten, count, document_errors = rewrite_links(
            original, relative, path_to_uri, key_to_uri
        )
        rewrites += count
        rewrite_errors.extend(document_errors)
        if rewritten != original:
            documents[relative] = rewritten
    if rewrite_errors:
        raise MigrationError("link preflight failed:\n- " + "\n- ".join(sorted(set(rewrite_errors))))

    with tempfile.TemporaryDirectory(prefix="agent-vault-task-migration-check-") as temporary:
        staged_db = Path(temporary) / "tasks.sqlite3"
        task_store.initialize_path(staged_db, project.name)
        connection = task_store.connect_path(staged_db)
        try:
            with connection:
                for task in tasks:
                    task_store.insert_task(
                        connection, {key: value for key, value in task.items() if key != "legacy_path"}
                    )
            validation_errors = task_store.validate_database(connection)
            stored_count = connection.execute("SELECT count(*) FROM tasks").fetchone()[0]
        finally:
            connection.close()
        if validation_errors:
            raise MigrationError("staged database invalid: " + "; ".join(validation_errors))
        if stored_count != len(records):
            raise MigrationError(f"record parity failed: source={len(records)} database={stored_count}")

    return {
        "tasks": tasks,
        "documents": documents,
        "link_rewrites": rewrites,
        "source_count": len(records),
    }


def atomic_write(path: Path, content: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def create_backup(project: Path, paths: list[str], report: dict[str, Any]) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = project / "tasks" / f"legacy-markdown-backup-{timestamp}.tar.gz"
    if backup.exists():
        raise MigrationError(f"backup already exists: {backup}")
    manifest = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True).encode()
    with tarfile.open(backup, "w:gz") as archive:
        for relative in sorted(set(paths)):
            archive.add(project / relative, arcname=relative, recursive=False)
        info = tarfile.TarInfo("migration-report.json")
        info.size = len(manifest)
        info.mtime = int(datetime.now().timestamp())
        archive.addfile(info, io.BytesIO(manifest))
    return backup


def remove_legacy_records(project: Path, source_paths: list[str]) -> None:
    for relative in source_paths:
        (project / relative).unlink()
    for status in sorted(STATUS_DIRECTORIES):
        directory = project / "tasks" / status
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()


def apply_plan(project: Path, plan: dict[str, Any]) -> Path:
    source_paths = [task["legacy_path"] for task in plan["tasks"]]
    changed_paths = sorted(plan["documents"])
    rollback_paths = sorted(set(source_paths + changed_paths))
    rollback_root = Path(tempfile.mkdtemp(prefix="agent-vault-task-migration-rollback-"))
    staged_root = Path(tempfile.mkdtemp(prefix="agent-vault-task-migration-db-"))
    backup: Path | None = None
    database = task_store.database_path(project)
    try:
        for relative in rollback_paths:
            target = rollback_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(project / relative, target)

        public_report = {
            "source_count": plan["source_count"],
            "link_rewrites": plan["link_rewrites"],
            "documents_rewritten": changed_paths,
            "tasks": [
                {
                    "id": task["id"],
                    "key": task["task_key"],
                    "source": task["legacy_path"],
                    "status": task["task_status"],
                    "uri": task_store.task_uri(task["id"]),
                }
                for task in plan["tasks"]
            ],
        }
        backup = create_backup(project, rollback_paths, public_report)
        staged_db = staged_root / "tasks.sqlite3"
        task_store.initialize_path(staged_db, project.name)
        connection = task_store.connect_path(staged_db)
        try:
            with connection:
                for task in plan["tasks"]:
                    task_store.insert_task(
                        connection, {key: value for key, value in task.items() if key != "legacy_path"}
                    )
            validation_errors = task_store.validate_database(connection)
        finally:
            connection.close()
        if validation_errors:
            raise MigrationError("staged database invalid: " + "; ".join(validation_errors))

        for relative, content in plan["documents"].items():
            atomic_write(project / relative, content)
        os.replace(staged_db, database)

        connection = task_store.connect(project)
        try:
            validation_errors = task_store.validate_database(connection)
            stored_count = connection.execute("SELECT count(*) FROM tasks").fetchone()[0]
        finally:
            connection.close()
        if validation_errors or stored_count != plan["source_count"]:
            raise MigrationError("written database failed parity validation")

        remove_legacy_records(project, source_paths)
        if any((project / relative).exists() for relative in source_paths):
            raise MigrationError("legacy task records remained after migration")
        return backup
    except BaseException:
        if database.exists():
            database.unlink()
        for relative in rollback_paths:
            source = rollback_root / relative
            target = project / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        if backup and backup.exists():
            backup.unlink()
        raise
    finally:
        shutil.rmtree(rollback_root, ignore_errors=True)
        shutil.rmtree(staged_root, ignore_errors=True)


def public_plan(plan: dict[str, Any], *, write: bool, backup: Path | None = None) -> dict[str, Any]:
    return {
        "mode": "write" if write else "dry-run",
        "database": "tasks/tasks.sqlite3",
        "source_count": plan["source_count"],
        "link_rewrites": plan["link_rewrites"],
        "documents_rewritten": sorted(plan["documents"]),
        "backup": str(backup) if backup else None,
        "tasks": [
            {
                "id": task["id"],
                "key": task["task_key"],
                "source": task["legacy_path"],
                "status": task["task_status"],
                "uri": task_store.task_uri(task["id"]),
            }
            for task in plan["tasks"]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate one project from Markdown task records to SQLite task concepts"
    )
    parser.add_argument("project")
    parser.add_argument("--write", action="store_true", help="apply the validated migration")
    args = parser.parse_args()
    project = Path(args.project).resolve()
    if not project.is_dir():
        raise MigrationError(f"project directory does not exist: {project}")
    plan = build_plan(project)
    backup = apply_plan(project, plan) if args.write else None
    emit(public_plan(plan, write=args.write, backup=backup))


if __name__ == "__main__":
    try:
        main()
    except (MigrationError, task_store.TaskStoreError, OSError, ValueError) as error:
        print(f"migrate-task-markdown: {error}", file=sys.stderr)
        raise SystemExit(1) from error
