#!/usr/bin/env python3
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


@unittest.skipUnless(
    shutil.which("jq") and shutil.which("git"),
    "jq and git are required by the PreCompact hook",
)
class PreCompactHookTest(unittest.TestCase):
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
import sys
from pathlib import Path

arguments = sys.argv[1:]
Path(os.environ["FAKE_CODEX_ARGS"]).write_text(json.dumps(arguments), encoding="utf-8")
Path(os.environ["FAKE_CODEX_STDIN"]).write_text(sys.stdin.read(), encoding="utf-8")
output_path = Path(arguments[arguments.index("--output-last-message") + 1])
output_path.write_text(os.environ["FAKE_CODEX_RESULT"], encoding="utf-8")
""",
        )
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.name", "Hook Test"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.email", "hook@test.invalid"],
            check=True,
        )
        subprocess.run(["git", "-C", str(self.project), "add", "handoffs"], check=True)
        subprocess.run(
            ["git", "-C", str(self.project), "commit", "-q", "-m", "fixture"],
            check=True,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def write_executable(path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")
        path.chmod(0o755)

    def test_bounds_analysis_and_commits_validated_handoff(self) -> None:
        result_payload = {
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
        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{self.fake_bin}:{environment['PATH']}",
                "TMPDIR": str(self.root / "tmp"),
                "PLUGIN_ROOT": str(self.fake_plugin),
                "FAKE_VAULT_ROOT": str(self.root / "vault-root"),
                "FAKE_PROJECT_PATH": str(self.project),
                "FAKE_CODEX_ARGS": str(self.args_path),
                "FAKE_CODEX_STDIN": str(self.stdin_path),
                "FAKE_CODEX_RESULT": json.dumps(result_payload),
            }
        )
        (self.root / "tmp").mkdir()
        hook_input = json.dumps(
            {
                "transcript_path": str(self.transcript),
                "trigger": "auto",
                "cwd": str(self.project),
                "session_id": "test-session",
            }
        )

        completed = subprocess.run(
            ["bash", str(HOOK)],
            input=hook_input,
            capture_output=True,
            text=True,
            check=False,
            env=environment,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        arguments = json.loads(self.args_path.read_text(encoding="utf-8"))
        self.assertIn("read-only", arguments)
        self.assertIn('model_reasoning_effort="low"', arguments)
        self.assertIn('model_reasoning_summary="none"', arguments)
        self.assertIn('model_verbosity="low"', arguments)
        prompt_input = self.stdin_path.read_text(encoding="utf-8")
        self.assertIn("recent-marker", prompt_input)
        self.assertNotIn("old-marker", prompt_input)
        self.assertLess(len(prompt_input), 540_000)

        handoffs = [
            path
            for path in (self.project / "handoffs").glob("*.md")
            if path != self.old_handoff
        ]
        self.assertEqual(len(handoffs), 1)
        handoff = handoffs[0].read_text(encoding="utf-8")
        self.assertIn('session: "test-session"', handoff)
        self.assertIn("## Next step\n\nRun the focused hook test.", handoff)
        self.assertIn("status: deprecated", self.old_handoff.read_text(encoding="utf-8"))
        self.assertIn("handoff_status: spent", self.old_handoff.read_text(encoding="utf-8"))
        committed_paths = subprocess.run(
            ["git", "-C", str(self.project), "show", "--name-only", "--format="],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines()
        self.assertEqual(
            set(committed_paths),
            {handoffs[0].relative_to(self.project).as_posix(), "handoffs/2026-08-31-2257.md"},
        )
        status = subprocess.run(
            ["git", "-C", str(self.project), "status", "--short"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(status.stdout, "")
        logs = list((self.root / "tmp/agent-vault-cache").glob("precompact-test-session-*.log"))
        self.assertEqual(len(logs), 1)
        self.assertIn("result=written", logs[0].read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
