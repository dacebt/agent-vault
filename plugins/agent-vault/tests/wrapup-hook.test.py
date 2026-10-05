#!/usr/bin/env python3
"""Check advisory hook routing without writing project records."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


class WrapupHookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-wrapup-hook-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.vault = self.root / "vault"
        self.project = self.vault / "tracked"
        self.project.mkdir(parents=True)
        self.untracked = self.root / "untracked"
        self.untracked.mkdir()
        self.env = dict(os.environ, AGENT_VAULT=str(self.vault), CLAUDE_PLUGIN_ROOT=str(PLUGIN_ROOT))

    def hook(self, event: dict | str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["bash", str(PLUGIN_ROOT / "bin/hook-user-prompt-wrapup.sh")],
                              input=event if isinstance(event, str) else json.dumps(event),
                              cwd=cwd or self.project, env=self.env,
                              text=True, capture_output=True)

    def test_event_directory_controls_reminder_and_supplied_invalid_directory_skips(self) -> None:
        result = self.hook({"prompt": "wrap up", "cwd": str(self.project)}, cwd=self.untracked)
        self.assertEqual(result.returncode, 0)
        context = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(context["hookEventName"], "UserPromptSubmit")
        self.assertTrue(context["additionalContext"])
        for cwd in (str(self.untracked), str(self.root / "missing"), "", None, "relative", 1):
            with self.subTest(cwd=cwd):
                result = self.hook({"prompt": "wrap up", "cwd": cwd})
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        self.assertEqual(list(self.project.iterdir()), [])

    def test_absent_directory_uses_inherited_project_and_ordinary_prompt_stays_quiet(self) -> None:
        self.assertTrue(self.hook({"prompt": "wrap up"}).stdout)
        for event in ({"prompt": "continue implementation"}, {"prompt": None}, {}):
            result = self.hook(event)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        self.assertEqual(list(self.project.iterdir()), [])

    def test_malformed_event_is_diagnostic(self) -> None:
        for event in ("not JSON", "[]"):
            result = self.hook(event)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("agent-vault wrapup:", result.stderr)
            self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
