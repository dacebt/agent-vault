#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
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
        stopped = subprocess.run(
            ["bash", str(LAUNCHER), "stop"],
            env=self.environment,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertFalse((self.state / "viewer.pid").exists())
        self.temp.cleanup()

    def invoke(self, operation: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(LAUNCHER), operation],
            env=self.environment,
            capture_output=True,
            text=True,
            check=check,
            timeout=15,
        )

    def test_start_status_api_and_stop_share_one_owned_process(self) -> None:
        started = self.invoke("start")
        self.assertIn(f"url: http://127.0.0.1:{self.port}", started.stdout)
        self.assertIn(f"vault: {self.vault}", started.stdout)
        started_pid = (self.state / "viewer.pid").read_text(encoding="utf-8").strip()

        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/api/health", timeout=2
        ) as response:
            health = json.load(response)
        self.assertEqual(health["pid"], int(started_pid))
        self.assertEqual(
            health["instanceId"],
            (self.state / "viewer.instance-id").read_text(encoding="utf-8").strip(),
        )

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

    def test_unavailable_vault_preserves_identity_and_owned_stop(self) -> None:
        self.invoke("start")
        pid = int((self.state / "viewer.pid").read_text())
        instance_id = (self.state / "viewer.instance-id").read_text().strip()
        offline_vault = self.root / "offline-vault"
        self.vault.rename(offline_vault)
        try:
            with self.assertRaises(urllib.error.HTTPError) as failure:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/health", timeout=2)
            with failure.exception as response:
                self.assertEqual(response.code, 503)
                health = json.load(response)
            self.assertFalse(health["ok"])
            self.assertEqual(health["pid"], pid)
            self.assertEqual(health["instanceId"], instance_id)
            self.assertIn(f"pid: {pid}", self.invoke("status").stdout)

            (self.state / "viewer.instance-id").write_text(
                "00000000-0000-4000-8000-000000000000\n", encoding="utf-8"
            )
            rejected = self.invoke("stop", check=False)
            self.assertNotEqual(rejected.returncode, 0)
            os.kill(pid, 0)
            (self.state / "viewer.instance-id").write_text(instance_id + "\n", encoding="utf-8")

            self.invoke("stop")
            self.assertFalse((self.state / "viewer.pid").exists())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        finally:
            offline_vault.rename(self.vault)
            if (self.state / "viewer.pid").exists():
                (self.state / "viewer.instance-id").write_text(instance_id + "\n", encoding="utf-8")

    def test_launcher_resolves_bundled_server_from_its_own_path(self) -> None:
        environment = {
            **self.environment,
            "PLUGIN_ROOT": str(self.root / "unrelated-plugin"),
            "CLAUDE_PLUGIN_ROOT": str(self.root / "unrelated-claude-plugin"),
        }
        started = subprocess.run(
            ["bash", str(LAUNCHER), "start"],
            env=environment,
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
        self.assertIn(f"url: http://127.0.0.1:{self.port}", started.stdout)
        self.assertEqual(
            (self.state / "viewer.server").read_text(encoding="utf-8").strip(),
            str(PLUGIN_ROOT / "viewer" / "server.mjs"),
        )

    def test_live_unowned_pid_is_refused_and_left_running(self) -> None:
        self.state.mkdir(parents=True)
        (self.state / "viewer.pid").write_text(f"{os.getpid()}\n", encoding="utf-8")
        (self.state / "viewer.server").write_text(
            f"{PLUGIN_ROOT / 'viewer' / 'server.mjs'}\n", encoding="utf-8"
        )

        try:
            for operation in ("start", "session", "status", "stop"):
                with self.subTest(operation=operation):
                    result = self.invoke(operation, check=False)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("refusing", result.stderr)
                    os.kill(os.getpid(), 0)
                    self.assertEqual(
                        (self.state / "viewer.pid").read_text().strip(), str(os.getpid())
                    )
        finally:
            (self.state / "viewer.pid").unlink()
            (self.state / "viewer.server").unlink()

    def test_stale_identity_cannot_claim_or_stop_same_server_path_process(self) -> None:
        server = PLUGIN_ROOT / "viewer" / "server.mjs"
        process = subprocess.Popen(
            ["node", str(server)],
            env={**self.environment, "PORT": str(self.port)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            for _attempt in range(50):
                if process.poll() is not None:
                    assert process.stderr is not None
                    self.fail(process.stderr.read())
                try:
                    with urllib.request.urlopen(
                        f"http://127.0.0.1:{self.port}/api/health", timeout=1
                    ) as response:
                        live_health = json.load(response)
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                self.fail("separately launched viewer did not become healthy")

            self.state.mkdir(parents=True)
            (self.state / "viewer.pid").write_text(f"{process.pid}\n", encoding="utf-8")
            (self.state / "viewer.server").write_text(f"{server}\n", encoding="utf-8")
            (self.state / "viewer.port").write_text(f"{self.port}\n", encoding="utf-8")
            (self.state / "viewer.vault").write_text(f"{self.vault}\n", encoding="utf-8")

            pending = self.invoke("status", check=False)
            self.assertNotEqual(pending.returncode, 0)
            self.assertIn("refusing", pending.stderr)
            self.assertIsNone(process.poll())
            self.assertEqual((self.state / "viewer.pid").read_text().strip(), str(process.pid))

            (self.state / "viewer.instance-id").write_text(
                "00000000-0000-4000-8000-000000000000\n", encoding="utf-8"
            )
            self.assertNotEqual(live_health["instanceId"], "00000000-0000-4000-8000-000000000000")

            for operation in ("start", "session", "status", "stop"):
                with self.subTest(operation=operation):
                    result = self.invoke(operation, check=False)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("refusing", result.stderr)
                    self.assertIsNone(process.poll())
                    self.assertEqual(
                        (self.state / "viewer.pid").read_text().strip(), str(process.pid)
                    )
        finally:
            for name in (
                "viewer.pid",
                "viewer.server",
                "viewer.port",
                "viewer.vault",
                "viewer.instance-id",
            ):
                (self.state / name).unlink(missing_ok=True)
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            if process.stderr is not None:
                process.stderr.close()

    def test_occupied_healthy_port_cannot_be_claimed_as_new_child(self) -> None:
        self.invoke("start")
        existing_pid = int((self.state / "viewer.pid").read_text())
        for operation in ("start", "session"):
            with self.subTest(operation=operation):
                competing_state = self.root / f"competing-{operation}"
                result = subprocess.run(
                    ["bash", str(LAUNCHER), operation],
                    env={**self.environment, "AGENT_VAULT_VIEWER_STATE_DIR": str(competing_state)},
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse((competing_state / "viewer.pid").exists())
                os.kill(existing_pid, 0)
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{self.port}/api/health", timeout=2
                ) as response:
                    health = json.load(response)
                self.assertTrue(health["ok"])
                self.assertEqual(health["pid"], existing_pid)

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

    def test_terminating_agent_session_retires_child_and_state(self) -> None:
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
            child_pid = int((self.state / "viewer.pid").read_text())
            process.terminate()
            process.wait(timeout=5)
            self.assertFalse((self.state / "viewer.pid").exists())
            with self.assertRaises(ProcessLookupError):
                os.kill(child_pid, 0)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()


if __name__ == "__main__":
    unittest.main()
