import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const marked = require('../../vendor/marked.min.js');

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TASK_LINK_RE = new RegExp(`^task:(${UUID_PATTERN})(?:[?#].*)?$`, 'i');

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function discoverMarkdownFiles(projectDir) {
  const files = [];

  function visit(relativeDir) {
    const absoluteDir = path.join(projectDir, relativeDir);
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        if (relativeDir === '' && entry.name === 'views') continue;
        visit(relativePath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        files.push(relativePath);
      }
    }
  }

  visit('');
  return files.sort((a, b) => compareStrings(toGraphPath(a), toGraphPath(b)));
}

function toGraphPath(relativePath) {
  return '/' + relativePath.split(path.sep).join('/');
}

function markdownBody(markdown) {
  return markdown.replace(FRONTMATTER_RE, '');
}

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function taskLinkIdentifier(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(TASK_LINK_RE);
  return match ? match[1].toLowerCase() : null;
}

function resolveSegments(baseSegments, destination) {
  const segments = destination.split('/');
  const resolved = [...baseSegments];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!resolved.length) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return '/' + resolved.join('/');
}

function resolveLink(sourcePath, destination) {
  if (typeof destination !== 'string') return null;
  const href = destination.trim();
  if (!href || SCHEME_RE.test(href) || href.startsWith('//') || href.startsWith('#')) {
    return null;
  }

  const undecodedPath = href.split(/[?#]/, 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(undecodedPath);
  } catch {
    return null;
  }

  const baseSegments = decodedPath.startsWith('/')
    ? []
    : sourcePath.slice(1).split('/').slice(0, -1);
  return resolveSegments(baseSegments, decodedPath.replace(/^\/+/, ''));
}

function linkDestinations(markdown) {
  const destinations = [];
  const tokens = marked.lexer(markdownBody(markdown));
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'link') destinations.push(token.href);
  });
  return destinations;
}

function documentNode(relativePath, markdown, parseFrontmatter) {
  const frontmatter = parseFrontmatter(markdown);
  const graphPath = toGraphPath(relativePath);
  return {
    id: graphPath,
    provider: 'markdown',
    type: nonEmptyString(frontmatter.type) || 'document',
    title: nonEmptyString(frontmatter.title) || path.basename(relativePath, '.md'),
    resource: { kind: 'document', path: graphPath },
  };
}

function taskNode(task) {
  return {
    id: task.uri,
    provider: 'sqlite',
    type: 'task',
    title: task.title,
    resource: { kind: 'task', id: task.id },
  };
}

function addEdge(edgeWeights, source, target) {
  if (source === target) return;
  const [left, right] = [source, target].sort(compareStrings);
  const key = `${left}\0${right}`;
  edgeWeights.set(key, (edgeWeights.get(key) || 0) + 1);
}

function addDanglingTask(errors, source, taskId) {
  errors.add(`${source}\0task:${taskId}`);
}

export function buildProjectGraph(projectDir, parseFrontmatter, tasks) {
  const concepts = discoverMarkdownFiles(projectDir).map((relativePath) => {
    const absolutePath = path.join(projectDir, relativePath);
    const markdown = fs.readFileSync(absolutePath, 'utf8');
    return {
      markdown,
      node: documentNode(relativePath, markdown, parseFrontmatter),
    };
  });

  const markdownNodes = new Map(concepts.map((concept) => [concept.node.id, concept.node]));
  const taskNodes = new Map(tasks.map((task) => [task.uri, taskNode(task)]));
  const taskIds = new Set(tasks.map((task) => task.id));
  const edgeWeights = new Map();
  const danglingTaskErrors = new Set();

  for (const concept of concepts) {
    for (const href of linkDestinations(concept.markdown)) {
      const taskId = taskLinkIdentifier(href);
      if (taskId) {
        if (taskIds.has(taskId)) {
          addEdge(edgeWeights, concept.node.id, `task:${taskId}`);
        } else {
          addDanglingTask(danglingTaskErrors, concept.node.id, taskId);
        }
        continue;
      }

      const target = resolveLink(concept.node.id, href);
      if (target && markdownNodes.has(target)) {
        addEdge(edgeWeights, concept.node.id, target);
      }
    }
  }

  for (const task of tasks) {
    for (const href of linkDestinations(task.markdown)) {
      const taskId = taskLinkIdentifier(href);
      if (taskId) {
        if (taskIds.has(taskId)) {
          addEdge(edgeWeights, task.uri, `task:${taskId}`);
        } else {
          addDanglingTask(danglingTaskErrors, task.uri, taskId);
        }
        continue;
      }

      const target = resolveLink('/tasks/index.md', href);
      if (target && markdownNodes.has(target)) {
        addEdge(edgeWeights, task.uri, target);
      }
    }
  }

  const edges = [...edgeWeights.entries()]
    .map(([key, weight]) => {
      const [source, target] = key.split('\0');
      return { source, target, weight };
    })
    .sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target));

  return {
    nodes: [...markdownNodes.values(), ...taskNodes.values()].sort((a, b) => compareStrings(a.id, b.id)),
    edges,
    errors: [...danglingTaskErrors]
      .map((entry) => {
        const [source, target] = entry.split('\0');
        return { kind: 'dangling-task', source, target };
      })
      .sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target)),
  };
}
