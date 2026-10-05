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
- `skills/` — ten project-memory and viewer-lifecycle skills.
- `bin/` — discovery, bootstrap, task, graph, hook, durability, validation, migration, and viewer lifecycle commands.
- `lib/` — SQLite task-store and hybrid graph implementation.
- `templates/` — OKF v0.2 project concepts.
- `reference/` — linking doctrine, SQLite schema, and task-consumer contract.
- `viewer/` — dependency-free read-only Node server and browser client adapted from `ebt-agent-skills/plugins/ebt-vault/viewer/`.
- `tests/` — OKF, task-store, migration, rollback, graph, bootstrap, startup, commit-link, wrap-up, continuity, and viewer coverage.

## Hook lifecycle

| Event | Behavior |
|---|---|
| `SessionStart` | Inject a read-only resource map, recent journal excerpt, and up to three live handoff references; retain the per-repository session ID for later attribution. |
| `PostToolUse` | Verify explicit commit receipts, link the most recently touched in-progress or blocked task, and verify database durability. |
| `UserPromptSubmit` | Add a wrap-up reminder when the user explicitly ends a session. |
| `PreCompact` | Validate read-only analysis, publish without overwriting, supersede selected related handoffs, and commit; retire analysis on completion or cancellation. |
| `SessionEnd` | Supervise a detached journal/handoff writer with a 300-second deadline, diagnostics, cancellation, and process-group retirement. |

PreCompact gives a read-only `codex exec` only the newest 512 KiB of transcript at low reasoning and verbosity. The shell wrapper validates its structured result, then renders, supersedes, and commits the handoff while retaining diagnostics under `${TMPDIR:-/tmp}/agent-vault-cache/precompact-*.log`. SessionEnd records supervisor and child PIDs and exit results in `sessionend-*.log` in the same cache. Both skip missing prerequisites or an unavailable event working directory. Starting capture does not prove a record was written or committed; inspect records and diagnostics. See [automatic handoffs](skills/handoff/references/automatic-handoffs.md) for cancellation and original-session attribution.

## Skills

`bootstrap`, `capture`, `groom`, `handoff`, `journal`, `orient`, `recall`, `refresh`, `viewer`, and `weave` are discovered from `skills/`. Installed skill commands resolve their scripts, templates, references, and viewer runtime from the loaded Agent Vault plugin root; they do not depend on this repository’s checkout path.

The `viewer` skill delegates background ownership to `bin/viewer.sh`. It keeps an agent-started server inside a persistent terminal session, reports its exact URL and state, refuses PID ownership conflicts, and stops only the process it verifies as its own. People invoking the launcher in their own terminal can use its detached `start` operation directly.

## Storage contract

Markdown concepts and SQLite task concepts share one graph. File concepts use bundle-relative Markdown links; task concepts use immutable `task:<uuid>` links. See [the SQLite task contract](reference/sqlite-task-contract.md) and [linking doctrine](reference/linking.md).

Manual operations use scaffold-only bootstrap, consolidated capture for decisions and task content, and [direct task commands](reference/task-commands.md) without transition or WIP prerequisites. Orientation is read-only; handoff writing and explicit lifecycle actions preserve the unit’s actual state and verify durability.

The development authority for both plugin and viewer is `ebt-agent-skills/plugins/ebt-vault`. This package adapts the accepted plugin source through `8601ca9` to Agent Vault namespaces; the bundled viewer remains the import accepted at `3e75fd6`. Release versions remain independently owned.

## Verification

From the repository root:

```sh
bash plugins/agent-vault/tests/okf-v02.sh
python3 plugins/agent-vault/tests/graph-audit.test.py
python3 plugins/agent-vault/tests/task-store.test.py
python3 plugins/agent-vault/tests/task-migration.test.py
python3 plugins/agent-vault/tests/session-start.test.py
python3 plugins/agent-vault/tests/commit-link-hook.test.py
python3 plugins/agent-vault/tests/wrapup-hook.test.py
python3 plugins/agent-vault/tests/precompact-hook.test.py
python3 plugins/agent-vault/tests/sessionend-hook.test.py
python3 plugins/agent-vault/tests/viewer-launcher.test.py
node --test plugins/agent-vault/viewer/test/*.test.mjs
```
