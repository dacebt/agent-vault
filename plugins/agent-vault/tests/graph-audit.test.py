#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
GRAPH_AUDIT = PLUGIN_ROOT / "bin" / "graph-audit.sh"


class GraphAuditTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agent-vault-graph-audit-")
        self.project = Path(self.temp.name) / "fixture"
        subprocess.run(
            ["python3", str(PLUGIN_ROOT / "bin" / "task-db.py"), "init", str(self.project)],
            check=True,
            capture_output=True,
            text=True,
        )
        (self.project / "knowledge").mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_audit(self, *arguments: str, timeout: float = 10) -> str:
        result = subprocess.run(
            [str(GRAPH_AUDIT), *arguments, str(self.project)],
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout

    def write_concept(self, name: str, body: str, aliases: str | None = None) -> None:
        alias_line = f"aliases: [{aliases}]\n" if aliases else ""
        (self.project / "knowledge" / f"{name}.md").write_text(
            "---\n"
            "type: note\n"
            f"description: {name} remains linked.\n"
            f"{alias_line}"
            "---\n"
            f"# {name}\n\n"
            f"{body}\n",
            encoding="utf-8",
        )

    def write_index(self, names: list[str]) -> None:
        entries = "\n".join(f"- [{name}](/knowledge/{name}.md)" for name in names)
        (self.project / "knowledge" / "index.md").write_text(
            f"# Knowledge\n\n{entries}\n",
            encoding="utf-8",
        )

    def test_reports_ids_and_aliases_only_when_they_are_bare_body_mentions(self) -> None:
        self.write_concept(
            "canonical-baseline",
            "This canonical-baseline self-reference is ignored.\n\n"
            "See [the index](/knowledge/index.md).",
            aliases="byte pin, v1",
        )
        self.write_concept(
            "consumer-note",
            "canonical-baseline remains the rule.\n"
            "The byte pin protects parity.\n"
            "The v1 behavior is retained.\n"
            "[canonical-baseline](/knowledge/canonical-baseline.md) is already linked.\n\n"
            "See [the index](/knowledge/index.md).",
        )
        self.write_index(["canonical-baseline", "consumer-note"])

        output = self.run_audit()

        self.assertIn("## UNLINKED MENTIONS", output)
        self.assertIn("bare mention of `canonical-baseline`", output)
        self.assertIn("bare mention of alias `byte pin` for `canonical-baseline`", output)
        self.assertIn("bare mention of alias `v1` for `canonical-baseline`", output)
        self.assertEqual(output.count("bare mention"), 3)
        self.assertNotIn("self-reference", output)
        self.assertIn("\nSUMMARY: concepts=2", output)

        quick_output = self.run_audit("--quick")
        self.assertNotIn("UNLINKED MENTIONS", quick_output)
        self.assertIn(
            "SUMMARY: concepts=2 orphans=0 dangling=0 legacy=0 missing_index=0 index_gaps=0",
            quick_output,
        )

    def test_full_audit_completes_for_eighty_concepts(self) -> None:
        names = [f"concept-{index:03d}" for index in range(80)]
        for name in names:
            self.write_concept(name, "See [the index](/knowledge/index.md).")
        self.write_index(names)

        output = self.run_audit(timeout=10)

        self.assertIn(
            "SUMMARY: concepts=80 orphans=0 dangling=0 legacy=0 missing_index=0 index_gaps=0",
            output,
        )


if __name__ == "__main__":
    unittest.main()
