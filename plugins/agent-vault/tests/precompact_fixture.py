from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
HOOK = PLUGIN_ROOT / "bin/hook-precompact-handoff.sh"


class PreCompactFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-precompact-test-")
        self.root = Path(self.temp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        (self.project / "handoffs").mkdir()
        self.old_handoff = self.project / "handoffs/2026-08-31-2257.md"
        self.old_handoff.write_text(
            "---\ntype: handoff\nstatus: stable\nhandoff_status: live\n---\nOld handoff.\n",
            encoding="utf-8",
        )
        self.fake_plugin = self.root / "plugin"
        (self.fake_plugin / "bin").mkdir(parents=True)
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir()
        self.handoff_path = self.project / "handoffs/2026-10-04-1234.md"
        self.write_executable(
            self.fake_bin / "date",
            '#!/bin/sh\nif [ "$1" = "+%Y-%m-%d-%H%M" ]; then printf "2026-10-04-1234\n"; else exec /bin/date "$@"; fi\n',
        )
        self.args_path = self.root / "codex-args.json"
        self.stdin_path = self.root / "codex-stdin.txt"
        self.transcript = self.root / "transcript.jsonl"
        self.transcript.write_bytes(
            b"old-marker\n" + (b"x" * 600_000) + b"\nrecent-marker\n"
        )
        self.write_executable(
            self.fake_plugin / "bin/find-vault.sh",
            '#!/bin/sh\nprintf "%s\\n" "$FAKE_VAULT_ROOT"\n',
        )
        self.write_executable(
            self.fake_plugin / "bin/resolve-project.sh",
            '#!/bin/sh\nprintf "%s\\n" "$FAKE_PROJECT_PATH"\n',
        )
        shutil.copy2(
            PLUGIN_ROOT / "bin/mark-handoff-spent.sh",
            self.fake_plugin / "bin/mark-handoff-spent.sh",
        )
        shutil.copy2(
            PLUGIN_ROOT / "bin/vault-commit.sh",
            self.fake_plugin / "bin/vault-commit.sh",
        )
        self.write_executable(
            self.fake_bin / "codex",
            """#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
from pathlib import Path

arguments = sys.argv[1:]
Path(os.environ["FAKE_CODEX_ARGS"]).write_text(json.dumps(arguments), encoding="utf-8")
Path(os.environ["FAKE_CODEX_STDIN"]).write_text(sys.stdin.read(), encoding="utf-8")
if os.environ.get("FAKE_CODEX_WAIT"):
    Path(os.environ["FAKE_CODEX_WAIT"]).write_text(str(os.getpid()))
    time.sleep(30)
output_path = Path(arguments[arguments.index("--output-last-message") + 1])
output_path.write_text(os.environ["FAKE_CODEX_RESULT"], encoding="utf-8")
if os.environ.get("FAKE_CODEX_DESCENDANT"):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    Path(os.environ["FAKE_CODEX_DESCENDANT"]).write_text(str(child.pid))
sys.exit(int(os.environ.get("FAKE_CODEX_STATUS", "0")))
""",
        )
        for args in (["init", "-q"], ["config", "user.name", "Hook Test"],
                     ["config", "user.email", "hook@test.invalid"], ["add", "handoffs"],
                     ["commit", "-q", "-m", "fixture"]):
            subprocess.run(["git", "-C", str(self.project), *args], check=True)

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def write_executable(path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")
        path.chmod(0o755)

    @staticmethod
    def valid_result() -> dict[str, object]:
        return {
            "action": "write",
            "description": "Hook repair mid-flight; next: run focused verification",
            "goal": "Finish the bounded PreCompact repair.",
            "state": ["The recent transcript evidence was reconstructed."],
            "next_step": "Run the focused hook test.",
            "then": ["Inspect the generated handoff."],
            "watch_out": ["Do not read the discarded transcript prefix."],
            "open_questions": [],
            "where": ["The repair is in the plugin hook."],
            "supersede_ids": ["2026-08-31-2257"],
        }

    def environment(self, result_payload: object) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{self.fake_bin}:{environment['PATH']}",
                "TMPDIR": str(self.root / "tmp"),
                "CLAUDE_PLUGIN_ROOT": str(self.fake_plugin),
                "FAKE_VAULT_ROOT": str(self.root / "vault-root"),
                "FAKE_PROJECT_PATH": str(self.project),
                "FAKE_CODEX_ARGS": str(self.args_path),
                "FAKE_CODEX_STDIN": str(self.stdin_path),
                "FAKE_CODEX_RESULT": json.dumps(result_payload),
            }
        )
        environment.pop("AGENT_VAULT_PRECOMPACT_ACTIVE", None)
        environment.pop("AGENT_VAULT_SESSIONEND_ACTIVE", None)
        (self.root / "tmp").mkdir(exist_ok=True)
        return environment

    def hook_input(self, cwd: str | None = None) -> str:
        return json.dumps(
            {
                "transcript_path": str(self.transcript),
                "trigger": "auto",
                "cwd": str(self.project) if cwd is None else cwd,
                "session_id": "test-session",
            }
        )

    def run_hook(self, payload: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(HOOK)],
            input=self.hook_input(),
            capture_output=True, text=True, env=self.environment(payload), timeout=15,
        )
