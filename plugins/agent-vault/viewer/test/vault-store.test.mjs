import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ProjectDatabaseError } from '../src/server/task-database.mjs';
import { createVaultStore } from '../src/server/vault-store.mjs';
import {
  FIXTURE_TASKS,
  createMissingColumnDatabase,
  createProject,
  createSqliteDatabase,
  createValidSqliteProject,
  temporaryDirectory,
} from './sqlite-fixture.mjs';

function projectEntry(projects, name) {
  return projects.find((project) => project.name === name);
}

function expectDatabaseError(projects, name, code) {
  const project = projectEntry(projects, name);
  assert.ok(project, `missing project entry for ${name}`);
  assert.equal(project.counts, null);
  assert.deepEqual(project.error?.kind, 'database');
  assert.equal(project.error?.code, code);
}

test('projects, board, task reads, and markdown containment follow the SQLite contract', (t) => {
  const { dbPath, projectDir, projectName, vaultRoot } = createValidSqliteProject(t);
  fs.chmodSync(dbPath, 0o444);
  const uppercaseMarkdownPath = path.join(projectDir, 'knowledge', 'UPPER.MD');
  fs.writeFileSync(uppercaseMarkdownPath, '# Uppercase Markdown\n');
  const outsideFile = path.join(vaultRoot, 'outside.txt');
  fs.writeFileSync(outsideFile, 'outside');
  fs.symlinkSync(outsideFile, path.join(projectDir, 'escaped.txt'));

  const store = createVaultStore(vaultRoot);
  assert.equal(store.isUsable(), true);
  assert.deepEqual(store.projects(), [
    {
      name: projectName,
      counts: { backlog: 1, todo: 1, 'in-progress': 2, done: 1 },
    },
  ]);

  const board = store.board(projectName);
  assert.deepEqual(
    board.map((column) => [column.status, column.tasks.length]),
    [
      ['backlog', 1],
      ['todo', 1],
      ['in-progress', 2],
      ['done', 1],
    ],
  );
  assert.equal(board[2].tasks[1].blocked, true);
  assert.equal(board[2].tasks[1].status, 'blocked');
  assert.equal(board[2].tasks[1].uri, `task:${FIXTURE_TASKS[3].id}`);

  const backlogTask = store.task(projectName, FIXTURE_TASKS[0].id);
  assert.equal(backlogTask.uri, `task:${FIXTURE_TASKS[0].id}`);
  assert.equal(backlogTask.key, 'VIEW-001');
  assert.equal(backlogTask.title, 'VIEW-001: Backlog task');
  assert.deepEqual(backlogTask.tags, ['viewer', 'sqlite']);
  assert.equal(backlogTask.markdown.includes('Backlog task'), true);

  const sameTask = store.task(projectName, `task:${FIXTURE_TASKS[0].id}`);
  assert.equal(sameTask.id, backlogTask.id);
  assert.equal(store.task(projectName, 'not-a-task-id'), null);
  assert.equal(store.task(projectName, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), undefined);

  const documentPath = 'knowledge/context.md';
  assert.equal(
    store.resolvePath(projectName, documentPath),
    fs.realpathSync(path.join(projectDir, documentPath)),
  );
  assert.match(store.document(projectName, documentPath).markdown, /Viewer context/);
  assert.match(store.document(projectName, 'knowledge/UPPER.MD').markdown, /Uppercase Markdown/);
  assert.equal(store.resolvePath(projectName, '../outside.md'), null);
  assert.equal(store.resolvePath(projectName, '..\\outside.md'), null);
  assert.equal(
    store.resolvePath(projectName, 'artifacts/preview.svg'),
    fs.realpathSync(path.join(projectDir, 'artifacts', 'preview.svg')),
  );

  const files = store.files(projectName);
  assert.deepEqual(files.map((entry) => [entry.kind, entry.name]), [
    ['directory', 'artifacts'],
    ['directory', 'knowledge'],
    ['directory', 'tasks'],
    ['directory', 'views'],
    ['file', 'index.md'],
  ]);
  assert.deepEqual(files.find((entry) => entry.name === 'views')?.children, [
    {
      kind: 'file',
      name: 'ignored.md',
      path: '/views/ignored.md',
      size: fs.statSync(path.join(projectDir, 'views', 'ignored.md')).size,
    },
  ]);
  assert.equal(files.some((entry) => entry.name === '.hidden'), false);
  assert.equal(files.some((entry) => entry.name === 'escaped.txt'), false);
});

test('database validation failures surface as structured project errors', (t) => {
  const root = temporaryDirectory(t);
  const vaultRoot = path.join(root, 'vault');
  fs.mkdirSync(vaultRoot);

  createProject(vaultRoot, 'missing-db');

  const wrongVersionDir = createProject(vaultRoot, 'wrong-version');
  createSqliteDatabase(path.join(wrongVersionDir, 'tasks', 'tasks.sqlite3'), { userVersion: 2 });

  const missingColumnDir = createProject(vaultRoot, 'missing-column');
  createMissingColumnDatabase(path.join(missingColumnDir, 'tasks', 'tasks.sqlite3'));

  const invalidJsonDir = createProject(vaultRoot, 'invalid-json');
  createSqliteDatabase(path.join(invalidJsonDir, 'tasks', 'tasks.sqlite3'), {
    tasks: [{ ...FIXTURE_TASKS[0], tags: { bad: true } }],
  });

  const invalidTitleDir = createProject(vaultRoot, 'invalid-title');
  createSqliteDatabase(path.join(invalidTitleDir, 'tasks', 'tasks.sqlite3'), {
    tasks: [{ ...FIXTURE_TASKS[0], title: '  VIEW-001: Backlog task  ' }],
  });

  const invalidIdDir = createProject(vaultRoot, 'invalid-id');
  createSqliteDatabase(path.join(invalidIdDir, 'tasks', 'tasks.sqlite3'), {
    tasks: [{ ...FIXTURE_TASKS[0], id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }],
  });

  const corruptDir = createProject(vaultRoot, 'corrupt');
  fs.writeFileSync(path.join(corruptDir, 'tasks', 'tasks.sqlite3'), 'not a sqlite database');

  const escapedDir = createProject(vaultRoot, 'escaped-db');
  const outsideDb = path.join(root, 'outside.sqlite3');
  createSqliteDatabase(outsideDb);
  fs.symlinkSync(outsideDb, path.join(escapedDir, 'tasks', 'tasks.sqlite3'));

  const store = createVaultStore(vaultRoot);
  const projects = store.projects();

  expectDatabaseError(projects, 'missing-db', 'missing-database');
  expectDatabaseError(projects, 'wrong-version', 'unsupported-schema-version');
  expectDatabaseError(projects, 'missing-column', 'missing-column');
  expectDatabaseError(projects, 'invalid-json', 'invalid-row');
  expectDatabaseError(projects, 'invalid-title', 'invalid-row');
  expectDatabaseError(projects, 'invalid-id', 'invalid-row');
  expectDatabaseError(projects, 'corrupt', 'open-database');
  expectDatabaseError(projects, 'escaped-db', 'invalid-database-path');

  assert.throws(
    () => store.board('missing-db'),
    (error) => error instanceof ProjectDatabaseError && error.code === 'missing-database',
  );
  assert.throws(
    () => store.board('wrong-version'),
    (error) =>
      error instanceof ProjectDatabaseError && error.code === 'unsupported-schema-version',
  );
  assert.throws(
    () => store.board('missing-column'),
    (error) => error instanceof ProjectDatabaseError && error.code === 'missing-column',
  );
  assert.throws(
    () => store.board('invalid-json'),
    (error) => error instanceof ProjectDatabaseError && error.code === 'invalid-row',
  );
  assert.throws(
    () => store.board('invalid-title'),
    (error) => error instanceof ProjectDatabaseError && error.code === 'invalid-row',
  );
  assert.throws(
    () => store.board('invalid-id'),
    (error) => error instanceof ProjectDatabaseError && error.code === 'invalid-row',
  );
  assert.throws(
    () => store.board('escaped-db'),
    (error) => error instanceof ProjectDatabaseError && error.code === 'invalid-database-path',
  );
});
