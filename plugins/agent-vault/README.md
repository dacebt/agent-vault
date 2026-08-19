# Agent Vault plugin package

This directory is the installable `agent-vault` plugin exposed by the repository’s Claude Code and Codex marketplaces. The repository-level [README](../../README.md) contains installation instructions, the complete feature overview, requirements, data layout, and provenance.

## Runtime identity

- Plugin name: `agent-vault`
- Default containing root: `~/agent-vault`
- Root override: `AGENT_VAULT=/absolute/path`
- Skill namespace: `agent-vault:*`
- Hook cache: `${TMPDIR:-/tmp}/agent-vault-cache`

Each direct child of the containing root is an independent project bundle selected from the current Git root basename. Sessions outside a bootstrapped bundle silently receive no plugin behavior.

## Bundled surfaces

- `.claude-plugin/plugin.json` — Claude Code manifest with inline lifecycle hooks.
- `.codex-plugin/plugin.json` — Codex manifest with skills and hook configuration paths.
- `hooks.json` — Codex lifecycle hooks using `${PLUGIN_ROOT}`.
- `skills/` — thirteen project-memory and viewer-lifecycle skills.
- `bin/` — discovery, bootstrap, task, graph, hook, durability, validation, migration, and viewer lifecycle commands.
- `lib/` — SQLite task-store and hybrid graph implementation.
- `templates/` — OKF v0.2 project concepts.
- `reference/` — linking doctrine, SQLite schema, and task-consumer contract.
- `viewer/` — dependency-free read-only Node server and browser client mirrored from `ebt-vault-viewer`.
- `tests/` — OKF, task-store, migration, rollback, graph, bootstrap, and commit-link coverage.

## Hook lifecycle

| Event | Behavior |
|---|---|
| `SessionStart` | Inject a compact project orientation and prime the per-repository session/HEAD cache. |
| `PostToolUse` | Link a newly created Git commit to the most recently touched active task. |
| `UserPromptSubmit` | Add a wrap-up reminder when the user explicitly ends a session. |
| `PreCompact` | Synchronously reconstruct unfinished work and write a handoff. |
| `SessionEnd` | Detach a transcript capture that journals substantive work and writes a handoff only when needed. |

PreCompact and SessionEnd use a sandboxed `codex exec` subprocess with approvals and network access disabled. They silently no-op when Codex, `jq`, a readable transcript, or a tracked project is unavailable.

## Skills

`bootstrap`, `capture`, `decide`, `groom`, `handoff`, `journal`, `orient`, `recall`, `refresh`, `render`, `task-flow`, `viewer`, and `weave` are discovered from `skills/`. Installed skill commands resolve their scripts, templates, references, and viewer runtime from the loaded Agent Vault plugin root; they do not depend on this repository’s checkout path.

The `viewer` skill delegates background ownership to `bin/viewer.sh`. It keeps an agent-started server inside a persistent terminal session, reports its exact URL and state, refuses PID ownership conflicts, and stops only the process it verifies as its own. People invoking the launcher in their own terminal can use its detached `start` operation directly.

## Storage contract

Markdown concepts and SQLite task concepts share one graph. File concepts use bundle-relative Markdown links; task concepts use immutable `task:<uuid>` links. See [the SQLite task contract](reference/sqlite-task-contract.md) and [linking doctrine](reference/linking.md).

## Verification

From the repository root:

```sh
bash plugins/agent-vault/tests/okf-v02.sh
python3 plugins/agent-vault/tests/graph-audit.test.py
python3 plugins/agent-vault/tests/task-store.test.py
python3 plugins/agent-vault/tests/task-migration.test.py
python3 plugins/agent-vault/tests/viewer-launcher.test.py
node --test plugins/agent-vault/viewer/test/*.test.mjs
```
