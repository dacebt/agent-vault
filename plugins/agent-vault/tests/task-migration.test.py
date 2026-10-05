#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
MIGRATOR = PLUGIN_ROOT / "bin/migrate-task-markdown.py"
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_graph, task_store  # noqa: E402

SPEC = importlib.util.spec_from_file_location("task_migration", MIGRATOR)
assert SPEC and SPEC.loader
task_migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(task_migration)


@unittest.skipUnless(shutil.which("ruby"), "Ruby is required for YAML migration fixtures")
class TaskMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-task-migration-test-")
        self.project = Path(self.temp.name) / "fixture-project"
        (self.project / "tasks/backlog").mkdir(parents=True)
        (self.project / "tasks/todo").mkdir()
        (self.project / "tasks/done").mkdir()
        (self.project / "knowledge").mkdir()
        (self.project / "tasks/index.md").write_text(
            "# Tasks\n\n[Ready](/tasks/todo/FIX-002.md)\n", encoding="utf-8"
        )
        (self.project / "knowledge/context.md").write_text(
            "# Context\n\n[First](/tasks/backlog/FIX-001.md)\n", encoding="utf-8"
        )
        self.write_task(
            "backlog",
            "FIX-001",
            """---
type: task
title: >-
  FIX-001: First task
description: Preserve this description.
priority: p1
tags: [migration, graph]
status: stable
shape: legacy-shape
generated:
  by: fixture
  at: 2026-08-01T12:00:00Z
---
# FIX-001

## Acceptance
The import is observable.

See [ready](../todo/FIX-002.md) and [context](/knowledge/context.md).
""",
        )
        self.write_task(
            "todo",
            "FIX-002",
            """---
type: task
title: >-
  FIX-002: Ready task
status: stable
created: 2026-08-02
tags: []
---
# FIX-002

## Acceptance
The link identity is stable.
""",
        )
        self.write_task(
            "done",
            "FIX-003",
            """---
type: task
title: >-
  FIX-003: Done task
status: stable
completed: 2026-08-03
tags: []
---
# FIX-003

## Outcome
Finished.
""",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_task(self, status: str, key: str, content: str) -> Path:
        directory = self.project / "tasks" / status
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{key}.md"
        path.write_text(content, encoding="utf-8")
        return path

    def run_migration(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(MIGRATOR), str(self.project), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    def snapshot(self) -> dict[str, bytes]:
        return {
            path.relative_to(self.project).as_posix(): path.read_bytes()
            for path in sorted(self.project.rglob("*"))
            if path.is_file()
        }

    def test_dry_run_is_non_mutating_and_ids_are_deterministic(self) -> None:
        before = self.snapshot()
        first = self.run_migration()
        second = self.run_migration()

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        first_report = json.loads(first.stdout)
        second_report = json.loads(second.stdout)
        self.assertEqual(first_report, second_report)
        self.assertEqual(first_report["mode"], "dry-run")
        self.assertEqual(first_report["source_count"], 3)
        self.assertEqual(first_report["link_rewrites"], 3)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(task_store.database_path(self.project).exists())
        for task in first_report["tasks"]:
            self.assertEqual(uuid.UUID(task["id"]).version, 5)

    def test_write_preserves_records_rewrites_links_and_keeps_backup(self) -> None:
        result = self.run_migration("--write")

        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        database = task_store.database_path(self.project)
        self.assertTrue(database.is_file())
        self.assertTrue(Path(report["backup"]).is_file())
        self.assertTrue((self.project / "tasks/index.md").is_file())
        self.assertFalse(any((self.project / "tasks/backlog").glob("*.md")))
        self.assertFalse((self.project / "tasks/todo").exists())
        self.assertFalse((self.project / "tasks/done").exists())

        connection = task_store.connect(self.project)
        try:
            self.assertEqual(task_store.validate_database(connection), [])
            first = task_store.find_task(connection, "FIX-001")
            done = task_store.find_task(connection, "FIX-003")
        finally:
            connection.close()
        self.assertEqual(first["description"], "Preserve this description.")
        self.assertEqual(first["extensions"]["agent_vault_task_migration"]["legacy_frontmatter"], {"shape": "legacy-shape"})
        self.assertIn("task:", first["body_markdown"])
        self.assertIn("task:", (self.project / "tasks/index.md").read_text(encoding="utf-8"))
        self.assertIn("task:", (self.project / "knowledge/context.md").read_text(encoding="utf-8"))
        self.assertTrue(done["completed_at"].startswith("2026-08-03T00:00:00"))

    def test_preflight_rejects_invalid_type(self) -> None:
        bad = self.project / "tasks/backlog/FIX-001.md"
        bad.write_text(
            bad.read_text(encoding="utf-8").replace("type: task", "type: note"),
            encoding="utf-8",
        )

        result = self.run_migration()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("type must be 'task'", result.stderr)
        self.assertFalse(task_store.database_path(self.project).exists())

    def test_preflight_rejects_invalid_lifecycle_status(self) -> None:
        bad = self.project / "tasks/todo/FIX-002.md"
        bad.write_text(
            bad.read_text(encoding="utf-8").replace("status: stable", "status: done"),
            encoding="utf-8",
        )

        result = self.run_migration()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid lifecycle status", result.stderr)

    def test_preflight_rejects_dangling_legacy_task_link(self) -> None:
        (self.project / "README.md").write_text(
            "[Missing](/tasks/todo/DOES-NOT-EXIST.md)\n", encoding="utf-8"
        )

        result = self.run_migration()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved legacy task link", result.stderr)
        self.assertFalse(task_store.database_path(self.project).exists())

    def test_done_without_explicit_or_git_completion_time_is_rejected(self) -> None:
        done = self.project / "tasks/done/FIX-003.md"
        done.write_text(
            done.read_text(encoding="utf-8").replace("completed: 2026-08-03\n", ""),
            encoding="utf-8",
        )

        result = self.run_migration()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no completion timestamp and no Git history", result.stderr)

    def test_existing_database_is_a_hard_refusal(self) -> None:
        task_store.initialize(self.project)

        result = self.run_migration()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("task database already exists", result.stderr)

    def test_write_failure_rolls_back_every_project_change(self) -> None:
        before = self.snapshot()
        plan = task_migration.build_plan(self.project)

        def fail_after_one_delete(project: Path, source_paths: list[str]) -> None:
            (project / source_paths[0]).unlink()
            raise OSError("injected delete failure")

        with mock.patch.object(
            task_migration, "remove_legacy_records", side_effect=fail_after_one_delete
        ):
            with self.assertRaisesRegex(OSError, "injected delete failure"):
                task_migration.apply_plan(self.project, plan)

        self.assertEqual(self.snapshot(), before)
        self.assertFalse(task_store.database_path(self.project).exists())
        self.assertEqual(list((self.project / "tasks").glob("legacy-markdown-backup-*.tar.gz")), [])

    def test_viewer_fixture_builder_produces_the_published_contract(self) -> None:
        destination = Path(self.temp.name) / "sqlite-fixture"
        builder = PLUGIN_ROOT / "tests/build-viewer-sqlite-fixture.py"

        result = subprocess.run(
            [sys.executable, str(builder), str(destination)],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(
            report["expected"]["counts"],
            {"backlog": 1, "todo": 1, "in-progress": 2, "done": 1},
        )
        connection = task_store.connect(destination)
        try:
            statuses = [task["task_status"] for task in task_store.list_tasks(connection)]
        finally:
            connection.close()
        self.assertCountEqual(statuses, ["backlog", "todo", "in-progress", "blocked", "done"])
        graph = task_graph.audit(destination)
        self.assertEqual(graph["task_count"], 5)
        self.assertEqual(graph["dangling"], [])
        self.assertEqual(graph["orphans"], [])
        self.assertEqual(graph["file_targets"], ["/knowledge/context.md"])


if __name__ == "__main__":
    unittest.main()
