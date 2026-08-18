import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ProjectDatabaseError,
  REQUIRED_TASK_COLUMNS,
  normalizeBoardTask,
  normalizeTask,
  taskIdentifier,
  validateTaskRow,
} from './task-record.mjs';

const DATABASE_FILE = 'tasks.sqlite3';
const EXPECTED_SCHEMA_VERSION = 1;
const BOARD_STATUSES = ['backlog', 'todo', 'in-progress', 'done'];
const REQUIRED_VAULT_METADATA_COLUMNS = ['key', 'value'];

const PROJECT_COUNT_SQL = `
  SELECT task_status, COUNT(*) AS total
  FROM tasks
  GROUP BY task_status
`;

const PROJECT_BOARD_SQL = `
  SELECT
    id,
    task_key,
    title,
    description,
    task_status,
    priority,
    tags_json,
    generated_at,
    created_at,
    started_at,
    completed_at
  FROM tasks
  ORDER BY
    CASE task_status
      WHEN 'backlog' THEN 0
      WHEN 'todo' THEN 1
      WHEN 'in-progress' THEN 2
      WHEN 'blocked' THEN 3
      ELSE 4
    END,
    CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END,
    sort_order,
    generated_at DESC
`;

const PROJECT_TASK_SQL = `
  SELECT
    id,
    task_key,
    title,
    description,
    okf_status,
    task_status,
    priority,
    body_markdown,
    tags_json,
    sources_json,
    verified_json,
    extensions_json,
    generated_at,
    created_at,
    started_at,
    completed_at
  FROM tasks
  WHERE id = ?
`;

const PROJECT_GRAPH_TASKS_SQL = `
  SELECT
    id,
    title,
    body_markdown
  FROM tasks
  ORDER BY id
`;

export { ProjectDatabaseError, taskIdentifier };

function containsPath(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function firstValue(row) {
  return Object.values(row)[0];
}

function requireTable(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  if (!row) {
    throw new ProjectDatabaseError('missing-table', `required table missing: ${tableName}`);
  }
}

function requireColumns(db, tableName, requiredColumns) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columns = new Set(rows.map((row) => row.name));
  for (const column of requiredColumns) {
    if (!columns.has(column)) {
      throw new ProjectDatabaseError(
        'missing-column',
        `required column missing: ${tableName}.${column}`,
      );
    }
  }
}

function openProjectDatabase(project) {
  const candidate = path.join(project.tasksDir, DATABASE_FILE);
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ProjectDatabaseError(
        'missing-database',
        `task database not found: ${candidate}`,
      );
    }
    throw new ProjectDatabaseError('open-database', `could not inspect task database: ${candidate}`);
  }

  let databasePath;
  try {
    databasePath = fs.realpathSync(candidate);
  } catch (error) {
    throw new ProjectDatabaseError(
      'invalid-database-path',
      `task database could not be canonicalized: ${candidate}`,
    );
  }

  if (!containsPath(project.tasksDir, databasePath)) {
    throw new ProjectDatabaseError(
      'invalid-database-path',
      `task database escapes tasks directory: ${databasePath}`,
    );
  }

  const databaseStats = stats.isSymbolicLink() ? fs.statSync(databasePath) : stats;
  if (!databaseStats.isFile()) {
    throw new ProjectDatabaseError(
      'invalid-database-path',
      `task database is not a regular file: ${databasePath}`,
    );
  }

  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    throw new ProjectDatabaseError(
      'open-database',
      `unable to open task database: ${databasePath}`,
    );
  }

  try {
    validateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    if (error instanceof ProjectDatabaseError) throw error;
    throw new ProjectDatabaseError(
      'open-database',
      `unable to read task database: ${databasePath}`,
    );
  }
}

function validateDatabase(db) {
  const version = firstValue(db.prepare('PRAGMA user_version').get());
  if (version !== EXPECTED_SCHEMA_VERSION) {
    throw new ProjectDatabaseError(
      'unsupported-schema-version',
      `unsupported schema version: ${version}; expected ${EXPECTED_SCHEMA_VERSION}`,
    );
  }

  const integrity = firstValue(db.prepare('PRAGMA integrity_check').get());
  if (integrity !== 'ok') {
    throw new ProjectDatabaseError('integrity-check', `integrity_check failed: ${integrity}`);
  }

  requireTable(db, 'vault_metadata');
  requireTable(db, 'tasks');
  requireColumns(db, 'vault_metadata', REQUIRED_VAULT_METADATA_COLUMNS);
  requireColumns(db, 'tasks', REQUIRED_TASK_COLUMNS);

  const rows = db.prepare(
    `
      SELECT
        id,
        title,
        okf_status,
        task_status,
        tags_json,
        sources_json,
        verified_json,
        extensions_json
      FROM tasks
    `,
  ).all();
  for (const row of rows) {
    validateTaskRow(row);
  }
}

function withProjectDatabase(project, callback) {
  const db = openProjectDatabase(project);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function projectCounts(project) {
  return withProjectDatabase(project, (db) => {
    const counts = Object.fromEntries(BOARD_STATUSES.map((status) => [status, 0]));
    const rows = db.prepare(PROJECT_COUNT_SQL).all();
    for (const row of rows) {
      if (row.task_status === 'blocked') {
        counts['in-progress'] += row.total;
      } else if (row.task_status in counts) {
        counts[row.task_status] += row.total;
      }
    }
    return counts;
  });
}

export function projectBoard(project) {
  return withProjectDatabase(project, (db) => {
    const columns = new Map(BOARD_STATUSES.map((status) => [status, { status, tasks: [] }]));
    const rows = db.prepare(PROJECT_BOARD_SQL).all();
    for (const row of rows) {
      const task = normalizeBoardTask(row);
      const column = row.task_status === 'blocked' ? 'in-progress' : row.task_status;
      columns.get(column).tasks.push(task);
    }
    return BOARD_STATUSES.map((status) => columns.get(status));
  });
}

export function projectTask(project, requestedId) {
  const id = taskIdentifier(requestedId);
  if (!id) return null;

  return withProjectDatabase(project, (db) => {
    const row = db.prepare(PROJECT_TASK_SQL).get(id);
    if (!row) return undefined;
    return normalizeTask(row);
  });
}

export function projectTasks(project) {
  return withProjectDatabase(project, (db) =>
    db.prepare(PROJECT_GRAPH_TASKS_SQL).all().map((row) => {
      const id = row.id;
      return {
        id,
        uri: `task:${id}`,
        title: row.title,
        markdown: row.body_markdown,
      };
    }),
  );
}
