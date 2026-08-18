import fs from 'node:fs';
import path from 'node:path';
import { buildProjectGraph } from './graph-data.mjs';
import {
  ProjectDatabaseError,
  projectBoard,
  projectCounts,
  projectTask,
  projectTasks,
} from './task-database.mjs';

function containsPath(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function canonicalDirectory(directory) {
  try {
    const canonical = fs.realpathSync(directory);
    return fs.statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

function createProjectError(error) {
  if (error instanceof ProjectDatabaseError) {
    return { kind: error.kind, code: error.code, message: error.message };
  }
  throw error;
}

export function createVaultStore(vault) {
  function vaultIdentity() {
    const canonical = canonicalDirectory(vault);
    if (!canonical) return null;
    try {
      fs.readdirSync(canonical);
      return canonical;
    } catch {
      return null;
    }
  }

  function isUsable() {
    return vaultIdentity() !== null;
  }

  function validProjectId(project) {
    return (
      typeof project === 'string' &&
      project.length > 0 &&
      !project.startsWith('.') &&
      !project.includes('\0') &&
      !project.includes('/') &&
      !project.includes('\\') &&
      project !== '.' &&
      project !== '..'
    );
  }

  function projectIdentity(project, vaultDir = vaultIdentity()) {
    if (!vaultDir || !validProjectId(project)) return null;

    const projectEntry = path.join(vaultDir, project);
    try {
      if (!fs.lstatSync(projectEntry).isDirectory()) return null;
    } catch {
      return null;
    }

    const projectDir = canonicalDirectory(projectEntry);
    if (!projectDir || projectDir === vaultDir || !containsPath(vaultDir, projectDir)) return null;

    const tasksDir = canonicalDirectory(path.join(projectDir, 'tasks'));
    if (!tasksDir || !containsPath(projectDir, tasksDir)) return null;

    return { name: project, projectDir, tasksDir };
  }

  function discoverProjects() {
    const vaultDir = vaultIdentity();
    if (!vaultDir) return [];

    let entries;
    try {
      entries = fs.readdirSync(vaultDir, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => projectIdentity(entry.name, vaultDir))
      .filter(Boolean)
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  }

  function hasProject(project) {
    return projectIdentity(project) !== null;
  }

  function parseFrontmatter(text) {
    const frontmatter = {};
    const block = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (!block) return frontmatter;
    const lines = block[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!match) continue;
      const key = match[1].toLowerCase();
      let value = match[2].trim();
      if (key === 'title' && value === '>-' && /^\s+\S/.test(lines[index + 1] || '')) {
        frontmatter[key] = lines[++index].trim();
        continue;
      }
      if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter[key] = value
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        continue;
      }
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
    return frontmatter;
  }

  function projects() {
    return discoverProjects().map((project) => {
      try {
        return { name: project.name, counts: projectCounts(project) };
      } catch (error) {
        return { name: project.name, counts: null, error: createProjectError(error) };
      }
    });
  }

  function board(projectName) {
    const project = projectIdentity(projectName);
    if (!project) return [];
    return projectBoard(project);
  }

  function task(projectName, requestedId) {
    const project = projectIdentity(projectName);
    if (!project) return undefined;
    return projectTask(project, requestedId);
  }

  function graph(projectName) {
    const project = projectIdentity(projectName);
    if (!project) return { nodes: [], edges: [], errors: [] };
    return buildProjectGraph(project.projectDir, parseFrontmatter, projectTasks(project));
  }

  function resolvePath(projectName, requested) {
    const project = projectIdentity(projectName);
    if (!project || typeof requested !== 'string' || requested.includes('\0')) return null;

    const normalizedRequest = requested.replace(/\\/g, '/').replace(/^\/+/, '');
    const candidate = path.resolve(project.projectDir, '.' + path.sep + normalizedRequest);
    if (!containsPath(project.projectDir, candidate)) return null;

    const relative = path.relative(project.projectDir, candidate);
    const segments = relative ? relative.split(path.sep) : [];
    let current = project.projectDir;

    for (let index = 0; index < segments.length; index++) {
      const next = path.join(current, segments[index]);
      try {
        fs.lstatSync(next);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return path.join(current, ...segments.slice(index));
        }
        return null;
      }

      let canonical;
      try {
        canonical = fs.realpathSync(next);
      } catch {
        return null;
      }

      if (!containsPath(project.projectDir, canonical)) return null;
      if (index < segments.length - 1) {
        try {
          if (!fs.statSync(canonical).isDirectory()) return null;
        } catch {
          return null;
        }
      }
      current = canonical;
    }

    return current;
  }

  function document(project, documentPath) {
    const absolutePath = resolvePath(project, documentPath);
    if (!absolutePath || !absolutePath.endsWith('.md')) return null;
    let markdown;
    try {
      markdown = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return null;
    }
    const frontmatter = parseFrontmatter(markdown);
    return {
      path: documentPath,
      markdown,
      frontmatterTitle: typeof frontmatter.title === 'string' ? frontmatter.title : null,
    };
  }

  return Object.freeze({
    board,
    document,
    graph,
    hasProject,
    isUsable,
    projects,
    resolvePath,
    task,
  });
}
