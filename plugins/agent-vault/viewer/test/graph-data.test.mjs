import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createVaultStore } from '../src/server/vault-store.mjs';
import {
  FIXTURE_TASKS,
  createProject,
  createSqliteDatabase,
  createValidSqliteProject,
  temporaryDirectory,
  writeMarkdown,
} from './sqlite-fixture.mjs';

function edge(graph, left, right) {
  const [source, target] = [left, right].sort();
  return graph.edges.find((candidate) => candidate.source === source && candidate.target === target);
}

test('graph projection mixes markdown and SQLite task nodes with deterministic IDs and weights', (t) => {
  const { projectName, vaultRoot } = createValidSqliteProject(t);
  const store = createVaultStore(vaultRoot);

  const graph = store.graph(projectName);

  assert.deepEqual(graph.nodes.map((node) => node.id), [
    '/index.md',
    '/knowledge/context.md',
    '/tasks/index.md',
    `task:${FIXTURE_TASKS[0].id}`,
    `task:${FIXTURE_TASKS[1].id}`,
    `task:${FIXTURE_TASKS[2].id}`,
    `task:${FIXTURE_TASKS[3].id}`,
    `task:${FIXTURE_TASKS[4].id}`,
  ]);
  assert.deepEqual(graph.nodes[0], {
    id: '/index.md',
    provider: 'markdown',
    type: 'document',
    title: 'Viewer home',
    resource: { kind: 'document', path: '/index.md' },
  });
  assert.deepEqual(
    graph.nodes.find((node) => node.id === `task:${FIXTURE_TASKS[0].id}`),
    {
      id: `task:${FIXTURE_TASKS[0].id}`,
      provider: 'sqlite',
      type: 'task',
      title: 'VIEW-001: Backlog task',
      resource: { kind: 'task', id: FIXTURE_TASKS[0].id },
    },
  );
  assert.equal(graph.errors.length, 0);
  assert.deepEqual(edge(graph, '/knowledge/context.md', `task:${FIXTURE_TASKS[0].id}`), {
    source: '/knowledge/context.md',
    target: `task:${FIXTURE_TASKS[0].id}`,
    weight: 2,
  });
  assert.deepEqual(edge(graph, '/tasks/index.md', `task:${FIXTURE_TASKS[1].id}`), {
    source: '/tasks/index.md',
    target: `task:${FIXTURE_TASKS[1].id}`,
    weight: 1,
  });
  assert.deepEqual(
    edge(graph, `task:${FIXTURE_TASKS[2].id}`, `task:${FIXTURE_TASKS[3].id}`),
    {
      source: `task:${FIXTURE_TASKS[2].id}`,
      target: `task:${FIXTURE_TASKS[3].id}`,
      weight: 1,
    },
  );
});

test('graph projection excludes views, omits missing markdown edges, and reports sorted dangling task errors', (t) => {
  const root = temporaryDirectory(t);
  const vaultRoot = path.join(root, 'vault');
  const projectName = 'graph-errors';
  const projectDir = createProject(vaultRoot, projectName);

  writeMarkdown(
    path.join(projectDir, 'knowledge', 'context.md'),
    'Viewer context',
    '[Missing task](task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?view=reader)\n\n[Missing doc](/knowledge/missing.md)\n',
  );
  writeMarkdown(
    path.join(projectDir, 'tasks', 'index.md'),
    'Task index',
    '[Context](/knowledge/context.md)\n',
  );
  writeMarkdown(
    path.join(projectDir, 'views', 'ignored.md'),
    'Ignored view',
    '[Ready task](task:22222222-2222-4222-8222-222222222222)\n',
  );

  createSqliteDatabase(path.join(projectDir, 'tasks', 'tasks.sqlite3'), {
    projectName,
    tasks: [
      {
        ...FIXTURE_TASKS[0],
        body_markdown:
          '# VIEW-001: Backlog task\n\n[Missing task](task:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb#graph)\n',
      },
      FIXTURE_TASKS[1],
    ],
  });

  const graph = createVaultStore(vaultRoot).graph(projectName);

  assert.equal(graph.nodes.some((node) => node.id === '/views/ignored.md'), false);
  assert.equal(
    graph.edges.some((candidate) => candidate.target === '/knowledge/missing.md'),
    false,
  );
  assert.deepEqual(graph.errors, [
    {
      kind: 'dangling-task',
      source: '/knowledge/context.md',
      target: 'task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'dangling-task',
      source: `task:${FIXTURE_TASKS[0].id}`,
      target: 'task:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ]);
});
