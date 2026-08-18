#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = PLUGIN_ROOT / "bin" / "viewer.sh"
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_store  # noqa: E402


def unused_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class ViewerLauncherTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-viewer-launcher-")
        self.root = Path(self.temp.name)
        self.vault = self.root / "vault"
        self.project = self.vault / "fixture"
        self.state = self.root / "state"
        self.port = unused_port()
        task_store.initialize(self.project)
        (self.project / "index.md").write_text("# Fixture\n", encoding="utf-8")
        self.environment = {
            **os.environ,
            "AGENT_VAULT": str(self.vault),
            "AGENT_VAULT_VIEWER_STATE_DIR": str(self.state),
            "PORT": str(self.port),
        }

    def tearDown(self) -> None:
        subprocess.run(
            ["bash", str(LAUNCHER), "stop"],
            env=self.environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.temp.cleanup()

    def invoke(self, operation: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(LAUNCHER), operation],
            env=self.environment,
            capture_output=True,
            text=True,
            check=check,
        )

    def test_start_status_api_and_stop_share_one_owned_process(self) -> None:
        started = self.invoke("start")
        self.assertIn(f"url: http://127.0.0.1:{self.port}", started.stdout)
        self.assertIn(f"vault: {self.vault}", started.stdout)
        started_pid = (self.state / "viewer.pid").read_text(encoding="utf-8").strip()

        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/api/projects", timeout=2
        ) as response:
            projects = json.load(response)
        self.assertEqual(
            projects,
            {
                "projects": [
                    {
                        "name": "fixture",
                        "counts": {"backlog": 0, "todo": 0, "in-progress": 0, "done": 0},
                    }
                ]
            },
        )

        status = self.invoke("status")
        self.assertIn(f"pid: {started_pid}", status.stdout)
        self.assertEqual((self.state / "viewer.pid").read_text(encoding="utf-8").strip(), started_pid)

        stopped = self.invoke("stop")
        self.assertIn("viewer stopped", stopped.stdout)
        self.assertFalse((self.state / "viewer.pid").exists())
        self.assertIn("viewer stopped", self.invoke("status").stdout)

    def test_live_unowned_pid_is_refused_and_left_running(self) -> None:
        self.state.mkdir(parents=True)
        (self.state / "viewer.pid").write_text(f"{os.getpid()}\n", encoding="utf-8")
        (self.state / "viewer.server").write_text(
            f"{PLUGIN_ROOT / 'viewer' / 'server.mjs'}\n", encoding="utf-8"
        )

        result = self.invoke("stop", check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing to stop it", result.stderr)
        os.kill(os.getpid(), 0)

    def test_persistent_agent_session_remains_manageable_from_other_calls(self) -> None:
        process = subprocess.Popen(
            ["bash", str(LAUNCHER), "session"],
            env=self.environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            assert process.stdout is not None
            startup = "".join(process.stdout.readline() for _ in range(5))
            self.assertIn("viewer running", startup)
            self.assertIsNone(process.poll())

            status = self.invoke("status")
            session_pid = (self.state / "viewer.pid").read_text(encoding="utf-8").strip()
            self.assertIn(f"pid: {session_pid}", status.stdout)

            self.invoke("stop")
            process.wait(timeout=2)
            self.assertFalse((self.state / "viewer.pid").exists())
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=2)
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()


if __name__ == "__main__":
    unittest.main()
