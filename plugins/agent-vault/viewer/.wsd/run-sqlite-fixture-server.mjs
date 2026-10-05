import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createViewerServer } from '../server.mjs';

const WSD_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(WSD_DIR, '..');
const BUILDER = path.resolve(
  ROOT_DIR,
  '../tests/build-viewer-sqlite-fixture.py',
);
const FIXTURE_NAME = 'viewer-sqlite-fixture';
const PORT = process.env.PORT ? Number(process.env.PORT) : 7399;

if (!fs.existsSync(BUILDER)) {
  console.error(`fixture builder not found: ${BUILDER}`);
  process.exit(1);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-vault-viewer-sqlite-'));
const fixtureProject = path.join(tempRoot, FIXTURE_NAME);
let server = null;
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (!server) process.exit(exitCode);
  server.close(() => process.exit(exitCode));
  server.closeAllConnections();
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
process.on('exit', () => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

try {
  const build = spawnSync('python3', [BUILDER, fixtureProject], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);

  const viewer = createViewerServer({ vault: tempRoot, port: PORT });
  server = viewer.server;
  await viewer.start();
} catch (error) {
  console.error(error);
  stop(1);
}
