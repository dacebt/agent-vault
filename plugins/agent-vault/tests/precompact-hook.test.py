#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
import unittest

from precompact_fixture import HOOK, PLUGIN_ROOT, PreCompactFixture


@unittest.skipUnless(
    shutil.which("jq") and shutil.which("git"),
    "jq and git are required by the PreCompact hook",
)
class PreCompactHookTest(PreCompactFixture):
    def test_bounds_analysis_and_commits_validated_handoff(self) -> None:
        completed = self.run_hook(self.valid_result())
        self.assertEqual(completed.returncode, 0, completed.stderr)
        arguments = json.loads(self.args_path.read_text(encoding="utf-8"))
        self.assertIn("read-only", arguments)
        self.assertIn('sandbox_workspace_write.network_access=false', arguments)
        self.assertEqual(arguments[arguments.index("--disable") + 1], "hooks")
        prompt_input = self.stdin_path.read_text(encoding="utf-8")
        self.assertIn("recent-marker", prompt_input)
        self.assertNotIn("old-marker", prompt_input)
        self.assertLess(len(prompt_input), 540_000)

        handoffs = list((self.project / "handoffs").glob("*.md"))
        handoffs.remove(self.old_handoff)
        self.assertEqual(len(handoffs), 1)
        handoff = handoffs[0].read_text(encoding="utf-8")
        self.assertIn('session: "test-session"', handoff)
        self.assertIn("## Next step\n\nRun the focused hook test.", handoff)
        self.assertIn("status: deprecated", self.old_handoff.read_text(encoding="utf-8"))
        self.assertIn("handoff_status: spent", self.old_handoff.read_text(encoding="utf-8"))
        committed_paths = subprocess.check_output(
            ["git", "-C", str(self.project), "show", "--name-only", "--format="], text=True,
        ).splitlines()
        self.assertEqual(set(committed_paths),
            {handoffs[0].relative_to(self.project).as_posix(), "handoffs/2026-08-31-2257.md"},
        )
        status = subprocess.check_output(
            ["git", "-C", str(self.project), "status", "--short"], text=True,
        )
        self.assertEqual(status, "")
        logs = list((self.root / "tmp/agent-vault-cache").glob("precompact-test-session-*.log"))
        self.assertEqual(len(logs), 1)
        self.assertIn("result=written", logs[0].read_text(encoding="utf-8"))

    def test_rejects_invalid_results_before_mutating_records(self) -> None:
        valid = self.valid_result()
        invalid = [
            {"action": "write"},
            dict(valid, action="unknown"),
            dict(valid, unexpected=True),
            dict(valid, description=None),
            dict(valid, description="x" * 101),
            dict(valid, description="two\nlines"),
            dict(valid, description="two\rlines"),
            dict(valid, goal=" \t"),
            dict(valid, next_step=8),
            dict(valid, state=[None]),
            dict(valid, then="not an array"),
            dict(valid, supersede_ids=[1]),
            dict(valid, action="skip"),
            [valid],
        ]
        old = self.old_handoff.read_bytes()
        for payload in invalid:
            with self.subTest(payload=payload):
                result = self.run_hook(payload)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.handoff_path.exists())
                self.assertEqual(self.old_handoff.read_bytes(), old)
                self.assertFalse(list((self.project / "handoffs").glob(".precompact.*")))

    def test_consistent_skip_preserves_records(self) -> None:
        payload = self.valid_result()
        payload = {key: "" if isinstance(value, str) else [] for key, value in payload.items()}
        payload["action"] = "skip"
        old = self.old_handoff.read_bytes()
        self.assertEqual(self.run_hook(payload).returncode, 0)
        self.assertFalse(self.handoff_path.exists())
        self.assertEqual(self.old_handoff.read_bytes(), old)

    def test_current_handoff_cannot_supersede_itself(self) -> None:
        payload = dict(self.valid_result(), supersede_ids=[self.handoff_path.stem])
        self.assertEqual(self.run_hook(payload).returncode, 0)
        self.assertIn("handoff_status: live", self.handoff_path.read_text())
        self.assertIn("handoff_status: live", self.old_handoff.read_text())

    def test_preserves_competing_publication(self) -> None:
        self.write_executable(
            self.fake_bin / "mktemp",
            f"#!{sys.executable}\n"
            "import os,subprocess,sys,time\nfrom pathlib import Path\n"
            f"result = subprocess.check_output([{shutil.which('mktemp')!r}] + sys.argv[1:], text=True)\n"
            "if '.precompact.' in sys.argv[-1]:\n"
            f"    barrier = Path({str(self.root)!r})\n"
            "    (barrier / f'arrived-{os.getpid()}').touch()\n"
            "    deadline = time.monotonic() + 5\n"
            "    while len(list(barrier.glob('arrived-*'))) < 2:\n"
            "        if time.monotonic() > deadline: sys.exit(1)\n"
            "        time.sleep(0.01)\n"
            "print(result, end='')\n",
        )
        old = self.old_handoff.read_bytes()
        processes = []
        try:
            for goal in ("First capture", "Second capture"):
                env = self.environment(dict(self.valid_result(), goal=goal, supersede_ids=[]))
                process = subprocess.Popen(
                    ["bash", str(HOOK)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, text=True, env=env, start_new_session=True,
                )
                processes.append(process)
                assert process.stdin is not None
                event = dict(json.loads(self.hook_input()), session_id=goal)
                process.stdin.write(json.dumps(event))
                process.stdin.close()
                process.stdin = None
            for process in processes:
                _, stderr = process.communicate(timeout=15)
                self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(self.old_handoff.read_bytes(), old)
            content = self.handoff_path.read_text()
            self.assertEqual(sum(goal in content for goal in ("First capture", "Second capture")), 1)
            self.assertFalse(list((self.project / "handoffs").glob(".precompact.*")))
            commits = subprocess.check_output(
                ["git", "-C", str(self.project), "rev-list", "--count", "HEAD"], text=True,
            )
            self.assertEqual(commits.strip(), "2")
            results = [line for path in (self.root / "tmp/agent-vault-cache").glob("*.log")
                       for line in path.read_text().splitlines() if line.startswith("result=")]
            self.assertCountEqual(results, ["result=written", "result=target-exists"])
        finally:
            for process in processes:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=3)

    def test_existing_target_skips_without_supersession(self) -> None:
        self.handoff_path.write_text("Existing handoff\n")
        old = self.old_handoff.read_bytes()
        self.assertEqual(self.run_hook(self.valid_result()).returncode, 0)
        self.assertEqual(self.handoff_path.read_text(), "Existing handoff\n")
        self.assertEqual(self.old_handoff.read_bytes(), old)

    def test_nonabsolute_or_unavailable_event_cwd_does_not_use_inherited_project(self) -> None:
        shutil.copy2(PLUGIN_ROOT / "bin/resolve-project.sh", self.fake_plugin / "bin/resolve-project.sh")
        env = self.environment(self.valid_result())
        env["FAKE_VAULT_ROOT"] = str(self.root)
        for cwd in (".", str(self.root / "missing")):
            with self.subTest(cwd=cwd):
                result = subprocess.run(
                    ["bash", str(HOOK)], input=self.hook_input(cwd),
                    capture_output=True, text=True, env=env, cwd=self.project, timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.args_path.exists())
                self.assertFalse(self.handoff_path.exists())

    def test_retires_descendants_after_success_and_failure(self) -> None:
        pid_file = self.root / "descendant.pid"
        for status in (0, 7):
            with self.subTest(status=status):
                env = self.environment(self.valid_result())
                env.update(FAKE_CODEX_DESCENDANT=str(pid_file), FAKE_CODEX_STATUS=str(status))
                try:
                    completed = subprocess.run(
                        ["bash", str(HOOK)], input=self.hook_input(), env=env,
                        capture_output=True, text=True, timeout=10,
                    )
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    pid = int(pid_file.read_text())
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        try:
                            os.kill(pid, 0)
                        except ProcessLookupError:
                            break
                        time.sleep(0.02)
                    else:
                        self.fail("analysis descendant survived hook completion")
                finally:
                    if pid_file.exists():
                        try:
                            os.kill(int(pid_file.read_text()), signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        pid_file.unlink()

    def test_term_cancels_and_reaps_analysis_before_returning(self) -> None:
        env = self.environment(self.valid_result())
        pid_file = self.root / "analysis.pid"
        env["FAKE_CODEX_WAIT"] = str(pid_file)
        process = subprocess.Popen(
            ["bash", str(HOOK)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, env=env, start_new_session=True,
        )
        child_pid = None
        try:
            assert process.stdin is not None
            process.stdin.write(self.hook_input())
            process.stdin.close()
            process.stdin = None
            deadline = time.monotonic() + 5
            while not pid_file.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(pid_file.exists(), "analysis did not start")
            child_pid = int(pid_file.read_text())
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=3)
            self.assertEqual(process.returncode, 143)
            with self.assertRaises(ProcessLookupError):
                os.kill(child_pid, 0)
            self.assertFalse(self.handoff_path.exists())
            cache = self.root / "tmp/agent-vault-cache"
            self.assertEqual([path for path in cache.iterdir() if path.suffix != ".log"], [])
        finally:
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=3)


if __name__ == "__main__":
    unittest.main()
