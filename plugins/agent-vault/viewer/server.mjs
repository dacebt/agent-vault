import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVaultStore } from './src/server/vault-store.mjs';
import { ProjectDatabaseError, taskIdentifier } from './src/server/task-database.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VAULT = path.resolve(
  process.env.AGENT_VAULT || path.join(os.homedir(), 'agent-vault'),
);
const DEFAULT_PORT = Number(process.env.PORT) || 7373;
const HOST = '127.0.0.1';

const STATIC_FILES = {
  '/': 'public/index.html',
  '/scripts/app.js': 'public/scripts/app.js',
  '/scripts/file-explorer.js': 'public/scripts/file-explorer.js',
  '/scripts/project-picker.js': 'public/scripts/project-picker.js',
  '/scripts/reader.js': 'public/scripts/reader.js',
  '/scripts/selection.js': 'public/scripts/selection.js',
  '/scripts/graph/interaction.js': 'public/scripts/graph/interaction.js',
  '/scripts/graph/layout.js': 'public/scripts/graph/layout.js',
  '/scripts/graph/viewport.js': 'public/scripts/graph/viewport.js',
  '/scripts/graph/labels.js': 'public/scripts/graph/labels.js',
  '/scripts/graph/schema.js': 'public/scripts/graph/schema.js',
  '/scripts/graph/view.js': 'public/scripts/graph/view.js',
  '/styles/board.css': 'public/styles/board.css',
  '/styles/file-explorer.css': 'public/styles/file-explorer.css',
  '/styles/graph.css': 'public/styles/graph.css',
  '/styles/reader.css': 'public/styles/reader.css',
  '/styles/shell.css': 'public/styles/shell.css',
  '/styles/utilities.css': 'public/styles/utilities.css',
  '/vendor/marked.min.js': 'vendor/marked.min.js',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function projectDatabasePayload(project, error) {
  if (!(error instanceof ProjectDatabaseError)) throw error;
  return {
    project,
    error: { kind: error.kind, code: error.code, message: error.message },
  };
}

function watchVault(vault, broadcastChange) {
  let debounceTimer = null;
  let watcher = null;
  let stopped = false;

  watcher = fs.watch(vault, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const parts = String(filename).split(path.sep);
    if (parts.some((part) => part.startsWith('.'))) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcastChange();
    }, 300);
  });

  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}

export function createViewerServer(options = {}) {
  const vault = path.resolve(options.vault || DEFAULT_VAULT);
  const port = options.port === undefined ? DEFAULT_PORT : Number(options.port);
  const rootDir = options.rootDir || ROOT_DIR;
  const vaultStore = createVaultStore(vault);
  const sseClients = new Set();
  let stopWatching = null;

  function broadcastChange() {
    for (const client of sseClients) {
      try {
        client.write('data: {"type":"change"}\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      if (!vaultStore.isUsable()) {
        return sendJson(res, 503, { ok: false, vault, error: 'vault unavailable' });
      }
      return sendJson(res, 200, { ok: true, vault });
    }

    if (pathname === '/api/projects') {
      return sendJson(res, 200, { projects: vaultStore.projects() });
    }

    if (pathname === '/api/board') {
      const project = url.searchParams.get('project');
      if (!vaultStore.hasProject(project)) {
        return sendJson(res, 404, { error: 'unknown project' });
      }
      try {
        return sendJson(res, 200, { project, statuses: vaultStore.board(project) });
      } catch (error) {
        return sendJson(res, 422, projectDatabasePayload(project, error));
      }
    }

    if (pathname === '/api/graph') {
      const project = url.searchParams.get('project');
      if (!vaultStore.hasProject(project)) {
        return sendJson(res, 404, { error: 'unknown project' });
      }
      try {
        return sendJson(res, 200, { project, ...vaultStore.graph(project) });
      } catch (error) {
        return sendJson(res, 422, projectDatabasePayload(project, error));
      }
    }

    if (pathname === '/api/files') {
      const project = url.searchParams.get('project');
      if (!vaultStore.hasProject(project)) {
        return sendJson(res, 404, { error: 'unknown project' });
      }
      return sendJson(res, 200, { project, entries: vaultStore.files(project) });
    }

    if (pathname === '/api/task') {
      const project = url.searchParams.get('project');
      const id = url.searchParams.get('id');
      if (!vaultStore.hasProject(project)) {
        return sendJson(res, 404, { error: 'unknown project' });
      }
      if (!taskIdentifier(id)) {
        return sendJson(res, 400, { error: 'bad task id' });
      }
      try {
        const task = vaultStore.task(project, id);
        if (task === undefined) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, task);
      } catch (error) {
        return sendJson(res, 422, projectDatabasePayload(project, error));
      }
    }

    if (pathname === '/api/doc') {
      const project = url.searchParams.get('project');
      const docPath = url.searchParams.get('path');
      if (!vaultStore.hasProject(project)) {
        return sendJson(res, 404, { error: 'unknown project' });
      }
      if (!docPath || path.extname(docPath).toLowerCase() !== '.md') {
        return sendJson(res, 400, { error: 'bad path' });
      }
      const absolutePath = vaultStore.resolvePath(project, docPath);
      if (!absolutePath || path.extname(absolutePath).toLowerCase() !== '.md') {
        return sendJson(res, 400, { error: 'bad path' });
      }
      const document = vaultStore.document(project, docPath);
      if (!document) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, document);
    }

    if (pathname.startsWith('/raw/')) {
      const rest = pathname.slice('/raw/'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) return sendJson(res, 400, { error: 'bad path' });
      let project;
      let rawPath;
      try {
        project = decodeURIComponent(rest.slice(0, slash));
        rawPath = decodeURIComponent(rest.slice(slash + 1));
      } catch {
        return sendJson(res, 400, { error: 'bad path' });
      }
      if (!vaultStore.hasProject(project)) {
        return sendJson(res, 404, { error: 'unknown project' });
      }
      const abs = vaultStore.resolvePath(project, rawPath);
      if (!abs || path.extname(abs).toLowerCase() === '.md') {
        return sendJson(res, 400, { error: 'bad path' });
      }
      let data;
      try {
        data = fs.readFileSync(abs);
      } catch {
        return sendJson(res, 404, { error: 'not found' });
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      return res.end(data);
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      res.write('data: {"type":"hello"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname in STATIC_FILES) {
      const abs = path.join(rootDir, STATIC_FILES[pathname]);
      let data;
      try {
        data = fs.readFileSync(abs);
      } catch {
        return sendJson(res, 404, { error: 'not found' });
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      return res.end(data);
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal error' });
      } else {
        res.end();
      }
    }
  });

  server.on('close', () => {
    if (stopWatching) {
      stopWatching();
      stopWatching = null;
    }
  });

  return {
    host: HOST,
    port,
    server,
    vault,
    start() {
      return new Promise((resolve, reject) => {
        const handleError = (error) => {
          server.off('error', handleError);
          reject(error);
        };

        server.on('error', handleError);

        try {
          server.listen(port, HOST, () => {
            try {
              if (!stopWatching) {
                stopWatching = watchVault(vault, broadcastChange);
              }
            } catch (error) {
              server.off('error', handleError);
              server.close(() => reject(error));
              return;
            }

            server.off('error', handleError);
            const address = server.address();
            const actualPort = typeof address === 'object' && address ? address.port : port;
            console.log(`agent-vault viewer listening on http://${HOST}:${actualPort} (vault: ${vault})`);
            resolve(server);
          });
        } catch (error) {
          server.off('error', handleError);
          reject(error);
        }
      });
    },
  };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const viewer = createViewerServer();
  viewer.start();
}
