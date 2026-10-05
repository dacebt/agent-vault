#!/usr/bin/env python3
"""Exercise startup discovery, bounded excerpts, and preservation of vault records."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))
from lib import task_store  # noqa: E402


class SessionStartTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-orientation-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.vault = self.root / "vault"
        self.project = self.vault / "sample project"
        self.project.mkdir(parents=True)
        self.env = dict(os.environ, AGENT_VAULT=str(self.vault), TMPDIR=str(self.root))
        self.env.pop("CLAUDE_PLUGIN_ROOT", None)
        self.env.pop("PLUGIN_ROOT", None)

    def write(self, relative: str, content: str) -> Path:
        path = self.project / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def preamble(self) -> str:
        result = subprocess.run(
            ["bash", str(PLUGIN_ROOT / "bin/vault-index.sh"), str(self.project), "--preamble"],
            env=self.env, text=True, capture_output=True, check=True,
        )
        return result.stdout

    def hook(self, env: dict[str, str] | None = None, cwd: Path | None = None) -> str:
        result = subprocess.run(
            ["bash", str(PLUGIN_ROOT / "bin/hook-session-start.sh")],
            cwd=cwd or self.project, env=env or self.env,
            input=json.dumps({"session_id": "fixture-session", "source": "startup"}),
            text=True, capture_output=True, check=True,
        )
        return result.stdout

    def test_hook_discovers_available_resources_without_a_task_database(self) -> None:
        self.write("knowledge/index.md", "# Knowledge\n")
        self.write("docs/decisions/index.md", "# Decisions\n")
        for variable in ("CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT"):
            with self.subTest(variable=variable):
                env = dict(self.env, **{variable: str(PLUGIN_ROOT)})
                output = json.loads(self.hook(env))["hookSpecificOutput"]
                self.assertEqual(output["hookEventName"], "SessionStart")
                context = output["additionalContext"]
                self.assertIn(str(self.project), context)
                self.assertIn("knowledge/index.md", context)
                self.assertIn("docs/decisions/", context)
                self.assertIn(str(PLUGIN_ROOT / "reference/task-commands.md"), context)
                self.assertNotIn("journal/", context)
                self.assertNotIn("handoffs/", context)
        self.assertFalse((self.project / "tasks").exists())

    def test_journal_excerpt_skips_metadata_and_joins_first_body_paragraph(self) -> None:
        self.write("journal/index.md", "# Index\nINDEX_ONLY\n")
        self.write("journal/log.md", "LOG_ONLY\n")
        self.write("journal/2026-01-01.md", "OLD_JOURNAL\n")
        self.write("journal/2026-01-02.md", "---\ntype: journal\nsecret_metadata: META_ONLY\n---\n# Day\n\n## Work\n\nFIRST_LINE\nSECOND_LINE\n\nNEXT_PARAGRAPH\n")
        output = self.preamble()
        self.assertIn("journal/2026-01-02.md", output)
        self.assertIn("FIRST_LINE SECOND_LINE", output)
        for excluded in ("META_ONLY", "NEXT_PARAGRAPH", "OLD_JOURNAL", "INDEX_ONLY", "LOG_ONLY"):
            self.assertNotIn(excluded, output)

    def test_existing_journal_summary_takes_priority_and_excerpts_are_bounded(self) -> None:
        self.write("journal/2026-01-02.md", "---\ntype: journal\ndescription: >-\n  SUMMARY_START\n  " + "x" * 2000 + "\n---\n# Day\nBODY_ONLY\n")
        output = self.preamble()
        self.assertIn("SUMMARY_START", output)
        self.assertNotIn("BODY_ONLY", output)
        self.assertNotIn("x" * 401, output)
        self.write("journal/2026-01-02.md", "---\ntype: journal\n---\n# Day\n" + "y" * 2000)
        self.assertNotIn("y" * 401, self.preamble())

    def test_handoffs_select_three_live_records_without_retiring_done_links(self) -> None:
        task_store.initialize(self.project)
        connection = task_store.connect(self.project)
        try:
            task_id = task_store.create_task(connection, {"task_key": "FIX-1", "title": "PRIVATE_TASK_TITLE", "body_markdown": ""})
            task_store.transition_task(connection, task_id, "done")
        finally:
            connection.close()
        self.write("index.md", '---\nokf_version: "0.2"\n---\n')
        for day in range(1, 5):
            self.write(f"handoffs/2026-01-0{day}.md", f"---\ntype: handoff\nhandoff_status: live\ndescription: resume-{day} " + "z" * 1000 + f"\n---\n[task](task:{task_id})\n")
        self.write("handoffs/2026-01-05.md", "---\nhandoff_status: spent\ndescription: SPENT_ONLY\n---\n")
        self.write("handoffs/index.md", "INDEX_ONLY\n")
        before = {str(p.relative_to(self.project)): p.read_bytes() for p in self.project.rglob("*") if p.is_file()}
        output = json.loads(self.hook())["hookSpecificOutput"]["additionalContext"]
        after = {str(p.relative_to(self.project)): p.read_bytes() for p in self.project.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        for day in (2, 3, 4):
            self.assertIn(f"handoffs/2026-01-0{day}.md", output)
        for excluded in ("2026-01-01.md", "SPENT_ONLY", "INDEX_ONLY", "PRIVATE_TASK_TITLE", "z" * 201):
            self.assertNotIn(excluded, output)
        full = subprocess.run(["bash", str(PLUGIN_ROOT / "bin/vault-index.sh"), str(self.project), "--full"], text=True, capture_output=True, check=True, env=self.env)
        self.assertIn("PRIVATE_TASK_TITLE", full.stdout)

    def test_empty_optional_directories_and_missing_knowledge_index(self) -> None:
        for directory in ("journal", "handoffs", "knowledge"):
            (self.project / directory).mkdir()
        context = json.loads(self.hook())["hookSpecificOutput"]["additionalContext"]
        self.assertIn("knowledge/", context)
        self.assertNotIn("knowledge/index.md", context)
        self.assertIn("journal/", context)
        self.assertIn("handoffs/", context)

    def test_untracked_project_emits_no_context(self) -> None:
        checkout = self.root / "untracked"
        checkout.mkdir()
        self.assertEqual(self.hook(cwd=checkout), "")

    def test_session_cache_does_not_depend_on_a_head_commit(self) -> None:
        subprocess.run(["git", "-C", str(self.project), "init", "-q"], check=True)
        self.assertTrue(self.hook())
        repo_key = hashlib.sha1(str(self.project).encode()).hexdigest()[:12]
        cache = self.root / "agent-vault-cache"
        self.assertEqual((cache / f"session-{repo_key}").read_text(), "fixture-session")
        self.assertEqual(list(cache.glob("head-*")), [])


if __name__ == "__main__":
    unittest.main()
