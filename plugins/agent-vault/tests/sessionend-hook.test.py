#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

PLUGIN = Path(__file__).resolve().parents[1]
SUPERVISOR = PLUGIN / "bin/sessionend-capture.py"


class SessionEndTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-sessionend-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pid_file = self.root / "child.pid"
        self.child = self.root / "writer.py"
        self.child.write_text(
            "import os, signal, sys, time\nfrom pathlib import Path\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "Path(os.environ['CHILD_PID']).write_text(str(os.getpid()))\n"
            "print('writer diagnostic', flush=True)\n"
            "time.sleep(float(os.environ.get('CHILD_SLEEP', '0')))\n"
            "sys.exit(int(os.environ.get('CHILD_EXIT', '23')))\n"
        )
        self.env = dict(os.environ, CHILD_PID=str(self.pid_file))

    def wait_for_pid(self) -> int:
        deadline = time.monotonic() + 5
        while not self.pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(self.pid_file.exists(), "writer never started")
        return int(self.pid_file.read_text())

    def assert_retired(self, pid: int) -> None:
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_retains_writer_failure_and_diagnostics(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SUPERVISOR), "--", sys.executable, str(self.child)],
            env=self.env, capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 23)
        self.assertIn("writer diagnostic", result.stdout)
        self.assertIn("exit_code=23", result.stdout)
        self.assertIn("state=retired", result.stdout)
        self.assert_retired(self.wait_for_pid())

    def test_deadline_retires_writer_that_ignores_term(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SUPERVISOR), "--timeout", "0.3", "--",
             sys.executable, str(self.child)],
            env=dict(self.env, CHILD_SLEEP="30"), capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertIn("result=timed-out", result.stdout)
        self.assert_retired(self.wait_for_pid())

    def test_cancellation_retires_writer_before_supervisor_exits(self) -> None:
        process = subprocess.Popen(
            [sys.executable, str(SUPERVISOR), "--", sys.executable, str(self.child)],
            env=dict(self.env, CHILD_SLEEP="30"), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        pid = None
        try:
            pid = self.wait_for_pid()
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 143, stderr)
            self.assertIn("result=interrupted", stdout)
            self.assert_retired(pid)
        finally:
            if pid is not None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)

    @unittest.skipUnless(shutil.which("jq"), "hook requires jq")
    def test_launcher_detaches_and_records_failure_without_touching_vault(self) -> None:
        plugin = self.root / "plugin"
        scripts = plugin / "bin"
        scripts.mkdir(parents=True)
        project = self.root / "project"
        project.mkdir()
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        transcript = self.root / "transcript.jsonl"
        transcript.write_text('{}\n')
        for name in ("find-vault.sh", "resolve-project.sh"):
            script = scripts / name
            script.write_text('#!/bin/sh\nprintf "%s\\n" "$FAKE_PROJECT"\n')
            script.chmod(0o755)
        shutil.copy2(SUPERVISOR, scripts / SUPERVISOR.name)
        codex = fake_bin / "codex"
        codex.write_text(f"#!{sys.executable}\n" + self.child.read_text())
        codex.chmod(0o755)
        env = dict(self.env, PLUGIN_ROOT=str(plugin), FAKE_PROJECT=str(project),
                   TMPDIR=str(self.root), PATH=f"{fake_bin}:{os.environ['PATH']}", CHILD_SLEEP="0.5")
        env.pop("AGENT_VAULT_SESSIONEND_ACTIVE", None)
        env.pop("AGENT_VAULT_PRECOMPACT_ACTIVE", None)
        payload = dict(transcript_path=str(transcript), cwd=str(project), session_id="test-session")
        hook = ["bash", str(PLUGIN / "bin/hook-sessionend-capture.sh")]
        for invalid_cwd in (str(self.root / "missing"), "", None, 42, "relative"):
            invalid = subprocess.run(
                hook, input=json.dumps(dict(payload, cwd=invalid_cwd)),
                env=env, cwd=project, capture_output=True, text=True, timeout=3,
            )
            self.assertEqual(invalid.returncode, 0)
            self.assertFalse(self.pid_file.exists())
            self.assertFalse((self.root / "agent-vault-cache").exists())
        pid = None
        try:
            result = subprocess.run(hook, input=json.dumps(payload), env=env,
                                    capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 0, result.stderr)
            pid = self.wait_for_pid()
            os.kill(pid, 0)
            log = next((self.root / "agent-vault-cache").glob("sessionend-*.log"))
            deadline = time.monotonic() + 5
            while "state=retired" not in log.read_text() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertIn("exit_code=23", log.read_text())
            self.assertIn("state=retired", log.read_text())
            self.assert_retired(pid)
            self.assertEqual(list(project.iterdir()), [])
        finally:
            if pid is not None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


if __name__ == "__main__":
    unittest.main()
