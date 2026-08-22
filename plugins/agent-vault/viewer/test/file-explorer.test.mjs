import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../public/scripts/file-explorer.js', import.meta.url),
  'utf8',
);
const context = { window: {} };
vm.runInNewContext(source, context);
const { isPayload } = context.window.fileExplorer;

function payload(entries) {
  return { project: 'viewer', entries };
}

test('file payload accepts a canonical nested project tree', () => {
  assert.equal(isPayload(payload([
    {
      kind: 'directory',
      name: 'knowledge',
      path: '/knowledge',
      children: [
        { kind: 'file', name: 'context.md', path: '/knowledge/context.md', size: 42 },
      ],
    },
    { kind: 'file', name: 'index.md', path: '/index.md', size: 12 },
  ]), 'viewer'), true);
});

test('file payload rejects paths that disagree with the visible tree', () => {
  assert.equal(isPayload(payload([
    { kind: 'file', name: 'context.md', path: '/other.md', size: 42 },
  ]), 'viewer'), false);
  assert.equal(isPayload(payload([
    { kind: 'file', name: '..', path: '/..', size: 42 },
  ]), 'viewer'), false);
});

test('file payload rejects duplicate paths', () => {
  assert.equal(isPayload(payload([
    { kind: 'file', name: 'index.md', path: '/index.md', size: 12 },
    { kind: 'file', name: 'index.md', path: '/index.md', size: 24 },
  ]), 'viewer'), false);
});
