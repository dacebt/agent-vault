from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Any

from . import task_store

MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def link_targets(markdown: str) -> list[str]:
    return [match.group(1).strip() for match in MARKDOWN_LINK_RE.finditer(markdown)]


def markdown_concepts(project: Path) -> dict[str, str]:
    concepts: dict[str, str] = {}
    for path in project.rglob("*.md"):
        relative = path.relative_to(project)
        if any(part.startswith(".") for part in relative.parts) or relative.parts[0] == "views":
            continue
        concepts["/" + relative.as_posix()] = path.read_text(encoding="utf-8")
    return concepts


def resolve_markdown_target(source: str, raw_target: str) -> str | None:
    path_part = raw_target.split("#", 1)[0].split("?", 1)[0]
    if not path_part.endswith(".md"):
        return None
    if path_part.startswith("/"):
        candidate = PurePosixPath(path_part)
    else:
        candidate = PurePosixPath(source).parent / path_part
    parts: list[str] = []
    for part in candidate.parts:
        if part in ("", "/", "."):
            continue
        if part == "..":
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(part)
    return "/" + "/".join(parts)


def audit(project_path: str | Path) -> dict[str, Any]:
    project = Path(project_path).resolve()
    connection = task_store.connect(project)
    try:
        tasks = task_store.list_tasks(connection)
        validation_errors = task_store.validate_database(connection)
    finally:
        connection.close()
    if validation_errors:
        raise task_store.TaskStoreError("; ".join(validation_errors))

    concepts = markdown_concepts(project)
    task_ids = {task["id"] for task in tasks}
    inbound = {task_id: 0 for task_id in task_ids}
    outbound = {task_id: 0 for task_id in task_ids}
    file_targets: set[str] = set()
    dangling: list[str] = []

    for source, markdown in concepts.items():
        for target in link_targets(markdown):
            target_id = task_store.parse_task_uri(target)
            if target_id:
                if target_id in task_ids:
                    inbound[target_id] += 1
                else:
                    dangling.append(f"`{source.lstrip('/')}` -> `{target}` (task missing)")

    for task in tasks:
        source = task["uri"]
        for target in link_targets(task["body_markdown"]):
            target_id = task_store.parse_task_uri(target)
            if target_id:
                if target_id in task_ids:
                    inbound[target_id] += 1
                    if target_id != task["id"]:
                        outbound[task["id"]] += 1
                else:
                    dangling.append(f"`{source}` -> `{target}` (task missing)")
                continue
            resolved = resolve_markdown_target("/tasks/index.md", target)
            if resolved:
                if resolved in concepts:
                    outbound[task["id"]] += 1
                    file_targets.add(resolved)
                else:
                    dangling.append(f"`{source}` -> `{target}` (concept missing)")

    orphans = [
        f"`{task['uri']}` ({task['task_key']}) has no links in or out"
        for task in tasks
        if inbound[task["id"]] == 0 and outbound[task["id"]] == 0
    ]
    return {
        "task_count": len(tasks),
        "task_ids": sorted(task_ids),
        "file_targets": sorted(file_targets),
        "orphans": orphans,
        "dangling": sorted(set(dangling)),
    }
