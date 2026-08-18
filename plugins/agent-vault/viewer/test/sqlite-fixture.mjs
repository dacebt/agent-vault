import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;
PRAGMA user_version = 1;

CREATE TABLE vault_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL DEFAULT 'task',
  title TEXT NOT NULL,
  description TEXT,
  okf_status TEXT NOT NULL DEFAULT 'stable',
  task_status TEXT NOT NULL,
  priority TEXT,
  milestone TEXT,
  sort_order INTEGER,
  body_markdown TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  verified_json TEXT NOT NULL DEFAULT '[]',
  extensions_json TEXT NOT NULL DEFAULT '{}',
  generated_by TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
) STRICT;
`;

const INSERT_TASK_SQL = `
INSERT INTO tasks (
  id, task_key, type, title, description, okf_status, task_status, priority,
  milestone, sort_order, body_markdown, tags_json, sources_json, verified_json,
  extensions_json, generated_by, generated_at, created_at, started_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const FIXTURE_TASKS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    task_key: 'VIEW-001',
    title: 'VIEW-001: Backlog task',
    description: 'Visible in backlog.',
    task_status: 'backlog',
    body_markdown:
      '# VIEW-001: Backlog task\n\nSee [context](/knowledge/context.md) and [active task](task:33333333-3333-4333-8333-333333333333?view=graph).\n',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    task_key: 'VIEW-002',
    title: 'VIEW-002: Ready task',
    description: 'Visible in todo.',
    task_status: 'todo',
    body_markdown: '# VIEW-002: Ready task\n\nSee [task index](/tasks/index.md).\n',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    task_key: 'VIEW-003',
    title: 'VIEW-003: Active task',
    description: 'Visible in progress.',
    task_status: 'in-progress',
    started_at: '2026-08-02T10:00:00Z',
    body_markdown: '# VIEW-003: Active task\n',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    task_key: 'VIEW-004',
    title: 'VIEW-004: Blocked task',
    description: 'Visible as blocked.',
    task_status: 'blocked',
    started_at: '2026-08-03T10:00:00Z',
    body_markdown:
      '# VIEW-004: Blocked task\n\n## Blocked by\nFixture dependency.\n\nSee [active task](task:33333333-3333-4333-8333-333333333333#blocked-by).\n',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    task_key: 'VIEW-005',
    title: 'VIEW-005: Done task',
    description: 'Visible in done.',
    task_status: 'done',
    completed_at: '2026-08-05T10:00:00Z',
    body_markdown: '# VIEW-005: Done task\n',
  },
];

export function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function createProject(vaultRoot, name = 'project') {
  const projectDir = path.join(vaultRoot, name);
  fs.mkdirSync(path.join(projectDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'knowledge'), { recursive: true });
  return projectDir;
}

export function writeMarkdown(file, title, body = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntitle: ${title}\n---\n# ${title}\n\n${body}`, 'utf8');
}

export function writeRaw(file, contents = 'raw') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function withDatabase(file, callback) {
  const db = new DatabaseSync(file);
  try {
    callback(db);
  } finally {
    db.close();
  }
}

function insertTask(db, task) {
  const generatedAt = task.generated_at || '2026-08-01T12:00:00Z';
  const createdAt = task.created_at || generatedAt;
  db.prepare(INSERT_TASK_SQL).run(
    task.id,
    task.task_key,
    task.type || 'task',
    task.title,
    task.description || null,
    task.okf_status || 'stable',
    task.task_status,
    task.priority || 'p2',
    task.milestone || null,
    task.sort_order ?? null,
    task.body_markdown || '',
    JSON.stringify(task.tags || ['viewer', 'sqlite']),
    JSON.stringify(task.sources || []),
    JSON.stringify(task.verified || []),
    JSON.stringify(task.extensions || {}),
    task.generated_by || 'fixture:test',
    generatedAt,
    createdAt,
    task.started_at || null,
    task.completed_at || null,
  );
}

export function createSqliteDatabase(dbPath, options = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  withDatabase(dbPath, (db) => {
    db.exec(options.schemaSql || SCHEMA_SQL);
    if (options.userVersion !== undefined) {
      db.exec(`PRAGMA user_version = ${Number(options.userVersion)}`);
    }
    db.prepare("INSERT INTO vault_metadata(key, value) VALUES ('project_name', ?)").run(
      options.projectName || path.basename(path.dirname(dbPath)),
    );
    for (const task of options.tasks || FIXTURE_TASKS) {
      insertTask(db, task);
    }
  });
}

export function createValidSqliteProject(t, options = {}) {
  const root = temporaryDirectory(t);
  const vaultRoot = path.join(root, 'vault');
  fs.mkdirSync(vaultRoot);
  const projectName = options.projectName || 'viewer-sqlite-fixture';
  const projectDir = createProject(vaultRoot, projectName);
  writeMarkdown(
    path.join(projectDir, 'index.md'),
    'Viewer home',
    '[Task board](/tasks/index.md)\n\n[Ready task](task:22222222-2222-4222-8222-222222222222#top)\n',
  );
  writeMarkdown(
    path.join(projectDir, 'knowledge', 'context.md'),
    'Viewer context',
    '[Backlog task](task:11111111-1111-4111-8111-111111111111)\n\n[Task board](../tasks/index.md)\n',
  );
  writeMarkdown(
    path.join(projectDir, 'tasks', 'index.md'),
    'Task index',
    '[Context](/knowledge/context.md)\n\n[Blocked task](task:44444444-4444-4444-8444-444444444444?from=index)\n',
  );
  writeMarkdown(path.join(projectDir, 'views', 'ignored.md'), 'Ignored view', '[Ready task](task:22222222-2222-4222-8222-222222222222)\n');
  writeMarkdown(path.join(projectDir, '.hidden', 'ignored.md'), 'Hidden note', '[Done task](task:55555555-5555-4555-8555-555555555555)\n');
  writeRaw(path.join(projectDir, 'artifacts', 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const dbPath = path.join(projectDir, 'tasks', 'tasks.sqlite3');
  createSqliteDatabase(dbPath, { ...options, projectName });
  return { dbPath, projectDir, projectName, vaultRoot };
}

export function createMissingColumnDatabase(dbPath) {
  const schemaSql = `
  PRAGMA user_version = 1;
  CREATE TABLE vault_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    task_key TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    okf_status TEXT NOT NULL,
    task_status TEXT NOT NULL,
    priority TEXT,
    milestone TEXT,
    sort_order INTEGER,
    body_markdown TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    verified_json TEXT NOT NULL,
    extensions_json TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT
  ) STRICT;
  `;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  withDatabase(dbPath, (db) => {
    db.exec(schemaSql);
    db.prepare("INSERT INTO vault_metadata(key, value) VALUES ('project_name', ?)").run(
      path.basename(path.dirname(dbPath)),
    );
    db.prepare(
      `
      INSERT INTO tasks (
        id, task_key, type, title, description, okf_status, task_status, priority,
        milestone, sort_order, body_markdown, tags_json, sources_json, verified_json,
        extensions_json, generated_by, generated_at, created_at, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      FIXTURE_TASKS[0].id,
      FIXTURE_TASKS[0].task_key,
      'task',
      FIXTURE_TASKS[0].title,
      FIXTURE_TASKS[0].description,
      'stable',
      FIXTURE_TASKS[0].task_status,
      'p2',
      null,
      null,
      FIXTURE_TASKS[0].body_markdown,
      JSON.stringify(['viewer', 'sqlite']),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({}),
      'fixture:test',
      '2026-08-01T12:00:00Z',
      '2026-08-01T12:00:00Z',
      null,
    );
  });
}
