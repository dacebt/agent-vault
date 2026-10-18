#!/usr/bin/env bash
# Link verified receipts from explicit Git commit commands to the most recently
# touched in-progress or blocked task. Existing associations make retries idempotent; a
# recorded task is acknowledged only after its database matches the committed blob.

set -euo pipefail
PLUGIN_ROOT="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
command -v python3 >/dev/null 2>&1 || { echo 'agent-vault commit link: python3 is required' >&2; exit 1; }

exec python3 - "$PLUGIN_ROOT" 3<&0 <<'PY'
from __future__ import annotations

import datetime
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path


class CaptureError(Exception):
    pass


def run(args: list[str], *, body: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=body, capture_output=True, text=True)


def checked(args: list[str], *, body: str | None = None) -> str:
    result = run(args, body=body)
    if result.returncode:
        detail = result.stderr.strip() or f"exit {result.returncode}"
        raise CaptureError(f"{Path(args[0]).name} failed: {detail}")
    return result.stdout


def result_text(event: dict) -> str:
    response = event.get("tool_response", event.get("tool_result"))
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        for key in ("stdout", "output"):
            text = response.get(key)
            if isinstance(text, str):
                return text
    return ""


def commit_directory_arguments(event: dict) -> list[list[str]]:
    tool_input = event.get("tool_input", event.get("input", {}))
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if command is None:
        command = event.get("command")
    if not isinstance(command, str):
        return []
    lexer = shlex.shlex(command, posix=False, punctuation_chars=";&|()\n")
    lexer.whitespace = " \t\r"
    try:
        tokens = list(lexer)
    except ValueError:
        return []
    segments: list[list[str]] = [[]]
    for token in tokens:
        if all(character in ";&|()\n" for character in token):
            segments.append([])
        else:
            segments[-1].append(token)
    commits: list[list[str]] = []
    for segment in segments:
        while segment and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", segment[0]):
            segment = segment[1:]
        if not segment or Path(segment[0].strip("\"'")).name != "git":
            continue
        index = 1
        directories: list[str] = []
        while index < len(segment) and segment[index].startswith("-"):
            option = segment[index]
            if option in ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"):
                if option == "-C" and index + 1 < len(segment):
                    directories.append(segment[index + 1])
                index += 2
            elif option in (
                "--no-pager", "--paginate", "--no-optional-locks", "--no-replace-objects"
            ) or option.startswith((
                "-C", "-c", "--git-dir=", "--work-tree=", "--namespace=", "--config-env="
            )):
                index += 1
            else:
                break
        if index < len(segment) and segment[index] == "commit":
            commits.append(directories)
    return commits


def commit_directory(base: Path, arguments: list[str]) -> Path | None:
    directory = base
    for argument in arguments:
        text = argument
        if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
            text = text[1:-1]
        if not text:
            continue
        if text.startswith("~") or re.search(r"[$`\\*?\[{]", text):
            return None
        directory = directory / text
    return directory if directory.is_dir() else None


def read_tasks(task_cli: list[str], project: str) -> list[dict]:
    tasks = json.loads(checked([*task_cli, "list", project]))
    if not isinstance(tasks, list) or any(
        not isinstance(task, dict) or any(not isinstance(task.get(key), str) for key in
        ("id", "task_status", "generated_at", "body_markdown")) for task in tasks
    ):
        raise CaptureError("task list returned invalid records")
    return tasks


def insert_link(body: str, line: str) -> str:
    heading = re.search(r"^## Commits[ \t]*(?:\r?\n|$)", body, re.MULTILINE)
    if heading:
        prefix = body[:heading.end()]
        return prefix + ("" if prefix.endswith("\n") else "\n") + line + "\n" + body[heading.end():]
    return body + ("" if not body or body.endswith("\n") else "\n") + "\n## Commits\n" + line + "\n"


def link_commits(output: str) -> None:
    receipts = re.findall(r"^\[[^\]\r\n]+ ([0-9a-fA-F]{4,64})\] [^\r\n]*$", output, re.MULTILINE)
    if not receipts:
        return
    repository = run(["git", "rev-parse", "--show-toplevel"])
    if repository.returncode:
        return
    git = ["git", "-C", repository.stdout.strip()]
    commits: list[str] = []
    for receipt in receipts:
        resolved = run([*git, "rev-parse", "--verify", f"{receipt}^{{commit}}"])
        if resolved.returncode:
            continue
        sha = resolved.stdout.strip()
        if sha not in commits:
            commits.append(sha)
    if not commits:
        return

    plugin = Path(sys.argv[1])
    vault = run([str(plugin / "bin/find-vault.sh")])
    if vault.returncode:
        return
    project_result = run([str(plugin / "bin/resolve-project.sh"), vault.stdout.strip()])
    if project_result.returncode:
        return
    project = project_result.stdout.strip()
    database = Path(project) / "tasks/tasks.sqlite3"
    if not database.is_file():
        return
    task_cli = [sys.executable, str(plugin / "bin/task-db.py")]
    tasks = read_tasks(task_cli, project)
    active = [task for task in tasks if task["task_status"] in ("in-progress", "blocked")]
    selected = sorted(active, key=lambda task: task["generated_at"])[-1] if active else None
    recorded: list[str] = []
    for sha in commits:
        short = checked([*git, "rev-parse", "--short", sha]).strip()
        associated = next((task for task in tasks if f"`{short}`" in task["body_markdown"]
                           or f"`{sha}`" in task["body_markdown"]), None)
        if associated is None:
            if selected is None:
                continue
            task = json.loads(checked([*task_cli, "show", project, selected["id"]]))
            body = task.get("body_markdown")
            if not isinstance(body, str):
                raise CaptureError("task body is not text")
            subject = checked([*git, "show", "-s", "--format=%s", sha]).removesuffix("\n")
            today = datetime.date.today().isoformat()
            updated = insert_link(body, f"- {today} — `{short}` {subject}")
            checked([*task_cli, "update", project, selected["id"], "--body-file", "-"], body=updated)
            saved = json.loads(checked([*task_cli, "show", project, selected["id"]]))
            if saved.get("body_markdown") != updated:
                raise CaptureError(f"task {selected['id']} did not preserve the recorded commit")
            selected["body_markdown"] = updated
        recorded.append(short)
    if not recorded:
        return

    checked([str(plugin / "bin/vault-commit.sh"), "docs(vault): link commits " + ", ".join(recorded), str(database)])
    vault_repo = checked(["git", "-C", str(database.parent), "rev-parse", "--show-toplevel"]).strip()
    relative = database.resolve().relative_to(Path(vault_repo).resolve()).as_posix()
    committed = checked(["git", "-C", vault_repo, "rev-parse", "--verify", f"HEAD:{relative}"]).strip()
    actual = checked(["git", "-C", vault_repo, "hash-object", str(database)]).strip()
    if committed != actual:
        raise CaptureError("task database was written but not committed; retry this receipt after resolving vault Git errors")


def main() -> None:
    raw = os.fdopen(3).read()
    if not raw.strip():
        return
    event = json.loads(raw)
    if not isinstance(event, dict):
        raise CaptureError("hook input must be a JSON object")
    commits = commit_directory_arguments(event)
    if not commits:
        return
    base = Path.cwd()
    for key in ("cwd", "current_working_directory"):
        if key in event:
            cwd = event[key]
            if not isinstance(cwd, str) or not cwd or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
                return
            base = Path(cwd)
            break

    output = re.sub(r"\x1b\[[0-9;]*m", "", result_text(event))
    targets: list[Path] = []
    for arguments in commits:
        target = commit_directory(base, arguments)
        if target is not None and target not in targets:
            targets.append(target)
    for target in targets:
        os.chdir(target)
        link_commits(output)


try:
    main()
except (CaptureError, OSError, ValueError, KeyError, TypeError) as error:
    print(f"agent-vault commit link: {error}", file=sys.stderr)
    sys.exit(1)
PY
