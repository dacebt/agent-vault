# SQLite task contract

Agent Vault stores task concepts in each project bundle at `tasks/tasks.sqlite3`. Markdown remains authoritative for every other OKF v0.2 concept. The two providers share one graph through bundle-relative Markdown links and immutable task URIs.

The containing root, normally `~/agent-vault`, is only a locator. Each direct child is an independently bootstrapped project bundle with its own database.

## Source of truth

- Schema: `task-schema.sql`
- Store semantics: `../lib/task_store.py`
- Hybrid graph semantics: `../lib/task_graph.py`
- Legacy Markdown migration: `../bin/migrate-task-markdown.py`
- Disposable integration fixture: `../tests/build-sqlite-fixture.py`

## Identity and schema

Task identity is the immutable URI `task:<uuid>`. `task_key` is a human-facing display key and is never graph identity. New tasks use UUIDv4; imported legacy tasks use deterministic UUIDv5.

The schema version is `PRAGMA user_version = 1`. Consumers must reject unknown versions instead of guessing. The `tasks` row is the complete task record. JSON-decode `tags_json`, `sources_json`, `verified_json`, and `extensions_json`, and render `body_markdown` as the task document body.

The legal workflow statuses are:

- `backlog`
- `todo`
- `in-progress`
- `blocked`
- `done`

Lifecycle and workflow are separate. `okf_status` carries OKF lifecycle state; `task_status` carries task workflow state. Consumers must also preserve `generated_at`, `created_at`, `started_at`, and `completed_at`.

## Graph projection

File concepts use bundle-absolute paths such as `/knowledge/example.md`. Task concepts use `task:<uuid>`. Links may cross providers in either direction:

```markdown
[the rollout decision](/docs/decisions/ADR-004-rollout.md)
[the implementation task](task:10c01b56-c287-42f4-b5f5-2a1afdcda020)
```

Graph consumers must parse task URIs from Markdown concepts and from task `body_markdown`, parse ordinary Markdown links from both providers, and report dangling task URIs rather than silently discarding them.

## Consumer requirements

Open the database read-only unless the caller is Agent Vault's canonical task command. Validate the file, schema version, required tables and columns, and SQLite integrity before projecting it. Use bound query parameters and close handles promptly.

A compatible board may group `blocked` tasks inside its in-progress column, but it must preserve an explicit blocked signal. Consumers must not manufacture Markdown paths for tasks or mutate task rows directly.

## Disposable fixture

Generate a fresh bundle for integration work instead of reading personal vault data:

```sh
fixture_root="$(mktemp -d)"
python3 tests/build-sqlite-fixture.py "$fixture_root/sqlite-fixture"
```

The fixture performs a real Markdown-to-SQLite migration. Its expected task projection is one backlog, one todo, two active tasks including one blocked task, and one done task. The mixed graph contains five task nodes, three Markdown nodes, and no dangling task URIs.
