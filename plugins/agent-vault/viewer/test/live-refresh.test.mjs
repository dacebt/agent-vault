import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createViewerServer } from '../server.mjs';
import { FIXTURE_TASKS, createSqliteDatabase, createValidSqliteProject } from './sqlite-fixture.mjs';

const SSE_TIMEOUT_MS = 5000;
const TARGET_TASK_ID = FIXTURE_TASKS[2].id;

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function replacementTasks() {
  return FIXTURE_TASKS.map((task) => {
    if (task.id === FIXTURE_TASKS[1].id) {
      return {
        ...task,
        task_status: 'done',
        completed_at: '2026-08-16T12:00:00Z',
      };
    }

    if (task.id === TARGET_TASK_ID) {
      return {
        ...task,
        title: 'VIEW-003: Live refresh replacement',
        description: 'Visible after the SQLite file is replaced.',
        body_markdown:
          '# VIEW-003: Live refresh replacement\n\nReplacement body from database B.\n',
      };
    }

    return task;
  });
}

function startSse(baseUrl) {
  const events = [];
  let buffer = '';
  let resolveWaiter = null;
  let rejectWaiter = null;
  let settled = false;

  function pushEvent(event) {
    if (resolveWaiter) {
      const resolve = resolveWaiter;
      resolveWaiter = null;
      rejectWaiter = null;
      resolve(event);
      return;
    }
    events.push(event);
  }

  function failWaiter(error) {
    if (rejectWaiter) {
      const reject = rejectWaiter;
      resolveWaiter = null;
      rejectWaiter = null;
      reject(error);
    }
  }

  function consumeBuffer() {
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = chunk
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (payload) {
        pushEvent(JSON.parse(payload));
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  const request = http.get(new URL('/api/events', baseUrl), (response) => {
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      buffer += chunk.replace(/\r\n/g, '\n');
      consumeBuffer();
    });
    response.on('end', () => {
      settled = true;
      failWaiter(new Error('SSE stream ended before the expected event.'));
    });
  });

  request.on('error', (error) => {
    settled = true;
    failWaiter(error);
  });

  return {
    async nextEvent(timeoutMs = SSE_TIMEOUT_MS) {
      if (events.length > 0) {
        return events.shift();
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolveWaiter = null;
          rejectWaiter = null;
          reject(new Error(`Timed out waiting ${timeoutMs}ms for SSE event.`));
        }, timeoutMs);

        resolveWaiter = (event) => {
          clearTimeout(timeout);
          resolve(event);
        };
        rejectWaiter = (error) => {
          clearTimeout(timeout);
          reject(error);
        };

        if (settled) {
          rejectWaiter(new Error('SSE stream is already closed.'));
        }
      });
    },
    close() {
      settled = true;
      request.destroy();
    },
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  assert.equal(response.ok, true, `request failed for ${pathname}`);
  return response.json();
}

test('atomic SQLite replacement emits change events, serves refreshed data, and closes its watcher', async (t) => {
  const originalWatch = fs.watch;
  const watchRecords = [];
  fs.watch = (...args) => {
    const watcher = originalWatch(...args);
    const record = {
      path: args[0],
      options: args[1],
      closeCalls: 0,
      closed: false,
    };
    watchRecords.push(record);
    return {
      close() {
        record.closeCalls += 1;
        if (record.closed) return;
        record.closed = true;
        watcher.close();
      },
    };
  };
  t.after(() => {
    fs.watch = originalWatch;
  });

  const { dbPath, projectName, vaultRoot } = createValidSqliteProject(t, {
    projectName: 'live-refresh-fixture',
  });
  const replacementPath = path.join(path.dirname(dbPath), 'tasks.replacement.sqlite3');
  createSqliteDatabase(replacementPath, {
    projectName,
    tasks: replacementTasks(),
  });
  const replacementHashBefore = sha256(replacementPath);

  const viewer = createViewerServer({ vault: vaultRoot, port: 0 });
  let serverClosed = false;
  let sseClosed = false;
  let sse = null;
  t.after(async () => {
    if (!sseClosed && sse) {
      sse.close();
      sseClosed = true;
    }
    if (!serverClosed && viewer.server.listening) {
      await closeServer(viewer.server);
      serverClosed = true;
    }
  });

  await viewer.start();
  const address = viewer.server.address();
  assert.equal(typeof address, 'object');
  const baseUrl = `http://${viewer.host}:${address.port}`;
  sse = startSse(baseUrl);

  const hello = await sse.nextEvent();
  assert.deepEqual(hello, { type: 'hello' });

  fs.renameSync(replacementPath, dbPath);

  const change = await sse.nextEvent();
  assert.deepEqual(change, { type: 'change' });

  const board = await getJson(baseUrl, `/api/board?project=${projectName}`);
  assert.deepEqual(
    board.statuses.map((column) => [column.status, column.tasks.length]),
    [
      ['backlog', 1],
      ['todo', 0],
      ['in-progress', 2],
      ['done', 2],
    ],
  );
  const refreshedBoardTask = board.statuses
    .flatMap((column) => column.tasks)
    .find((task) => task.id === TARGET_TASK_ID);
  assert.equal(refreshedBoardTask?.title, 'VIEW-003: Live refresh replacement');

  const task = await getJson(baseUrl, `/api/task?project=${projectName}&id=${TARGET_TASK_ID}`);
  assert.equal(task.title, 'VIEW-003: Live refresh replacement');
  assert.match(task.markdown, /Replacement body from database B\./);

  const replacementHashAfter = sha256(dbPath);
  assert.equal(replacementHashAfter, replacementHashBefore);

  sse.close();
  sseClosed = true;
  await closeServer(viewer.server);
  serverClosed = true;

  assert.equal(watchRecords.length, 1);
  assert.equal(watchRecords[0].path, vaultRoot);
  assert.deepEqual(watchRecords[0].options, { recursive: true });
  assert.equal(watchRecords[0].closeCalls, 1);
  assert.equal(watchRecords[0].closed, true);
});

test('viewer start rejects and closes the listener when watcher setup throws', async (t) => {
  const originalWatch = fs.watch;
  const watchError = new Error('watch setup failed');
  let watchCalls = 0;

  fs.watch = () => {
    watchCalls += 1;
    throw watchError;
  };
  t.after(() => {
    fs.watch = originalWatch;
  });

  const { vaultRoot } = createValidSqliteProject(t, {
    projectName: 'live-refresh-watch-failure',
  });
  const viewer = createViewerServer({ vault: vaultRoot, port: 0 });

  await assert.rejects(viewer.start(), (error) => {
    assert.equal(error, watchError);
    return true;
  });

  assert.equal(viewer.server.listening, false);
  assert.equal(viewer.server.address(), null);
  assert.equal(watchCalls, 1);
});

test('second viewer start rejects on an occupied loopback port without creating a watcher', async (t) => {
  const originalWatch = fs.watch;
  const watchRecords = [];
  fs.watch = (...args) => {
    const watcher = originalWatch(...args);
    const record = {
      path: args[0],
      options: args[1],
      closeCalls: 0,
      closed: false,
    };
    watchRecords.push(record);
    return {
      close() {
        record.closeCalls += 1;
        if (record.closed) return;
        record.closed = true;
        watcher.close();
      },
    };
  };
  t.after(() => {
    fs.watch = originalWatch;
  });

  const { vaultRoot } = createValidSqliteProject(t, {
    projectName: 'live-refresh-port-conflict',
  });
  const firstViewer = createViewerServer({ vault: vaultRoot, port: 0 });
  let firstClosed = false;
  t.after(async () => {
    if (!firstClosed && firstViewer.server.listening) {
      await closeServer(firstViewer.server);
      firstClosed = true;
    }
  });

  await firstViewer.start();
  const address = firstViewer.server.address();
  assert.equal(typeof address, 'object');

  const secondViewer = createViewerServer({ vault: vaultRoot, port: address.port });
  await assert.rejects(secondViewer.start(), (error) => {
    assert.equal(error?.code, 'EADDRINUSE');
    assert.match(error.message, /EADDRINUSE/);
    return true;
  });

  assert.equal(secondViewer.server.listening, false);
  assert.equal(watchRecords.length, 1);
  assert.equal(watchRecords[0].path, vaultRoot);
  assert.deepEqual(watchRecords[0].options, { recursive: true });

  await closeServer(firstViewer.server);
  firstClosed = true;

  assert.equal(watchRecords[0].closeCalls, 1);
  assert.equal(watchRecords[0].closed, true);
});
