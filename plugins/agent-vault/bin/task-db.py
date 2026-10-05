#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_store  # noqa: E402


def emit(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def read_body(path: str | None) -> str:
    if not path:
        return ""
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def command_init(args: argparse.Namespace) -> None:
    path = task_store.initialize(args.project)
    emit({"database": str(path), "schema_version": task_store.SCHEMA_VERSION})


def command_create(args: argparse.Namespace) -> None:
    connection = task_store.connect(args.project)
    try:
        task_id = task_store.create_task(
            connection,
            {
                "task_key": args.key,
                "title": args.title,
                "description": args.description,
                "priority": args.priority,
                "tags": parse_tags(args.tags),
                "body_markdown": read_body(args.body_file),
                "generated_by": args.actor,
            },
        )
        emit(task_store.find_task(connection, task_id))
    finally:
        connection.close()


def command_show(args: argparse.Namespace) -> None:
    connection = task_store.connect(args.project)
    try:
        emit(task_store.find_task(connection, args.task))
    finally:
        connection.close()


def command_list(args: argparse.Namespace) -> None:
    connection = task_store.connect(args.project)
    try:
        statuses = args.status or None
        emit(task_store.list_tasks(connection, statuses))
    finally:
        connection.close()


def command_update(args: argparse.Namespace) -> None:
    changes = {
        key: value
        for key, value in {
            "title": args.title,
            "description": args.description,
            "priority": args.priority,
            "milestone": args.milestone,
            "sort_order": args.sort_order,
            "tags": parse_tags(args.tags) if args.tags is not None else None,
            "body_markdown": read_body(args.body_file) if args.body_file else None,
        }.items()
        if value is not None
    }
    for field in args.clear:
        if field in changes:
            raise ValueError(f"cannot both set and clear {field}")
        changes[field] = None
    connection = task_store.connect(args.project)
    try:
        emit(task_store.update_task(connection, args.task, changes, args.actor))
    finally:
        connection.close()


def command_transition(args: argparse.Namespace) -> None:
    connection = task_store.connect(args.project)
    try:
        emit(
            task_store.transition_task(
                connection,
                args.task,
                args.status,
                actor=args.actor,
                note=args.note,
            )
        )
    finally:
        connection.close()


def command_validate(args: argparse.Namespace) -> None:
    connection = task_store.connect(args.project)
    try:
        errors = task_store.validate_database(connection)
    finally:
        connection.close()
    if errors:
        emit({"ok": False, "errors": errors})
        raise SystemExit(1)
    emit({"ok": True, "schema_version": task_store.SCHEMA_VERSION})


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Manage SQLite-backed Agent Vault task concepts")
    commands = root.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init")
    init.add_argument("project")
    init.set_defaults(run=command_init)

    create = commands.add_parser("create")
    create.add_argument("project")
    create.add_argument("--key", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--description")
    create.add_argument("--priority")
    create.add_argument("--tags")
    create.add_argument("--body-file")
    create.add_argument("--actor", default=task_store.DEFAULT_ACTOR)
    create.set_defaults(run=command_create)

    show = commands.add_parser("show")
    show.add_argument("project")
    show.add_argument("task")
    show.set_defaults(run=command_show)

    listing = commands.add_parser("list")
    listing.add_argument("project")
    listing.add_argument("--status", action="append", choices=task_store.TASK_STATUSES)
    listing.set_defaults(run=command_list)

    update = commands.add_parser("update")
    update.add_argument("project")
    update.add_argument("task")
    update.add_argument("--title")
    update.add_argument("--description")
    update.add_argument("--priority")
    update.add_argument("--milestone")
    update.add_argument("--sort-order", type=int)
    update.add_argument("--tags", help="comma-separated tags; an empty string clears them")
    update.add_argument(
        "--clear", action="append", default=[],
        choices=("description", "priority", "milestone", "sort_order"),
        help="clear an optional field; repeat for multiple fields",
    )
    update.add_argument("--body-file")
    update.add_argument("--actor", default=task_store.DEFAULT_ACTOR)
    update.set_defaults(run=command_update)

    transition = commands.add_parser("transition")
    transition.add_argument("project")
    transition.add_argument("task")
    transition.add_argument("status", choices=task_store.TASK_STATUSES)
    transition.add_argument("--note", help="optional context appended when the status changes")
    transition.add_argument("--actor", default=task_store.DEFAULT_ACTOR)
    transition.set_defaults(run=command_transition)

    validate = commands.add_parser("validate")
    validate.add_argument("project")
    validate.set_defaults(run=command_validate)
    return root


def main() -> None:
    args = parser().parse_args()
    try:
        args.run(args)
    except (task_store.TaskStoreError, OSError, ValueError) as error:
        print(f"task-db: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
