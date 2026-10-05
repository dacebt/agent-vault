---
name: viewer
description: >-
  Start, inspect, stop, or foreground the bundled read-only Agent Vault Viewer. Use when the user
  asks to open, launch, run, check, or stop the local Agent Vault browser viewer or dashboard.
---

# agent-vault:viewer

Run the bundled loopback viewer through the plugin-owned lifecycle command. Do not recreate its
background-process, PID, health-check, or shutdown behavior with ad hoc shell commands.

## Resolve the launcher

Resolve the installed plugin root two levels above the directory containing this loaded
`SKILL.md`: `<plugin>/skills/viewer/SKILL.md` resolves to `<plugin>`. For example, with
`skill_file` set to the absolute path of this loaded file:

```sh
AGENT_VAULT_PLUGIN_ROOT="$(cd "$(dirname "$skill_file")/../.." && pwd)"
bash "${AGENT_VAULT_PLUGIN_ROOT}/bin/viewer.sh" <operation>
```

Do not assume a development-checkout path or depend on the current working directory.

## Choose the operation

- For "open", "launch", "start", "run in the background", or an unqualified request to view the
  vault, use `session` in a long-running terminal tool call that yields an ongoing session ID. Keep
  that terminal session alive after the launcher reports healthy. Detached child processes may be
  reaped when an agent shell call ends, so do not use `start` from a transient agent shell.
- For a status check, use `status`.
- For an explicit shutdown request, use `stop`.
- Use `run` only when the user explicitly requests an attached foreground process.

`start` is the direct background command for a person running the launcher from their own terminal.

Own an agent-started terminal session through output collection and verified shutdown. Before
ending your turn, use `stop`, collect the terminal's exit, and verify `status`, unless the user
explicitly requested that the viewer stay running beyond the session. For that requested lifetime,
hand off its terminal session ID, PID, URL, vault root, log path, and exact `status`/`stop` commands.
If no persistent terminal tool is available, report that limitation rather than launching detached.

The launcher defaults to `AGENT_VAULT` or `~/agent-vault` and port `7373`. Preserve user-provided
`AGENT_VAULT`, `PORT`, and `AGENT_VAULT_VIEWER_STATE_DIR` values.

If starting `session` requires an elevated process or loopback permission context, use that same
context for later `status` and `stop` operations. A more restricted shell may be unable to verify or
signal the live process and must not be treated as evidence that it stopped.

## Report the result

After `session`, `start`, or `status`, report the exact URL, PID, vault root, and log path emitted by
the launcher. After `stop`, report that it stopped and include the emitted log path. Do not open or
control a browser unless the user asks.

If the launcher reports that a recorded PID does not match its viewer server or ownership cannot
be verified, stop and surface the ownership conflict. Never kill, replace, or claim that process
manually. The viewer binds only to loopback and reads task databases in read-only mode.
