(function () {
  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isMarkdownPath(filePath) {
    return filePath.toLowerCase().endsWith(".md");
  }

  function entryIsValid(entry, parentPath, paths) {
    if (!isPlainObject(entry)) return false;
    if (typeof entry.name !== "string"
      || !entry.name
      || entry.name === "."
      || entry.name === ".."
      || /[\\/]/.test(entry.name)) {
      return false;
    }
    const expectedPath = parentPath === "/"
      ? `/${entry.name}`
      : `${parentPath}/${entry.name}`;
    if (entry.path !== expectedPath || paths.has(entry.path)) return false;
    paths.add(entry.path);
    if (entry.kind === "file") {
      return Number.isSafeInteger(entry.size) && entry.size >= 0;
    }
    return entry.kind === "directory"
      && Array.isArray(entry.children)
      && entry.children.every((child) => entryIsValid(child, entry.path, paths));
  }

  function isPayload(body, project) {
    if (!isPlainObject(body)
      || body.project !== project
      || !Array.isArray(body.entries)) {
      return false;
    }
    const paths = new Set();
    return body.entries.every((entry) => entryIsValid(entry, "/", paths));
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function create(options) {
    const { root, onOpenDocument } = options;
    let project = "";
    let entries = [];
    let layout = "tree";
    let currentDirectory = "/";
    let selectedPath = null;
    let directoryEntries = new Map();
    let treePanel = null;
    let browserPanel = null;
    let treeStatus = null;
    let browserFooter = null;
    let initialized = false;

    function collectDirectories(items, parentPath = "/") {
      directoryEntries.set(parentPath, items);
      for (const entry of items) {
        if (entry.kind === "directory") collectDirectories(entry.children, entry.path);
      }
    }

    function updateSelection() {
      for (const button of root.querySelectorAll("[data-file-path]")) {
        const selected = button.dataset.filePath === selectedPath;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
    }

    function showFileStatus(entry) {
      const message = isMarkdownPath(entry.path)
        ? `Opening ${entry.path} in the document reader…`
        : `Preview unavailable for ${entry.name}.`;
      if (treeStatus) treeStatus.textContent = message;
      if (browserFooter) {
        browserFooter.replaceChildren(
          element("strong", "", entry.name),
          element("span", "files-path", isMarkdownPath(entry.path) ? entry.path : message),
        );
      }
    }

    function activateFile(entry) {
      selectedPath = entry.path;
      updateSelection();
      showFileStatus(entry);
      if (isMarkdownPath(entry.path)) onOpenDocument(entry.path);
    }

    function fileButton(entry, className) {
      const button = element("button", className);
      button.type = "button";
      button.dataset.filePath = entry.path;
      button.setAttribute("aria-pressed", String(entry.path === selectedPath));
      button.append(
        element("span", `${className}-icon`, isMarkdownPath(entry.path) ? "▤" : "◫"),
        element("span", `${className}-name`, entry.name),
      );
      button.addEventListener("click", () => activateFile(entry));
      return button;
    }

    function treeDirectory(entry, openPaths) {
      const details = element("details", "file-tree-directory");
      details.dataset.directoryPath = entry.path;
      details.open = openPaths.has(entry.path) || (!initialized && entry.path === "/knowledge");
      details.append(element("summary", "file-tree-summary", `📁 ${entry.name}`));
      for (const child of entry.children) {
        details.append(child.kind === "directory"
          ? treeDirectory(child, openPaths)
          : fileButton(child, "file-tree-file"));
      }
      return details;
    }

    function renderTree(openPaths) {
      const content = element("div", "file-tree-content");
      const card = element("section", "file-tree-card");
      const rootDirectory = element("details", "file-tree-directory file-tree-root");
      rootDirectory.dataset.directoryPath = "/";
      rootDirectory.open = openPaths.has("/") || !initialized;
      rootDirectory.append(element("summary", "file-tree-summary", `📁 ${project}`));
      for (const entry of entries) {
        rootDirectory.append(entry.kind === "directory"
          ? treeDirectory(entry, openPaths)
          : fileButton(entry, "file-tree-file"));
      }
      treeStatus = element("div", "files-status", "Expand folders or choose a file.");
      treeStatus.setAttribute("aria-live", "polite");
      card.append(rootDirectory, treeStatus);
      content.append(card);
      treePanel.replaceChildren(content);
    }

    function renderBrowser() {
      const items = directoryEntries.get(currentDirectory);
      if (!items) currentDirectory = "/";
      const visibleEntries = directoryEntries.get(currentDirectory) || [];
      const header = element("header", "file-browser-head");
      const back = element("button", "file-browser-back", "←");
      back.type = "button";
      back.disabled = currentDirectory === "/";
      back.setAttribute("aria-label", "Parent folder");
      back.addEventListener("click", () => {
        currentDirectory = currentDirectory.slice(0, currentDirectory.lastIndexOf("/")) || "/";
        renderBrowser();
      });
      const breadcrumb = currentDirectory === "/"
        ? project
        : `${project} / ${currentDirectory.slice(1).replaceAll("/", " / ")}`;
      header.append(back, element("div", "file-browser-breadcrumb", breadcrumb));

      const grid = element("div", "file-browser-grid");
      for (const entry of visibleEntries) {
        const button = entry.kind === "file"
          ? fileButton(entry, "file-browser-item")
          : element("button", "file-browser-item");
        if (entry.kind === "directory") {
          button.type = "button";
          button.append(
            element("span", "file-browser-item-icon", "📁"),
            element("span", "file-browser-item-name", entry.name),
          );
          button.addEventListener("click", () => {
            currentDirectory = entry.path;
            renderBrowser();
          });
        }
        const meta = entry.kind === "directory"
          ? `${entry.children.length} ${entry.children.length === 1 ? "item" : "items"}`
          : formatSize(entry.size);
        button.append(element("span", "file-browser-item-meta", meta));
        grid.append(button);
      }

      browserFooter = element("footer", "file-browser-footer");
      browserFooter.setAttribute("aria-live", "polite");
      browserFooter.append(
        element("strong", "", `${visibleEntries.length} ${visibleEntries.length === 1 ? "item" : "items"}`),
        element("span", "files-path", "Choose a folder or file"),
      );
      browserPanel.replaceChildren(header, grid, browserFooter);
      updateSelection();
    }

    function setLayout(nextLayout) {
      layout = nextLayout;
      treePanel.hidden = layout !== "tree";
      browserPanel.hidden = layout !== "browser";
      for (const button of root.querySelectorAll("[data-file-layout]")) {
        const active = button.dataset.fileLayout === layout;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      if (layout === "browser") renderBrowser();
    }

    function render(nextProject, nextEntries) {
      const openPaths = new Set(
        [...root.querySelectorAll("details[open][data-directory-path]")]
          .map((details) => details.dataset.directoryPath),
      );
      if (project !== nextProject) {
        currentDirectory = "/";
        selectedPath = null;
        initialized = false;
      }
      project = nextProject;
      entries = nextEntries;
      directoryEntries = new Map();
      collectDirectories(entries);
      if (!directoryEntries.has(currentDirectory)) currentDirectory = "/";

      const heading = element("header", "files-head");
      const titles = element("div", "files-titles");
      titles.append(
        element("h2", "files-title", "Project files"),
        element("div", "files-path", `/${project}`),
      );
      const switcher = element("div", "file-layout-switch");
      switcher.setAttribute("role", "group");
      switcher.setAttribute("aria-label", "File layout");
      for (const [value, label] of [["tree", "☷ Tree"], ["browser", "▦ Browser"]]) {
        const button = element("button", "file-layout-button", label);
        button.type = "button";
        button.dataset.fileLayout = value;
        button.addEventListener("click", () => setLayout(value));
        switcher.append(button);
      }
      heading.append(titles, switcher);

      const content = element("div", "files-content");
      treePanel = element("div", "file-layout-panel");
      browserPanel = element("div", "file-layout-panel file-browser");
      content.append(treePanel, browserPanel);
      root.replaceChildren(heading, content);
      renderTree(openPaths);
      setLayout(layout);
      initialized = true;
    }

    return Object.freeze({ render });
  }

  window.fileExplorer = Object.freeze({ create, isPayload });
}());
