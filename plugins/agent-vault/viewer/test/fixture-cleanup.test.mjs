import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../.wsd/run-sqlite-fixture-server.mjs', import.meta.url));

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-cleanup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function assertFailedStartCleansFixture(root, port, errorPattern) {
  const result = spawnSync(process.execPath, [RUNNER], {
    env: { ...process.env, TMPDIR: root, PORT: String(port) },
    encoding: 'utf8',
    timeout: 15000,
    killSignal: 'SIGKILL',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, errorPattern);
  const fixture = JSON.parse(result.stdout).fixture;
  assert.equal(path.dirname(path.dirname(fixture)), fs.realpathSync(root));
  assert.equal(fs.existsSync(fixture), false);
  assert.equal(fs.existsSync(path.dirname(fixture)), false);
}

test('fixture runner removes its migrated vault when the port is invalid', (t) => {
  assertFailedStartCleansFixture(temporaryRoot(t), -1, /ERR_SOCKET_BAD_PORT/);
});

test('fixture runner removes its migrated vault when a listener already owns the port', async (t) => {
  const root = temporaryRoot(t);
  const listener = http.createServer();
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  assertFailedStartCleansFixture(root, listener.address().port, /EADDRINUSE/);
  assert.equal(listener.listening, true);
});

test('fixture runner closes live event clients and removes its vault on termination', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-cleanup-test-'));
  const child = spawn(process.execPath, [RUNNER], {
    env: { ...process.env, TMPDIR: root, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    killSignal: 'SIGKILL',
  });
  const closed = once(child, 'close');
  let output = '';
  let errors = '';
  let reader = null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { errors += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    if (reader) await reader.cancel().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    child.once('error', reject);
    child.once('close', () => reject(new Error(`Runner exited before listening: ${errors}`)));
  });
  const baseUrl = await ready;
  const fixture = JSON.parse(output.slice(0, output.lastIndexOf('}') + 1)).fixture;
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.pid, child.pid);
  assert.equal(health.ok, true);
  assert.match(health.instanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const response = await fetch(`${baseUrl}/api/events`);
  reader = response.body.getReader();
  const firstEvent = await reader.read();
  assert.equal(firstEvent.done, false);
  child.kill('SIGTERM');
  const [code, signal] = await closed;
  assert.equal(signal, null, errors);
  assert.equal(code, 0, errors);
  assert.equal(fs.existsSync(path.dirname(fixture)), false);
});
