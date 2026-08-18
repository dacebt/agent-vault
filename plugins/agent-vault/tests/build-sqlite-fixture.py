#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
MIGRATOR = PLUGIN_ROOT / "bin/migrate-task-markdown.py"

TASKS = (
    (
        "backlog",
        "VIEW-001",
        "Backlog task",
        None,
        "## Acceptance\nVisible in backlog.\n\nSee [viewer context](/knowledge/context.md).\n",
    ),
    ("todo", "VIEW-002", "Ready task", None, "## Acceptance\nVisible in todo.\n"),
    (
        "in-progress",
        "VIEW-003",
        "Active task",
        None,
        "## Acceptance\nVisible in progress.\n",
    ),
    (
        "in-progress",
        "VIEW-004",
        "Blocked task",
        "blocked",
        "## Acceptance\nVisible as blocked.\n\n## Blocked by\nFixture dependency.\n",
    ),
    ("done", "VIEW-005", "Done task", None, "## Outcome\nVisible in done.\n"),
)


def task_document(key: str, title: str, task_status: str | None, body: str) -> str:
    workflow = f"task_status: {task_status}\n" if task_status else ""
    completed = "completed: 2026-08-05\n" if key == "VIEW-005" else ""
    return (
        "---\n"
        "type: task\n"
        "title: >-\n"
        f"  {key}: {title}\n"
        "description: SQLite viewer fixture task.\n"
        "priority: p2\n"
        "tags: [viewer, sqlite]\n"
        "status: stable\n"
        f"{workflow}"
        f"{completed}"
        "generated:\n"
        "  by: fixture:agent-vault\n"
        "  at: 2026-08-01T12:00:00Z\n"
        "---\n"
        f"# {key}: {title}\n\n"
        f"{body}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a disposable migrated SQLite viewer fixture")
    parser.add_argument("destination")
    args = parser.parse_args()
    destination = Path(args.destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        parser.error(f"destination must be absent or empty: {destination}")

    destination.mkdir(parents=True, exist_ok=True)
    (destination / "knowledge").mkdir()
    (destination / "tasks").mkdir()
    (destination / "index.md").write_text(
        '---\nokf_version: "0.2"\n---\n# Viewer SQLite fixture\n', encoding="utf-8"
    )
    (destination / "knowledge/context.md").write_text(
        "---\ntype: note\ntitle: Viewer context\nstatus: stable\n---\n"
        "# Viewer context\n\n[Ready task](/tasks/todo/VIEW-002.md)\n",
        encoding="utf-8",
    )
    index_links: list[str] = []
    for status, key, title, task_status, body in TASKS:
        task_dir = destination / "tasks" / status
        task_dir.mkdir(exist_ok=True)
        (task_dir / f"{key}.md").write_text(
            task_document(key, title, task_status, body), encoding="utf-8"
        )
        index_links.append(f"- [{key}](/tasks/{status}/{key}.md)")
    (destination / "tasks/index.md").write_text(
        "# Tasks\n\n" + "\n".join(index_links) + "\n", encoding="utf-8"
    )

    result = subprocess.run(
        [sys.executable, str(MIGRATOR), str(destination), "--write"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr, end="")
        raise SystemExit(result.returncode)
    migration = json.loads(result.stdout)
    output = {
        "fixture": str(destination),
        "migration": migration,
        "expected": {
            "counts": {"backlog": 1, "todo": 1, "in-progress": 2, "done": 1},
            "blocked_in_in_progress": 1,
            "markdown_nodes": 3,
            "task_nodes": 5,
            "dangling_task_uris": 0,
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
