(function () {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const MARKDOWN_ID = /^\/(?:[^/]+\/)*[^/]+\.md$/i;

  function compareOrdinal(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isMarkdownId(value) {
    if (typeof value !== "string" || !MARKDOWN_ID.test(value)) return false;
    return !value.split("/").some((segment) => segment === "." || segment === "..");
  }

  function normalizeUuid(value) {
    return typeof value === "string" && UUID_PATTERN.test(value.toLowerCase()) ? value.toLowerCase() : null;
  }

  function isTaskUri(value) {
    if (typeof value !== "string" || !value.startsWith("task:")) return false;
    return normalizeUuid(value.slice(5)) === value.slice(5);
  }

  function validResource(node) {
    if (!isPlainObject(node.resource)) return false;
    if (node.provider === "markdown") {
      return node.resource.kind === "document"
        && node.resource.path === node.id
        && isMarkdownId(node.id);
    }
    if (node.provider === "sqlite") {
      return node.resource.kind === "task"
        && node.type === "task"
        && normalizeUuid(node.resource.id) === node.resource.id
        && node.id === `task:${node.resource.id}`;
    }
    return false;
  }

  function validNode(node, ids) {
    return isPlainObject(node)
      && typeof node.id === "string"
      && node.id
      && !ids.has(node.id)
      && (node.provider === "markdown" || node.provider === "sqlite")
      && typeof node.type === "string"
      && node.type.trim() === node.type
      && node.type.length > 0
      && typeof node.title === "string"
      && node.title.trim() === node.title
      && node.title.length > 0
      && validResource(node);
  }

  function validEdge(edge, ids, pairs) {
    if (!isPlainObject(edge)
      || !ids.has(edge.source)
      || !ids.has(edge.target)
      || compareOrdinal(edge.source, edge.target) >= 0
      || !Number.isSafeInteger(edge.weight)
      || edge.weight <= 0) {
      return false;
    }
    const pair = `${edge.source}\u0000${edge.target}`;
    if (pairs.has(pair)) return false;
    pairs.add(pair);
    return true;
  }

  function validError(error, ids) {
    return isPlainObject(error)
      && error.kind === "dangling-task"
      && ids.has(error.source)
      && isTaskUri(error.target);
  }

  function isPayload(body, project) {
    if (!isPlainObject(body)
      || body.project !== project
      || !Array.isArray(body.nodes)
      || !Array.isArray(body.edges)
      || !Array.isArray(body.errors)) {
      return false;
    }
    const ids = new Set();
    for (const node of body.nodes) {
      if (!validNode(node, ids)) return false;
      ids.add(node.id);
    }
    const pairs = new Set();
    for (const edge of body.edges) {
      if (!validEdge(edge, ids, pairs)) return false;
    }
    for (const error of body.errors) {
      if (!validError(error, ids)) return false;
    }
    return true;
  }

  window.graphSchema = Object.freeze({ isPayload });
})();
