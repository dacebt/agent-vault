PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS vault_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL DEFAULT 'task' CHECK (type = 'task'),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  okf_status TEXT NOT NULL DEFAULT 'stable'
    CHECK (okf_status IN ('draft', 'stable', 'deprecated')),
  task_status TEXT NOT NULL
    CHECK (task_status IN ('backlog', 'todo', 'in-progress', 'blocked', 'done')),
  priority TEXT,
  milestone TEXT,
  sort_order INTEGER,
  body_markdown TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  sources_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sources_json)),
  verified_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(verified_json)),
  extensions_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extensions_json)),
  generated_by TEXT NOT NULL CHECK (length(trim(generated_by)) > 0),
  generated_at TEXT NOT NULL CHECK (length(trim(generated_at)) > 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  started_at TEXT,
  completed_at TEXT,
  CHECK ((task_status = 'done' AND completed_at IS NOT NULL) OR
         (task_status <> 'done' AND completed_at IS NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS tasks_status_order
  ON tasks(task_status, sort_order, generated_at DESC);
