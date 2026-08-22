# Agent Vault Viewer

This directory contains the dependency-free local viewer bundled with the Agent Vault plugin. It serves the project bundles under `~/agent-vault` by default, reads SQLite task concepts without mutation, renders task boards, linked Markdown, concept graphs, and physical file trees, refreshes through filesystem events, and listens only on `127.0.0.1`.

The runtime is mirrored from the standalone `ebt-vault-viewer` repository. The imported baseline is upstream commit `519d7a1`; viewer work lands and is verified there first, then is adapted to the `AGENT_VAULT` namespace and mirrored here.

## Run

From the plugin root:

```sh
bin/viewer.sh start
bin/viewer.sh status
bin/viewer.sh stop
```

Use `bin/viewer.sh run` for a foreground process. Set `AGENT_VAULT` to an absolute vault-root path or `PORT` to another loopback port before invoking the command. Node.js 22.13 or newer is required; `marked` is vendored, so there is no package install or build step.

Agents use `bin/viewer.sh session` in a persistent terminal-tool session so the host does not reap
the server when a transient command finishes. People running the command in their own terminal can
use `start` for an ordinary detached process.

## Source layout

- `server.mjs` is the loopback HTTP entrypoint and static-asset allowlist.
- `src/server/` owns read-only SQLite, Markdown, path-containment, and graph projection.
- `public/` contains the vanilla browser application, including the board, graph, reader, and file explorer.
- `vendor/marked.min.js` is the browser/server Markdown parser.
- `test/` contains Node tests over storage, API, graph, and refresh behavior.
