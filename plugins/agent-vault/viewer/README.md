# Agent Vault Viewer

Agent Vault Viewer is a local, read-only viewer for an Agent Vault. It discovers projects that own `tasks/tasks.sqlite3`, presents their task board, concept graph, and physical file tree, opens Markdown documents and task records, and refreshes through filesystem watching and server-sent events.

The viewer is adapted from the integrated development source at `ebt-agent-skills/plugins/ebt-vault/viewer/`, including the accepted EBT integration at `3e75fd6`. Viewer changes land and are verified there first, then are mirrored here with Agent Vault branding and namespaces. The former standalone `ebt-vault-viewer` checkout is no longer the development source.

The viewer is a plain Node server with a vanilla HTML/CSS/JavaScript frontend. Its browser dependency, `marked`, is vendored under `vendor/`; there is no package install or build step.

## Source layout

The root stays small and operational: `server.mjs` is the direct-run HTTP composition entrypoint, while `.wsd/`, `fixtures/`, and `test/` hold verification configuration, legacy fixture assets, and disposable fixture helpers.

- `src/server/` owns vault-side projection. `task-database.mjs` validates and reads the SQLite task database, `vault-store.mjs` composes project discovery plus contained file and Markdown access, and `graph-data.mjs` turns Markdown concepts and links into graph data.
- `public/index.html` declares the browser composition and the dependency order for classic scripts and styles.
- `public/scripts/app.js` coordinates project loading and Board/Graph/Files views. `selection.js`, `project-picker.js`, `reader.js`, and `file-explorer.js` own URL selection, picker interaction, Markdown reading, and the file layouts; `public/scripts/graph/` contains the focused graph layout, interaction, viewport, label, and rendering modules.
- `public/styles/` separates shell, board, reader, graph, file-explorer, and final-loaded cross-cutting utility rules.
- `vendor/marked.min.js` is shared by the browser reader and the server graph lexer.

Browser assets are intentionally allowlisted in `server.mjs`. When adding or moving one, keep that allowlist synchronized with the stylesheet and classic-script registrations in `public/index.html`; script order is part of the runtime contract.

## Run

From this viewer directory, run:

```sh
node server.mjs
```

Open <http://127.0.0.1:7373>.

By default, the server reads `~/agent-vault`. Override the vault root or port when needed:

```sh
AGENT_VAULT=/path/to/agent-vault PORT=8484 node server.mjs
```

The server listens on `127.0.0.1` only and does not provide task mutation endpoints.

For managed start, status, and stop operations, use the plugin's [viewer launcher](../bin/viewer.sh) through the [viewer skill](../skills/viewer/SKILL.md). Each server instance generates a UUID. The health response includes that identity and the serving process ID so the launcher can verify the exact instance before claiming or signaling it.

## Verify

The SQLite verification path uses the containing plugin's real disposable migrator fixture. Run this from the viewer directory:

```sh
PORT=7400 node .wsd/run-sqlite-fixture-server.mjs
```

That helper creates a fresh temporary vault root, runs `../tests/build-viewer-sqlite-fixture.py`, starts `server.mjs` against it, and removes the temporary root on normal termination or startup failure. `.wsd/skeleton.json` points to the same helper on port 7399.

Run the Node behavior tests with `node --test test/*.test.mjs`. They use disposable vault roots; live refresh and lifecycle tests require loopback listening permission.

This checks the body directly:

```sh
curl 'http://127.0.0.1:7400/api/board?project=viewer-sqlite-fixture'
```

The response reports backlog `1`, todo `1`, in-progress `2`, and done `1`, with the blocked task grouped into the in-progress column. The fixture helper also prints a JSON `migration.tasks` array with the real migrated `id` and `uri` for each task; use one of those emitted UUIDs or `task:<uuid>` URIs when probing `/api/task`. `/api/projects` reports structured database errors for known projects whose `tasks/tasks.sqlite3` is missing, corrupt, escaped, or unsupported.

For a browser check, open <http://127.0.0.1:7400>. Selection lives in the URL as `?project=`, so it is per-window rather than remembered per machine. Select `viewer-sqlite-fixture`, confirm the blocked card appears inside the in-progress column, and open VIEW-001 through the board.

`fixtures/vault/` remains in the repository only as legacy Markdown/document containment test coverage. It is not a truthful SQLite runtime fixture and should not be used to validate the current board/task behavior.
