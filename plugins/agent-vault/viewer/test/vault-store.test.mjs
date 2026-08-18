import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createViewerServer } from '../server.mjs';
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

async function withServer(t, vaultRoot, callback) {
  const viewer = createViewerServer({ vault: vaultRoot, port: 0 });
  t.after(() => viewer.server.emit('close'));
  const handler = viewer.server.listeners('request')[0];
  return callback(async (pathname) => {
    const chunks = [];
    return new Promise((resolve, reject) => {
      const req = {
        url: pathname,
        on() {},
      };
      const res = {
        headers: {},
        headersSent: false,
        statusCode: 200,
        writeHead(code, headers) {
          this.statusCode = code;
          this.headers = headers;
          this.headersSent = true;
        },
        write(chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        },
        end(chunk = '') {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          resolve({
            status: this.statusCode,
            headers: this.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        },
      };

      try {
        handler(req, res);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function getJson(request, pathname) {
  const response = await request(pathname);
  return { status: response.status, json: JSON.parse(response.body) };
}

test('projects, board, task reads, and markdown containment follow the SQLite contract', (t) => {
  const { dbPath, projectDir, projectName, vaultRoot } = createValidSqliteProject(t);
  fs.chmodSync(dbPath, 0o444);

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
  assert.equal(store.resolvePath(projectName, '../outside.md'), null);
  assert.equal(store.resolvePath(projectName, '..\\outside.md'), null);
  assert.equal(
    store.resolvePath(projectName, 'artifacts/preview.svg'),
    fs.realpathSync(path.join(projectDir, 'artifacts', 'preview.svg')),
  );
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

test('HTTP endpoints preserve status contracts for valid, malformed, absent, and broken databases', async (t) => {
  const { projectDir, projectName, vaultRoot } = createValidSqliteProject(t);
  createProject(vaultRoot, 'missing-db');
  const invalidTitleDir = createProject(vaultRoot, 'invalid-title');
  createSqliteDatabase(path.join(invalidTitleDir, 'tasks', 'tasks.sqlite3'), {
    tasks: [{ ...FIXTURE_TASKS[0], title: '  VIEW-001: Backlog task  ' }],
  });
  const invalidIdDir = createProject(vaultRoot, 'invalid-id');
  createSqliteDatabase(path.join(invalidIdDir, 'tasks', 'tasks.sqlite3'), {
    tasks: [{ ...FIXTURE_TASKS[0], id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }],
  });

  await withServer(t, vaultRoot, async (request) => {
    const projects = await getJson(request, '/api/projects');
    assert.equal(projects.status, 200);
    assert.deepEqual(projectEntry(projects.json.projects, projectName), {
      name: projectName,
      counts: { backlog: 1, todo: 1, 'in-progress': 2, done: 1 },
    });
    expectDatabaseError(projects.json.projects, 'missing-db', 'missing-database');
    expectDatabaseError(projects.json.projects, 'invalid-title', 'invalid-row');
    expectDatabaseError(projects.json.projects, 'invalid-id', 'invalid-row');

    const board = await getJson(request, `/api/board?project=${projectName}`);
    assert.equal(board.status, 200);
    assert.equal(board.json.statuses[2].status, 'in-progress');
    assert.equal(board.json.statuses[2].tasks[1].blocked, true);

    const boardFailure = await getJson(request, '/api/board?project=missing-db');
    assert.equal(boardFailure.status, 422);
    assert.equal(boardFailure.json.error.kind, 'database');
    assert.equal(boardFailure.json.error.code, 'missing-database');

    const graph = await getJson(request, `/api/graph?project=${projectName}`);
    assert.equal(graph.status, 200);
    assert.equal(graph.json.nodes.length, 8);
    assert.equal(graph.json.edges.length > 0, true);
    assert.deepEqual(graph.json.errors, []);

    const graphFailure = await getJson(request, '/api/graph?project=missing-db');
    assert.equal(graphFailure.status, 422);
    assert.equal(graphFailure.json.error.kind, 'database');
    assert.equal(graphFailure.json.error.code, 'missing-database');

    const invalidTitleGraph = await getJson(request, '/api/graph?project=invalid-title');
    assert.equal(invalidTitleGraph.status, 422);
    assert.equal(invalidTitleGraph.json.error.kind, 'database');
    assert.equal(invalidTitleGraph.json.error.code, 'invalid-row');

    const invalidIdGraph = await getJson(request, '/api/graph?project=invalid-id');
    assert.equal(invalidIdGraph.status, 422);
    assert.equal(invalidIdGraph.json.error.kind, 'database');
    assert.equal(invalidIdGraph.json.error.code, 'invalid-row');

    const unknownGraph = await getJson(request, '/api/graph?project=unknown');
    assert.equal(unknownGraph.status, 404);
    assert.equal(unknownGraph.json.error, 'unknown project');

    const task = await getJson(
      request,
      `/api/task?project=${projectName}&id=${FIXTURE_TASKS[0].id}`,
    );
    assert.equal(task.status, 200);
    assert.equal(task.json.uri, `task:${FIXTURE_TASKS[0].id}`);

    const taskByUri = await getJson(
      request,
      `/api/task?project=${projectName}&id=${encodeURIComponent(`task:${FIXTURE_TASKS[3].id}`)}`,
    );
    assert.equal(taskByUri.status, 200);
    assert.equal(taskByUri.json.status, 'blocked');

    const malformedTask = await getJson(request, `/api/task?project=${projectName}&id=bad-id`);
    assert.equal(malformedTask.status, 400);
    assert.equal(malformedTask.json.error, 'bad task id');

    const absentTask = await getJson(
      request,
      `/api/task?project=${projectName}&id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
    assert.equal(absentTask.status, 404);
    assert.equal(absentTask.json.error, 'not found');

    const missingDbTask = await getJson(
      request,
      `/api/task?project=missing-db&id=${FIXTURE_TASKS[0].id}`,
    );
    assert.equal(missingDbTask.status, 422);
    assert.equal(missingDbTask.json.error.code, 'missing-database');

    const unknownProject = await getJson(
      request,
      `/api/task?project=unknown&id=${FIXTURE_TASKS[0].id}`,
    );
    assert.equal(unknownProject.status, 404);
    assert.equal(unknownProject.json.error, 'unknown project');

    const doc = await getJson(
      request,
      `/api/doc?project=${projectName}&path=${encodeURIComponent('knowledge/context.md')}`,
    );
    assert.equal(doc.status, 200);
    assert.match(doc.json.markdown, /Viewer context/);

    const badDoc = await getJson(
      request,
      `/api/doc?project=${projectName}&path=${encodeURIComponent('../outside.md')}`,
    );
    assert.equal(badDoc.status, 400);
    assert.equal(badDoc.json.error, 'bad path');

    const raw = await request(`/raw/${projectName}/${encodeURIComponent('artifacts/preview.svg')}`);
    assert.equal(raw.status, 200);
    assert.match(raw.body, /<svg/);

    const rawTraversal = await getJson(request, `/raw/${projectName}/${encodeURIComponent('../secret.txt')}`);
    assert.equal(rawTraversal.status, 400);
    assert.equal(rawTraversal.json.error, 'bad path');

    assert.equal(fs.existsSync(path.join(projectDir, 'tasks', 'tasks.sqlite3')), true);
  });
});
