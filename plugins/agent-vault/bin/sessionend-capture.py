#!/usr/bin/env python3
"""Own the detached SessionEnd writer's deadline, process group, and diagnostic log."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
import signal
import subprocess
import time
from types import FrameType


def report(message: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat()} {message}", flush=True)


def signal_group(pid: int, signum: int) -> None:
    try:
        os.killpg(pid, signum)
    except ProcessLookupError:
        pass


def retire(child: subprocess.Popen[bytes]) -> None:
    signal_group(child.pid, signal.SIGTERM)
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        child.poll()
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    signal_group(child.pid, signal.SIGKILL)
    child.wait()


def run(command: list[str], timeout: float) -> int:
    interrupted = 0

    def request_stop(signum: int, _frame: FrameType | None) -> None:
        nonlocal interrupted
        interrupted = signum

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    report(f"supervisor_pid={os.getpid()} state=starting timeout_seconds={timeout:g}")
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, start_new_session=True)
    except OSError as error:
        report(f"result=launch-failed error={error}")
        return 1
    report(f"child_pid={child.pid} state=running")
    deadline = time.monotonic() + timeout
    try:
        while child.poll() is None:
            if interrupted:
                report(f"result=interrupted signal={interrupted}")
                return 128 + interrupted
            if time.monotonic() >= deadline:
                report("result=timed-out")
                return 124
            time.sleep(0.05)
        report(f"result=command-exited exit_code={child.returncode}")
        return child.returncode if child.returncode >= 0 else 128 - child.returncode
    finally:
        retire(child)
        report("state=retired")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    command = arguments.command
    if command and command[0] == "--":
        command = command[1:]
    if not command or not 0 < arguments.timeout <= 300:
        parser.error("provide a command and a timeout greater than zero, at most 300 seconds")
    return run(command, arguments.timeout)


if __name__ == "__main__":
    raise SystemExit(main())
