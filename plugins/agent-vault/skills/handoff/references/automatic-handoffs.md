# Automatic handoffs

Read this when investigating an automatically created handoff or a missing capture.
Ordinary writing and resumption use the [handoff skill](../SKILL.md).

## Before compaction

The plugin registers `bin/hook-precompact-handoff.sh` in its Claude Code manifest
and Codex `hooks.json`. The wrapper runs a read-only `codex exec` over only the
newest 512 KiB of transcript, treated as untrusted evidence. The model returns
structured handoff content or an explicit skip; the wrapper validates and renders
it before mutation, publishes without overwriting an existing target, marks selected
prior handoffs spent (never the new record itself), and commits the changed files.

This runs synchronously before compaction. It depends on a tracked project, a
readable transcript, `jq`, `python3`, `codex` on PATH, and the host emitting the
event. An existing target filename also causes a skip. Interruption cancels and
reaps the owned analysis process. Missing capture is not evidence that there was
no unfinished work. Inspect the actual record and diagnostics before
claiming success.

Timing, subprocess errors, and dispositions are retained under
`${TMPDIR:-/tmp}/agent-vault-cache/precompact-*.log`. `AGENT_VAULT_HANDOFF_MODEL` selects
the analysis model when set. Inspect only diagnostics relevant to the requested
session; do not invoke the hook simply to find out what it would write.

## At session end

`bin/hook-sessionend-capture.sh` starts a detached capture writer that reads the ended
session's transcript and follows journal guidance, plus handoff guidance when work
remains unfinished. It supplies the original session ID, project, dates, and output
paths. Those values identify the captured work; the writer's own runtime identity
and shared SessionStart cache do not replace them.

The detached writer is supervised for at most 300 seconds. Its output, supervisor
and child PIDs, and exit/timeout/cancellation results are retained under
`${TMPDIR:-/tmp}/agent-vault-cache/sessionend-*.log`. To cancel an active capture,
verify its supervisor PID against the relevant log and send that process `TERM`;
the supervisor terminates the writer's process group. `AGENT_VAULT_SESSIONEND_MODEL`
selects the writer model when set. A command exit is not proof of a vault write.

Both hooks skip an unavailable event working directory instead of falling back to
an inherited project. Both paths are best-effort and can skip when prerequisites
are absent. A hook
starting does not prove a record was written or committed. Deliberate handoffs
remain useful when ending unfinished work, and every resume still verifies the
record against current reality.
