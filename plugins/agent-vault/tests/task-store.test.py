#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_graph, task_store  # noqa: E402


class TaskStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-task-store-")
        self.project = Path(self.temp.name) / "fixture"
        task_store.initialize(self.project)
        self.connection = task_store.connect(self.project)

    def tearDown(self) -> None:
        self.connection.close()
        self.temp.cleanup()

    def create(self, key: str = "FIX-001", body: str = "") -> dict:
        task_id = task_store.create_task(
            self.connection,
            {"task_key": key, "title": f"{key}: fixture", "body_markdown": body},
        )
        return task_store.find_task(self.connection, task_id)

    def test_creates_stable_uuid_identity_and_valid_database(self) -> None:
        task = self.create()
        self.assertEqual(task["uri"], f"task:{task['id']}")
        self.assertEqual(task["task_status"], "backlog")
        self.assertEqual(task_store.validate_database(self.connection), [])

    def test_rejects_duplicate_display_key_case_insensitively(self) -> None:
        self.create("FIX-001")
        with self.assertRaisesRegex(task_store.TaskStoreError, "UNIQUE"):
            self.create("fix-001")

    def test_block_reopen_and_completion_preserve_identity(self) -> None:
        body = "# Task\n\n## Acceptance\nObservable.\n\n## Outcome\nDelivered.\n"
        task = self.create(body=body)
        identity = task["uri"]
        task_store.transition_task(self.connection, task["id"], "todo")
        task_store.transition_task(self.connection, task["id"], "in-progress")
        blocked = task_store.transition_task(
            self.connection, task["id"], "blocked", note="Waiting for evidence."
        )
        self.assertIn("## Blocked by", blocked["body_markdown"])
        resumed = task_store.transition_task(self.connection, task["id"], "in-progress")
        done = task_store.transition_task(self.connection, task["id"], "done")
        self.assertIsNotNone(done["completed_at"])
        reopened = task_store.transition_task(
            self.connection, task["id"], "in-progress", note="Regression found."
        )
        self.assertIsNone(reopened["completed_at"])
        self.assertEqual(resumed["uri"], identity)
        self.assertEqual(reopened["uri"], identity)

    def test_reports_unsupported_schema_version(self) -> None:
        self.connection.execute("PRAGMA user_version = 99")
        self.assertIn("unsupported schema version", task_store.validate_database(self.connection)[0])

    def test_moves_between_all_statuses_without_prerequisites_or_identity_changes(self) -> None:
        for source in task_store.TASK_STATUSES:
            for destination in task_store.TASK_STATUSES:
                with self.subTest(source=source, destination=destination):
                    task = self.create(f"{source}-{destination}")
                    before = task_store.transition_task(
                        self.connection, task["id"], source,
                    )
                    after = task_store.transition_task(
                        self.connection, task["id"], destination,
                    )
                    self.assertEqual(after["task_status"], destination)
                    self.assertEqual(after["uri"], task["uri"])
                    self.assertEqual(bool(after["completed_at"]), destination == "done")
                    if source == destination:
                        self.assertEqual(after, before)
                    self.assertEqual(after["body_markdown"], "")
                    if before["started_at"]:
                        self.assertEqual(after["started_at"], before["started_at"])
                    elif destination == "in-progress":
                        self.assertIsNotNone(after["started_at"])
                    else:
                        self.assertIsNone(after["started_at"])

    def test_active_work_is_not_limited_by_other_tasks(self) -> None:
        for index in range(5):
            task = self.create(f"WIP-{index}")
            for destination in ("in-progress", "blocked", "in-progress"):
                moved = task_store.transition_task(self.connection, task["id"], destination)
                self.assertEqual(moved["task_status"], destination)
        self.assertEqual(len(task_store.list_tasks(self.connection, ["in-progress"])), 5)

    def test_cli_closes_reopens_and_blocks_without_notes_or_acceptance(self) -> None:
        task = self.create()
        for destination in ("done", "backlog", "blocked", "todo", "in-progress", "done"):
            result = subprocess.run(
                [sys.executable, str(PLUGIN_ROOT / "bin/task-db.py"), "transition",
                 str(self.project), task["task_key"], destination],
                capture_output=True, text=True, check=True,
            )
            moved = json.loads(result.stdout)
            self.assertEqual(moved["task_status"], destination)
            self.assertEqual(moved["uri"], task["uri"])
            self.assertEqual(moved["body_markdown"], "")
            self.assertEqual(bool(moved["completed_at"]), destination == "done")
        self.assertEqual(task_store.validate_database(self.connection), [])

    def test_rejects_unknown_status_without_mutation(self) -> None:
        task = self.create()
        with self.assertRaisesRegex(task_store.TaskStoreError, "invalid task_status"):
            task_store.transition_task(self.connection, task["id"], "unknown")
        self.assertEqual(task_store.find_task(self.connection, task["id"]), task)

    def test_cli_edits_and_clears_metadata_preserving_body_and_identity(self) -> None:
        task = self.create(body="Existing task context.\n")
        prefix = [sys.executable, str(PLUGIN_ROOT / "bin/task-db.py"), "update",
                  str(self.project), task["task_key"]]
        subprocess.run(
            prefix + ["--description", "Details", "--priority", "high", "--milestone", "M1",
                      "--sort-order", "3", "--tags", "storage, cli"],
            capture_output=True, text=True, check=True,
        )
        edited = task_store.find_task(self.connection, task["id"])
        self.assertEqual(edited["tags"], ["storage", "cli"])
        self.assertEqual(edited["sort_order"], 3)
        subprocess.run(prefix + ["--tags", "revised"], capture_output=True, text=True, check=True)
        revised = task_store.find_task(self.connection, task["id"])
        self.assertEqual(revised["tags"], ["revised"])
        for field in ("description", "priority", "milestone", "sort_order"):
            self.assertEqual(revised[field], edited[field])
        subprocess.run(
            prefix + ["--tags", "", "--clear", "description", "--clear", "priority",
                      "--clear", "milestone", "--clear", "sort_order"],
            capture_output=True, text=True, check=True,
        )
        cleared = task_store.find_task(self.connection, task["id"])
        for field in ("description", "priority", "milestone", "sort_order"):
            self.assertIsNone(cleared[field])
        self.assertEqual(cleared["tags"], [])
        self.assertEqual(cleared["uri"], task["uri"])
        self.assertEqual(cleared["body_markdown"], task["body_markdown"])

    def test_conflicting_set_and_clear_leaves_record_unchanged(self) -> None:
        task = self.create()
        result = subprocess.run(
            [sys.executable, str(PLUGIN_ROOT / "bin/task-db.py"), "update",
             str(self.project), task["task_key"], "--priority", "high", "--clear", "priority"],
            capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(task_store.find_task(self.connection, task["id"]), task)

    def test_cli_preserves_optional_notes_on_each_kind_of_status_change(self) -> None:
        task = self.create(body="Original context.\n")
        for destination in ("todo", "in-progress", "done", "blocked", "done", "backlog"):
            note = f"User chose {destination} from {task['task_status']}."
            result = subprocess.run(
                [sys.executable, str(PLUGIN_ROOT / "bin/task-db.py"), "transition",
                 str(self.project), task["id"], destination, "--note", note],
                capture_output=True, text=True, check=True,
            )
            changed = json.loads(result.stdout)
            self.assertTrue(changed["body_markdown"].startswith(task["body_markdown"].rstrip()))
            self.assertEqual(changed["body_markdown"].count(note), 1)
            task = changed

    def test_integrity_constraint_rejects_done_without_completion_time(self) -> None:
        task = self.create()
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "UPDATE tasks SET task_status = 'done', completed_at = NULL WHERE id = ?",
                (task["id"],),
            )

    def test_hybrid_graph_resolves_task_and_markdown_concepts(self) -> None:
        knowledge = self.project / "knowledge"
        knowledge.mkdir()
        (knowledge / "contract.md").write_text(
            "# Contract\n\nSee [the task](TASK_URI).\n", encoding="utf-8"
        )
        target = self.create("FIX-002", "# Target\n")
        source = self.create(
            "FIX-001",
            f"# Source\n\nSee [contract](/knowledge/contract.md) and "
            f"[target]({target['uri']}).\n",
        )
        note = knowledge / "contract.md"
        note.write_text(
            note.read_text(encoding="utf-8").replace("TASK_URI", source["uri"]),
            encoding="utf-8",
        )

        result = task_graph.audit(self.project)

        self.assertEqual(result["task_count"], 2)
        self.assertEqual(result["orphans"], [])
        self.assertEqual(result["dangling"], [])
        self.assertEqual(result["file_targets"], ["/knowledge/contract.md"])

    def test_hybrid_graph_reports_dangling_task_uri(self) -> None:
        missing = "task:00000000-0000-4000-8000-000000000000"
        self.create(body=f"# Task\n\nSee [missing]({missing}).\n")

        result = task_graph.audit(self.project)

        self.assertEqual(len(result["dangling"]), 1)
        self.assertIn("task missing", result["dangling"][0])


if __name__ == "__main__":
    unittest.main()
