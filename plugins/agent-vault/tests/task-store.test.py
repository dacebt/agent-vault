#!/usr/bin/env python3
from __future__ import annotations

import sqlite3
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

    def test_enforces_acceptance_and_outcome_transition_gates(self) -> None:
        task = self.create(body="# Task\n")
        with self.assertRaisesRegex(task_store.TaskStoreError, "Acceptance"):
            task_store.transition_task(self.connection, task["id"], "todo")
        task_store.update_task(
            self.connection,
            task["id"],
            {"body_markdown": "# Task\n\n## Acceptance\nThe behavior is observable.\n"},
        )
        task_store.transition_task(self.connection, task["id"], "todo")
        task_store.transition_task(self.connection, task["id"], "in-progress")
        with self.assertRaisesRegex(task_store.TaskStoreError, "Outcome"):
            task_store.transition_task(self.connection, task["id"], "done")

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

    def test_rejects_new_work_when_wip_limit_is_reached(self) -> None:
        body = "# Task\n\n## Acceptance\nObservable.\n"
        tasks = [self.create(f"FIX-00{index}", body) for index in range(1, 4)]
        for task in tasks:
            task_store.transition_task(self.connection, task["id"], "todo")
        for task in tasks[:2]:
            task_store.transition_task(self.connection, task["id"], "in-progress")
        with self.assertRaisesRegex(task_store.TaskStoreError, "WIP limit"):
            task_store.transition_task(self.connection, tasks[2]["id"], "in-progress")
        started = task_store.transition_task(
            self.connection, tasks[2]["id"], "in-progress", allow_wip=True
        )
        self.assertEqual(started["task_status"], "in-progress")

    def test_reports_unsupported_schema_version(self) -> None:
        self.connection.execute("PRAGMA user_version = 99")
        self.assertIn("unsupported schema version", task_store.validate_database(self.connection)[0])

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
