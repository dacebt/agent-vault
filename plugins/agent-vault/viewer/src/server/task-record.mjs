const OKF_STATUSES = ['draft', 'stable', 'deprecated'];
const TASK_STATUSES = ['backlog', 'todo', 'in-progress', 'blocked', 'done'];
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
const TASK_URI_RE = new RegExp(`^task:(${UUID_PATTERN})$`, 'i');

export const REQUIRED_TASK_COLUMNS = [
  'id',
  'task_key',
  'type',
  'title',
  'description',
  'okf_status',
  'task_status',
  'priority',
  'milestone',
  'sort_order',
  'body_markdown',
  'tags_json',
  'sources_json',
  'verified_json',
  'extensions_json',
  'generated_by',
  'generated_at',
  'created_at',
  'started_at',
  'completed_at',
];

export class ProjectDatabaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectDatabaseError';
    this.kind = 'database';
    this.code = code;
  }
}

function normalizeUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function canonicalTaskUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value) && value === value.toLowerCase()
    ? value
    : null;
}

function canonicalTaskTitle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed === value ? value : null;
}

function decodeJson(value, expected, field, taskId) {
  let decoded;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    throw new ProjectDatabaseError(
      'invalid-row',
      `task ${taskId} has invalid ${field}: ${error.message}`,
    );
  }
  if (expected === 'array') {
    if (!Array.isArray(decoded)) {
      throw new ProjectDatabaseError('invalid-row', `task ${taskId} has non-array ${field}`);
    }
    return decoded;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new ProjectDatabaseError('invalid-row', `task ${taskId} has non-object ${field}`);
  }
  return decoded;
}

function parseTaskIdentifier(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const uriMatch = trimmed.match(TASK_URI_RE);
  if (uriMatch) return uriMatch[1].toLowerCase();
  return normalizeUuid(trimmed);
}

function taskUri(id) {
  return `task:${id}`;
}

export function taskIdentifier(id) {
  return parseTaskIdentifier(id);
}

export function validateTaskRow(row) {
  const id = canonicalTaskUuid(row.id);
  if (!id) {
    throw new ProjectDatabaseError('invalid-row', `task row has invalid UUID: ${row.id}`);
  }
  if (!canonicalTaskTitle(row.title)) {
    throw new ProjectDatabaseError('invalid-row', `task ${id} has invalid title: ${row.title}`);
  }
  if (!TASK_STATUSES.includes(row.task_status)) {
    throw new ProjectDatabaseError(
      'invalid-row',
      `task ${id} has unsupported workflow status: ${row.task_status}`,
    );
  }
  if (!OKF_STATUSES.includes(row.okf_status)) {
    throw new ProjectDatabaseError(
      'invalid-row',
      `task ${id} has unsupported OKF status: ${row.okf_status}`,
    );
  }

  decodeJson(row.tags_json, 'array', 'tags_json', id);
  decodeJson(row.sources_json, 'array', 'sources_json', id);
  decodeJson(row.verified_json, 'array', 'verified_json', id);
  decodeJson(row.extensions_json, 'object', 'extensions_json', id);
}

export function normalizeBoardTask(row) {
  const id = row.id;
  return {
    id,
    uri: taskUri(id),
    key: row.task_key,
    title: row.title,
    description: row.description,
    status: row.task_status,
    priority: row.priority,
    tags: decodeJson(row.tags_json, 'array', 'tags_json', id),
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    blocked: row.task_status === 'blocked',
  };
}

export function normalizeTask(row) {
  const id = row.id;
  return {
    id,
    uri: taskUri(id),
    key: row.task_key,
    title: row.title,
    description: row.description,
    okfStatus: row.okf_status,
    status: row.task_status,
    priority: row.priority,
    tags: decodeJson(row.tags_json, 'array', 'tags_json', id),
    sources: decodeJson(row.sources_json, 'array', 'sources_json', id),
    verified: decodeJson(row.verified_json, 'array', 'verified_json', id),
    extensions: decodeJson(row.extensions_json, 'object', 'extensions_json', id),
    markdown: row.body_markdown,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    blocked: row.task_status === 'blocked',
  };
}
