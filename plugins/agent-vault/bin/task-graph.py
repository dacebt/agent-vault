#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from lib import task_graph, task_store  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: task-graph.py <project-path>", file=sys.stderr)
        raise SystemExit(2)
    try:
        result = task_graph.audit(sys.argv[1])
    except (task_store.TaskStoreError, OSError, ValueError) as error:
        print(f"task-graph: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
