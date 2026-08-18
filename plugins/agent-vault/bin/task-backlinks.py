#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_store  # noqa: E402


def markdown_hits(project: Path, literal: str) -> list[str]:
    hits: list[str] = []
    for path in project.rglob("*.md"):
        relative = path.relative_to(project)
        if any(part.startswith(".") for part in relative.parts):
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if literal in line:
                hits.append(f"{relative.as_posix()}:{number}: {line.strip()}")
    return hits


def task_body_hits(project: Path, pattern: re.Pattern[str], excluded_id: str | None) -> list[str]:
    connection = task_store.connect(project)
    try:
        tasks = task_store.list_tasks(connection)
    finally:
        connection.close()
    hits: list[str] = []
    for task in tasks:
        if task["id"] == excluded_id:
            continue
        for number, line in enumerate(task["body_markdown"].splitlines(), 1):
            if pattern.search(line):
                hits.append(f"{task['uri']}:{number}: {line.strip()}")
    return hits


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: task-backlinks.py <project-path> <target>", file=sys.stderr)
        raise SystemExit(2)
    project = Path(sys.argv[1]).resolve()
    target = sys.argv[2]
    connection = task_store.connect(project)
    try:
        try:
            task = task_store.find_task(connection, target)
        except task_store.TaskStoreError:
            task = None
    finally:
        connection.close()

    if task:
        uri = task["uri"]
        hits = markdown_hits(project, uri)
        hits.extend(task_body_hits(project, re.compile(re.escape(uri)), task["id"]))
    else:
        concept_id = Path(target).name.removesuffix(".md")
        pattern = re.compile(rf"\]\([^)]*{re.escape(concept_id)}\.md(?:[)#])")
        hits = task_body_hits(project, pattern, None)
    print("\n".join(hits))


if __name__ == "__main__":
    try:
        main()
    except (task_store.TaskStoreError, OSError, ValueError) as error:
        print(f"task-backlinks: {error}", file=sys.stderr)
        raise SystemExit(1) from error
