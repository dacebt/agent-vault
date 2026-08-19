#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

DATE_ID_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
FRONTMATTER_BOUNDARY_RE = re.compile(r"---\s*")
INLINE_ALIASES_RE = re.compile(r"aliases:\s*\[([^]]*)].*")


@dataclass(frozen=True)
class Concept:
    path: Path
    relative: str
    concept_id: str
    aliases: tuple[str, ...]
    body: tuple[tuple[int, str], ...]


def split_frontmatter(lines: list[str]) -> tuple[list[str], int]:
    if not lines or not FRONTMATTER_BOUNDARY_RE.fullmatch(lines[0]):
        return [], 0
    for index, line in enumerate(lines[1:], start=1):
        if FRONTMATTER_BOUNDARY_RE.fullmatch(line):
            return lines[1:index], index + 1
    return lines[1:], len(lines)


def aliases_from(frontmatter: list[str]) -> tuple[str, ...]:
    for line in frontmatter:
        match = INLINE_ALIASES_RE.fullmatch(line)
        if match:
            return tuple(alias.strip() for alias in match.group(1).split(",") if alias.strip())
    return ()


def load_concept(project: Path, path: Path) -> Concept:
    lines = path.read_text(encoding="utf-8").splitlines()
    frontmatter, body_start = split_frontmatter(lines)
    return Concept(
        path=path,
        relative=path.relative_to(project).as_posix(),
        concept_id=path.stem,
        aliases=aliases_from(frontmatter),
        body=tuple(enumerate(lines[body_start:], start=body_start + 1)),
    )


def concepts_in(project: Path) -> list[Concept]:
    paths = (
        path
        for path in project.rglob("*.md")
        if path.name not in {"index.md", "log.md", "README.md"}
        and path.relative_to(project).parts[0] != "views"
    )
    return [load_concept(project, path) for path in sorted(paths)]


def terms_for(concept: Concept) -> list[tuple[str, str, re.Pattern[str]]]:
    terms: list[tuple[str, str]] = []
    if len(concept.concept_id) >= 6 and not DATE_ID_RE.fullmatch(concept.concept_id):
        terms.append(("id", concept.concept_id))
    terms.extend(("alias", alias) for alias in concept.aliases)
    return [
        (kind, value, re.compile(rf"(^|[^A-Za-z0-9_-]){re.escape(value)}([^A-Za-z0-9_-]|$)"))
        for kind, value in terms
    ]


def findings(project: Path) -> list[str]:
    concepts = concepts_in(project)
    results: list[str] = []
    for source in concepts:
        terms = terms_for(source)
        if not terms:
            continue
        for target in concepts:
            if target.path == source.path:
                continue
            for kind, value, pattern in terms:
                for line_number, line in target.body:
                    if "](" in line or "[[" in line or not pattern.search(line):
                        continue
                    if kind == "alias":
                        detail = (
                            f"bare mention of alias `{value}` for `{source.concept_id}` — link it?"
                        )
                    else:
                        detail = f"bare mention of `{source.concept_id}` — link it?"
                    results.append(f"- `{target.relative}` {line_number}: {line}  ({detail})")
    return results


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: unlinked-mentions.py <project-path>", file=sys.stderr)
        raise SystemExit(2)
    project = Path(sys.argv[1]).resolve()
    if not project.is_dir():
        print(f"unlinked-mentions: no such project: {project}", file=sys.stderr)
        raise SystemExit(1)
    print("\n".join(findings(project)))


if __name__ == "__main__":
    main()
