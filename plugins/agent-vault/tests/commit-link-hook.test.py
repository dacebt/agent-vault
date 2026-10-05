#!/usr/bin/env python3
"""Exercise receipt attribution and retryable task durability in disposable repositories."""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


class CommitLinkHookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-commit-hook-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "source project"
        self.vault = self.root / "vault"
        self.project = self.vault / self.source.name
        self.plugin = self.root / "plugin"
        (self.plugin / "bin").mkdir(parents=True)
        for name in ("find-vault.sh", "resolve-project.sh", "task-db.py", "vault-commit.sh"):
            (self.plugin / "bin" / name).symlink_to(PLUGIN_ROOT / "bin" / name)
        self.env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        self.env.update(AGENT_VAULT=str(self.vault), CLAUDE_PLUGIN_ROOT=str(self.plugin),
                        TMPDIR=str(self.root), PYTHONDONTWRITEBYTECODE="1",
                        GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        self.init_repo(self.source)
        self.init_repo(self.vault)
        self.task("init")
        self.task("create", "--key", "FIX-1", "--title", "Active task")
        self.task("transition", "FIX-1", "in-progress")
        with sqlite3.connect(self.project / "tasks/tasks.sqlite3") as connection:
            connection.execute("UPDATE tasks SET generated_at = '2000-01-01T00:00:00+00:00'")
        self.git(self.vault, "add", ".")
        self.git(self.vault, "commit", "-m", "fixture database")

    def invoke(self, args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, env=self.env, text=True, capture_output=True, **kwargs)

    def git(self, directory: Path, *args: str) -> str:
        result = self.invoke(["git", "-C", str(directory), *args], check=True)
        return result.stdout

    def init_repo(self, directory: Path) -> None:
        directory.mkdir(parents=True)
        self.git(directory, "init", "-q")
        self.git(directory, "config", "user.name", "Fixture")
        self.git(directory, "config", "user.email", "fixture@example.invalid")
        self.git(directory, "config", "commit.gpgsign", "false")

    def task(self, operation: str, *args: str, project: Path | None = None) -> dict | list:
        result = self.invoke([sys.executable, str(PLUGIN_ROOT / "bin/task-db.py"),
                              operation, str(project or self.project), *args], check=True)
        return json.loads(result.stdout)

    def commit(self, subject: str = "Source change", directory: Path | None = None) -> tuple[str, str]:
        repo = directory or self.source
        output = self.git(repo, "commit", "--allow-empty", "-m", subject)
        return output, self.git(repo, "rev-parse", "--short", "HEAD").strip()

    def hook(self, output: str, *, cwd: Path | None = None, event_cwd: object = ..., exit_code: int = 0,
             command: str = "git commit -m fixture") -> subprocess.CompletedProcess[str]:
        event = {"tool_input": {"command": command},
                 "tool_response": {"stdout": output, "exit_code": exit_code}}
        if event_cwd is not ...:
            event["cwd"] = event_cwd
        return self.invoke(["bash", str(PLUGIN_ROOT / "bin/hook-git-commit-link.sh")],
                           cwd=cwd or self.source, input=json.dumps(event))

    def body(self, key: str = "FIX-1", project: Path | None = None) -> str:
        return self.task("show", key, project=project)["body_markdown"]

    def assert_durable(self) -> None:
        database = self.project / "tasks/tasks.sqlite3"
        relative = database.relative_to(self.vault).as_posix()
        self.assertEqual(self.git(self.vault, "rev-parse", f"HEAD:{relative}").strip(),
                         self.git(self.vault, "hash-object", str(database)).strip())

    def stub(self, name: str, content: str) -> None:
        path = self.plugin / "bin" / name
        path.unlink()
        path.write_text(content)
        path.chmod(0o755)

    def restore(self, name: str) -> None:
        path = self.plugin / "bin" / name
        path.unlink()
        path.symlink_to(PLUGIN_ROOT / "bin" / name)

    def test_real_receipt_links_and_commits_once_even_when_later_command_fails(self) -> None:
        receipt, sha = self.commit()
        self.assertEqual(self.hook(receipt, exit_code=1).returncode, 0)
        self.assertIn(f"`{sha}`", self.body())
        self.assert_durable()
        count = self.git(self.vault, "rev-list", "--count", "HEAD")
        self.assertEqual(self.hook(receipt).returncode, 0)
        self.assertEqual(self.body().count(f"`{sha}`"), 1)
        self.assertEqual(self.git(self.vault, "rev-list", "--count", "HEAD"), count)

    def test_head_changes_and_commit_mentions_without_receipts_do_not_write(self) -> None:
        self.commit()
        before = (self.project / "tasks/tasks.sqlite3").read_bytes()
        for output in ("commit failed", "echo commit", "", "[main deadbeef] nonexistent commit"):
            with self.subTest(output=output):
                result = self.hook(output, exit_code=1)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
                self.assertEqual((self.project / "tasks/tasks.sqlite3").read_bytes(), before)

    def test_reading_old_receipts_does_not_mutate_or_commit_tasks(self) -> None:
        receipt, _ = self.commit("Earlier change")
        before = (self.project / "tasks/tasks.sqlite3").read_bytes()
        head = self.git(self.vault, "rev-parse", "HEAD")
        for command in ("cat build.log", "cat commit.log", "git log --grep=commit",
                        "echo 'git commit'", "printf '%s' '&&' git commit",
                        "cat build.log # git commit", ""):
            with self.subTest(command=command):
                result = self.hook(receipt, command=command)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
                self.assertEqual((self.project / "tasks/tasks.sqlite3").read_bytes(), before)
                self.assertEqual(self.git(self.vault, "rev-parse", "HEAD"), head)

    def test_commit_options_and_compound_commands_remain_supported(self) -> None:
        for command in ("git -c user.name=Fixture commit -m fixture",
                        "git -C '.' commit -m fixture",
                        "git add . && git commit -m fixture; false",
                        "git status\ngit commit -m fixture",
                        "TRACE=1 /usr/bin/git commit -m fixture"):
            with self.subTest(command=command):
                receipt, sha = self.commit(command)
                result = self.hook(receipt, command=command)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f"`{sha}`", self.body())
                self.assert_durable()

    def test_multiple_receipts_choose_newest_blocked_task_and_preserve_literal_subject(self) -> None:
        self.task("create", "--key", "FIX-2", "--title", "Blocked task")
        self.task("transition", "FIX-2", "blocked")
        body = "# Existing task\n\n## Commits\n- prior context\n"
        body_path = self.root / "body.md"
        body_path.write_text(body)
        self.task("update", "FIX-2", "--body-file", str(body_path))
        subject = r"Preserve literal \n and \t in a subject"
        first, sha1 = self.commit(subject)
        second, sha2 = self.commit("Second change")
        result = self.hook(first + second)
        self.assertEqual(result.returncode, 0, result.stderr)
        updated = self.body("FIX-2")
        self.assertIn(subject, updated)
        self.assertIn("- prior context\n", updated)
        self.assertIn(f"`{sha1}`", updated)
        self.assertIn(f"`{sha2}`", updated)
        self.assertEqual(self.body(), "")
        self.assert_durable()

    def test_event_cwd_selects_event_project_and_invalid_values_never_fall_back(self) -> None:
        receipt, sha = self.commit()
        other = self.root / "other project"
        self.init_repo(other)
        self.task("init", project=self.vault / other.name)
        self.task("create", "--key", "FIX-1", "--title", "Other", project=self.vault / other.name)
        self.task("transition", "FIX-1", "in-progress", project=self.vault / other.name)
        for invalid in (str(self.root / "missing"), "", None, "relative", 42):
            result = self.hook(receipt, event_cwd=invalid)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(self.body(), "")
        result = self.hook(receipt, cwd=other, event_cwd=str(self.source))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"`{sha}`", self.body())
        self.assertEqual(self.body(project=self.vault / other.name), "")

    def test_receipt_from_another_repository_does_not_link_current_project(self) -> None:
        other = self.root / "foreign source"
        self.init_repo(other)
        receipt, _ = self.commit("Foreign receipt", other)
        result = self.hook(receipt)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.body(), "")

    def test_failed_task_update_is_diagnostic_and_retry_records_same_receipt(self) -> None:
        receipt, sha = self.commit()
        self.stub("task-db.py", "import runpy,sys\nif sys.argv[1] == 'update': sys.exit(9)\nrunpy.run_path(" +
                  repr(str(PLUGIN_ROOT / "bin/task-db.py")) + ",run_name='__main__')\n")
        result = self.hook(receipt)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exit 9", result.stderr)
        self.assertEqual(self.body(), "")
        self.restore("task-db.py")
        retry = self.hook(receipt)
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertIn(f"`{sha}`", self.body())
        self.assert_durable()

    def test_silent_durability_failure_is_detected_and_existing_link_retried(self) -> None:
        receipt, sha = self.commit()
        self.stub("vault-commit.sh", "#!/bin/bash\nexit 0\n")
        failed = self.hook(receipt)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("not committed", failed.stderr)
        self.assertIn(f"`{sha}`", self.body())
        self.restore("vault-commit.sh")
        self.task("transition", "FIX-1", "done")
        retry = self.hook(receipt)
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual(self.body().count(f"`{sha}`"), 1)
        self.assert_durable()

    def test_nonzero_durability_failure_reports_error_and_can_retry(self) -> None:
        receipt, _ = self.commit()
        self.stub("vault-commit.sh", "#!/bin/bash\nexit 23\n")
        failed = self.hook(receipt)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("exit 23", failed.stderr)
        self.restore("vault-commit.sh")
        self.assertEqual(self.hook(receipt).returncode, 0)
        self.assert_durable()

    def test_malformed_event_has_diagnostic_without_task_mutation(self) -> None:
        result = self.invoke(["bash", str(PLUGIN_ROOT / "bin/hook-git-commit-link.sh")],
                             cwd=self.source, input="not JSON")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("agent-vault commit link:", result.stderr)
        self.assertEqual(self.body(), "")


if __name__ == "__main__":
    unittest.main()
