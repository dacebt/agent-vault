(function () {
  const BLOCKED_TAGS = new Set([
    "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "TITLE", "NOSCRIPT",
    "TEMPLATE",
  ]);
  const URL_ATTRS = new Set([
    "href", "src", "srcset", "action", "formaction", "xlink:href", "ping", "data", "poster",
  ]);
  const TASK_BASE_PATH = "/tasks/index.md";
  const TASK_LINK = /^task:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[?#].*)?$/i;
  function splitFrontmatter(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (!match) return { meta: {}, body: markdown };
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
      const keyValue = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!keyValue) continue;
      const key = keyValue[1].toLowerCase();
      if (key !== "priority" && key !== "tags") continue;
      let value = keyValue[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      meta[key] = value;
    }
    return { meta, body: markdown.slice(match[0].length) };
  }

  function parseTags(value) {
    if (!value) return [];
    return value.replace(/^\[/, "").replace(/\]$/, "")
      .split(",")
      .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  function dirname(filePath) {
    const index = filePath.lastIndexOf("/");
    return index <= 0 ? "/" : filePath.slice(0, index);
  }

  function basename(filePath) {
    return filePath.slice(filePath.lastIndexOf("/") + 1);
  }
  function resolvePath(target, baseDir) {
    const clean = target.split("#")[0].split("?")[0];
    if (!clean) return null;
    const joined = clean.startsWith("/") ? clean : baseDir + "/" + clean;
    const segments = [];
    for (const part of joined.split("/")) {
      if (!part || part === ".") continue;
      let segment = part;
      try { segment = decodeURIComponent(part); } catch { /* keep raw on malformed escapes */ }
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    return "/" + segments.join("/");
  }

  function badScheme(value) {
    const normalized = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
    return normalized.startsWith("javascript:") || normalized.startsWith("data:");
  }
  function sanitizeMarkdownHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const element of [...template.content.querySelectorAll("*")]) {
      if (BLOCKED_TAGS.has(element.localName.toUpperCase())) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on")) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if (!URL_ATTRS.has(name)) continue;
        const dirty = name === "srcset"
          ? attribute.value.split(",").some((candidate) => badScheme(candidate.trim().split(/\s+/)[0] || ""))
          : badScheme(attribute.value);
        if (dirty) element.removeAttribute(attribute.name);
      }
    }
    return template.content;
  }

  function normalizeResource(resource) {
    if (!resource || typeof resource !== "object") return null;
    if (resource.kind === "document" && typeof resource.path === "string" && resource.path) {
      return { kind: "document", path: resource.path };
    }
    if (resource.kind === "task" && typeof resource.id === "string" && resource.id) {
      return { kind: "task", id: resource.id };
    }
    return null;
  }
  function taskTarget(href) {
    const match = href.match(TASK_LINK);
    return match ? { kind: "task", id: match[1].toLowerCase() } : null;
  }

  function taskUri(id) {
    return String(id).startsWith("task:") ? String(id) : `task:${id}`;
  }

  function resourceKey(resource) {
    return resource.kind === "document" ? `document:${resource.path}` : taskUri(resource.id);
  }

  function resourceLabel(project, resource) {
    return resource.kind === "document"
      ? `${project}${resource.path}`
      : `${project}/${taskUri(resource.id)}`;
  }

  function currentMarkdownPath(resource) {
    return resource.kind === "document" ? resource.path : TASK_BASE_PATH;
  }

  function renderChips(elements, escapeHTML, priority, tags) {
    const chips = [];
    if (priority) chips.push(`<span class="chip chip-priority">${escapeHTML(priority)}</span>`);
    if (Array.isArray(tags)) {
      for (const tag of tags) chips.push(`<span class="chip">${escapeHTML(tag)}</span>`);
    }
    elements.chips.innerHTML = chips.join("");
  }

  function create(options) {
    const { elements, getProject, fetchJSON, escapeHTML } = options;
    let stack = [];
    let generation = 0;
    let lastKey = null;
    let lastResource = null;
    function rawUrl(project, filePath) {
      return "/raw/" + encodeURIComponent(project)
        + filePath.split("/").map(encodeURIComponent).join("/");
    }

    function responsiveUrl(project, url, documentDir) {
      if (/^https?:/i.test(url) || url.startsWith("//")) return url;
      const resolved = resolvePath(url, documentDir);
      return resolved ? rawUrl(project, resolved) : url;
    }

    function rewriteSrcset(project, srcset, documentDir) {
      const candidates = [];
      let position = 0;
      while (position < srcset.length) {
        while (position < srcset.length && /[\s,]/.test(srcset[position])) position++;
        if (position >= srcset.length) break;
        const urlStart = position;
        while (position < srcset.length && !/\s/.test(srcset[position])) position++;
        let url = srcset.slice(urlStart, position);
        if (url.endsWith(",")) {
          url = url.replace(/,+$/, "");
          if (url) candidates.push(responsiveUrl(project, url, documentDir));
          continue;
        }
        while (position < srcset.length && /\s/.test(srcset[position])) position++;
        const descriptorStart = position;
        while (position < srcset.length && srcset[position] !== ",") position++;
        const descriptor = srcset.slice(descriptorStart, position).trim();
        if (position < srcset.length) position++;
        const routedUrl = responsiveUrl(project, url, documentDir);
        candidates.push(descriptor ? `${routedUrl} ${descriptor}` : routedUrl);
      }
      return candidates.join(", ");
    }

    function openModal() {
      elements.overlay.classList.remove("hidden");
    }

    function close() {
      elements.overlay.classList.add("hidden");
      stack = [];
      lastKey = null;
      lastResource = null;
      generation++;
    }

    function showBroken(resource, title, message, request) {
      elements.title.textContent = title;
      elements.chips.innerHTML = "";
      elements.body.innerHTML = `
        <div class="broken-panel">
          <div class="big">&#128394;</div>
          <div>${escapeHTML(message)}</div>
          ${stack.length > 1 ? '<button id="broken-back">&larr; back</button>' : ""}
        </div>`;
      lastKey = resourceKey(resource);
      lastResource = resource;
      if (request !== generation) return;
      const backButton = document.getElementById("broken-back");
      if (backButton) backButton.addEventListener("click", goBack);
    }

    function taskMessage(status, body) {
      if (status === 404) return "this task doesn't exist in this project";
      if (status === 422 && typeof body?.error?.message === "string" && body.error.message) {
        return body.error.message;
      }
      return "this task can't be opened from this project";
    }

    async function show(resource, push) {
      const project = getProject();
      if (!project) return;
      const request = ++generation;
      if (push) stack.push(resource);
      elements.backButton.classList.toggle("hidden", stack.length <= 1);
      elements.path.textContent = resourceLabel(project, resource);
      openModal();

      let markdownBody = "";
      let markdownPath = currentMarkdownPath(resource);
      let title = "";
      let priority = null;
      let tags = [];

      if (resource.kind === "document") {
        const { ok, status, body } = await fetchJSON(
          `/api/doc?project=${encodeURIComponent(project)}&path=${encodeURIComponent(resource.path)}`
        );
        if (request !== generation) return;
        if (!ok) {
          showBroken(
            resource,
            basename(resource.path),
            status === 404
              ? "this note doesn't exist yet — broken links are legal here"
              : "this link can't be opened from this project",
            request
          );
          return;
        }
        const parsed = splitFrontmatter(body.markdown);
        const heading = parsed.body.match(/^#\s+(.+)$/m);
        markdownBody = parsed.body;
        title = body.frontmatterTitle
          || (heading ? heading[1].trim() : basename(resource.path).replace(/\.md$/i, ""));
        priority = parsed.meta.priority || null;
        tags = parseTags(parsed.meta.tags);
      } else {
        const { ok, status, body } = await fetchJSON(
          `/api/task?project=${encodeURIComponent(project)}&id=${encodeURIComponent(resource.id)}`
        );
        if (request !== generation) return;
        if (!ok) {
          showBroken(resource, taskUri(resource.id), taskMessage(status, body), request);
          return;
        }
        markdownBody = body.markdown;
        title = body.title || body.key || taskUri(resource.id);
        priority = body.priority || null;
        tags = Array.isArray(body.tags) ? body.tags : [];
      }

      renderChips(elements, escapeHTML, priority, tags);

      const currentKey = resourceKey(resource);
      const previousScroll = elements.body.scrollTop;
      elements.title.textContent = title;
      elements.body.replaceChildren(sanitizeMarkdownHTML(marked.parse(markdownBody)));
      elements.body.scrollTop = currentKey === lastKey ? previousScroll : 0;
      lastKey = currentKey;
      lastResource = resource;

      const documentDir = dirname(markdownPath);
      for (const image of elements.body.querySelectorAll("img")) {
        const src = image.getAttribute("src") || "";
        if (/^https?:/i.test(src)) continue;
        const resolved = resolvePath(src, documentDir);
        if (resolved) image.src = rawUrl(project, resolved);
      }
      for (const responsiveImage of elements.body.querySelectorAll("img[srcset], picture source[srcset]")) {
        responsiveImage.setAttribute(
          "srcset",
          rewriteSrcset(project, responsiveImage.getAttribute("srcset") || "", documentDir)
        );
      }
    }

    function open(resource) {
      const next = normalizeResource(resource);
      if (!next) {
        throw new TypeError("documentReader.open requires an explicit document or task resource.");
      }
      stack = [];
      show(next, true);
    }

    function goBack() {
      if (stack.length <= 1) return;
      stack.pop();
      show(stack[stack.length - 1], false);
    }

    function refresh() {
      if (stack.length) show(stack[stack.length - 1], false);
    }

    elements.body.addEventListener("click", (event) => {
      const anchor = event.target.closest("a");
      if (!anchor || !elements.body.contains(anchor)) return;
      const href = anchor.getAttribute("href") || "";
      const task = taskTarget(href);
      if (task) {
        event.preventDefault();
        show(task, true);
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        window.open(href, "_blank", "noopener");
        return;
      }
      if (href.startsWith("#") || /^mailto:/i.test(href)) return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
      event.preventDefault();
      const current = lastResource || stack[stack.length - 1];
      if (!current) return;
      const resolved = resolvePath(href, dirname(currentMarkdownPath(current)));
      if (!resolved) return;
      if (/\.md$/i.test(resolved)) show({ kind: "document", path: resolved }, true);
      else window.open(rawUrl(getProject(), resolved), "_blank", "noopener");
    });

    elements.backButton.addEventListener("click", goBack);
    elements.closeButton.addEventListener("click", close);
    elements.overlay.addEventListener("click", (event) => {
      if (event.target === elements.overlay) close();
    });

    return Object.freeze({
      close,
      isOpen() {
        return !elements.overlay.classList.contains("hidden");
      },
      open,
      refresh,
    });
  }

  window.documentReader = Object.freeze({ create });
}());
