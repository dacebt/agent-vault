const STATUS_ORDER = ["backlog", "todo", "in-progress", "done"];

const els = {
  ddWrap: document.getElementById("project-dd"),
  ddBtn: document.getElementById("project-btn"),
  ddLabel: document.getElementById("project-btn-label"),
  ddPanel: document.getElementById("project-panel"),
  badges: document.getElementById("count-badges"),
  connDot: document.getElementById("conn-dot"),
  boardViewBtn: document.getElementById("board-view-btn"),
  graphViewBtn: document.getElementById("graph-view-btn"),
  board: document.getElementById("board"),
  graph: document.getElementById("graph"),
  overlay: document.getElementById("modal-overlay"),
  modalBack: document.getElementById("modal-back"),
  modalClose: document.getElementById("modal-close"),
  modalTitle: document.getElementById("modal-title"),
  modalPath: document.getElementById("modal-path"),
  modalChips: document.getElementById("modal-chips"),
  modalBody: document.getElementById("modal-body"),
};

let projects = [];
let currentProject = null;
let projectsGen = 0;
let contentGen = 0;
let currentView = "board";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function tiltFor(path) {
  const h = hashStr(path);
  return (((h % 100) / 100) * 5 - 2.5).toFixed(2) + "deg";
}

function prettyStatus(status) {
  return status.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function projectCounts(project) {
  return project && project.counts && typeof project.counts === "object" ? project.counts : null;
}

function projectError(body, fallback) {
  if (body && body.error && typeof body.error.message === "string" && body.error.message) {
    return body.error.message;
  }
  return fallback;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

const reader = window.documentReader.create({
  elements: {
    overlay: els.overlay,
    backButton: els.modalBack,
    closeButton: els.modalClose,
    title: els.modalTitle,
    path: els.modalPath,
    chips: els.modalChips,
    body: els.modalBody,
  },
  getProject: () => currentProject,
  fetchJSON,
  escapeHTML: esc,
});

const picker = window.projectPicker.create({
  elements: {
    wrapper: els.ddWrap,
    button: els.ddBtn,
    label: els.ddLabel,
    panel: els.ddPanel,
  },
  escapeHTML: esc,
  projectTotal(project) {
    const counts = projectCounts(project);
    if (!counts) return 0;
    return STATUS_ORDER
      .filter((status) => status !== "done")
      .reduce((total, status) => total + (typeof counts[status] === "number" ? counts[status] : 0), 0);
  },
  onChoose(name) {
    if (!projectSelection.isAllowed(projects, name)) return;
    projectSelection.push(name);
    if (name !== currentProject) applySelection(name);
  },
});

function contentRequest() {
  return ++contentGen;
}

function contentMatches(gen, project, view) {
  return gen === contentGen && project === currentProject && view === currentView;
}

function renderViewState() {
  const boardActive = currentView === "board";
  els.board.classList.toggle("hidden", !boardActive);
  els.graph.classList.toggle("hidden", boardActive);
  els.boardViewBtn.classList.toggle("active", boardActive);
  els.graphViewBtn.classList.toggle("active", !boardActive);
  els.boardViewBtn.setAttribute("aria-pressed", String(boardActive));
  els.graphViewBtn.setAttribute("aria-pressed", String(!boardActive));
  els.boardViewBtn.disabled = !currentProject;
  els.graphViewBtn.disabled = !currentProject;
}

function renderContentMessage(message) {
  els.board.replaceChildren();
  els.graph.replaceChildren();
  const target = currentView === "board" ? els.board : els.graph;
  target.innerHTML = `<div class="${currentView === "board" ? "board-note" : "graph-note"}">${esc(message)}</div>`;
}

async function applySelection(name, gen = contentRequest()) {
  if (gen !== contentGen) return;
  const prevProject = currentProject;
  currentProject = name;
  if (currentProject !== prevProject) {
    els.board.replaceChildren();
    els.graph.replaceChildren();
    if (prevProject !== null) reader.close();
  }
  picker.update(projects, currentProject);
  renderBadges();
  renderViewState();
  if (currentProject) {
    await loadCurrentProjection(currentProject, currentView, gen);
  } else {
    renderContentMessage("No projects with a tasks/tasks.sqlite3 database found in this vault.");
  }
}

async function loadProjects(contentToken = contentRequest()) {
  const gen = ++projectsGen;
  const { ok, body } = await fetchJSON("/api/projects");
  if (gen !== projectsGen || contentToken !== contentGen) return;
  if (!ok || !body || !Array.isArray(body.projects)) {
    renderContentMessage("Could not reach the vault server.");
    return;
  }
  projects = body.projects;
  await applySelection(projectSelection.resolve(projects), contentToken);
}

function renderBadges() {
  const proj = projects.find((p) => p.name === currentProject);
  if (!proj) { els.badges.innerHTML = ""; return; }
  const counts = projectCounts(proj);
  if (!counts) { els.badges.innerHTML = ""; return; }
  els.badges.innerHTML = STATUS_ORDER
    .filter((s) => typeof counts[s] === "number")
    .map((s) => `<span class="count-badge s-${esc(s)}">${esc(prettyStatus(s))} ${counts[s]}</span>`)
    .join("");
}

async function loadCurrentProjection(project, view, gen) {
  if (view === "graph") await loadGraph(project, view, gen);
  else await loadBoard(project, view, gen);
}

async function loadBoard(project, view, gen) {
  const { ok, status, body } = await fetchJSON(`/api/board?project=${encodeURIComponent(project)}`);
  if (!contentMatches(gen, project, view)) return;
  if (!ok) {
    const message = status === 404
      ? "Unknown project."
      : status === 422
        ? projectError(body, "Could not load the board.")
        : "Could not load the board.";
    els.board.innerHTML = `<div class="board-note">${esc(message)}</div>`;
    return;
  }
  const boardScroll = els.board.scrollLeft;
  const colScroll = new Map();
  for (const col of els.board.querySelectorAll(".column")) {
    colScroll.set(col.dataset.status, col.scrollTop);
  }
  els.board.innerHTML = body.statuses.map(renderColumn).join("");
  els.board.scrollLeft = boardScroll;
  for (const col of els.board.querySelectorAll(".column")) {
    if (colScroll.has(col.dataset.status)) col.scrollTop = colScroll.get(col.dataset.status);
  }
}

async function loadGraph(project, view, gen) {
  if (!els.graph.querySelector(".graph-stage")) {
    els.graph.innerHTML = '<div class="graph-note">Loading graph…</div>';
  }
  const { ok, status, body } = await fetchJSON(`/api/graph?project=${encodeURIComponent(project)}`);
  if (!contentMatches(gen, project, view)) return;
  if (!ok) {
    const message = status === 404
      ? "Unknown project."
      : status === 422
        ? projectError(body, "Could not load the graph.")
        : "Could not load the graph.";
    els.graph.innerHTML = `<div class="graph-note">${esc(message)}</div>`;
    return;
  }
  if (!window.graphSchema.isPayload(body, project)) {
    els.graph.innerHTML = '<div class="graph-note">Could not load the graph.</div>';
    return;
  }
  window.graphView.render(els.graph, body, {
    onActivate(resource) {
      if (!contentMatches(gen, project, view)) return;
      reader.open(resource);
    },
  });
}

function setView(view) {
  if (!currentProject || view === currentView || (view !== "board" && view !== "graph")) return;
  const gen = contentRequest();
  currentView = view;
  renderViewState();
  loadCurrentProjection(currentProject, currentView, gen);
}

function renderColumn(col) {
  const cards = col.tasks.map((t) => renderCard(t, col.status)).join("");
  return `
    <section class="column" data-status="${esc(col.status)}">
      <div class="column-head">
        <span class="column-title">${esc(prettyStatus(col.status))}</span>
        <span class="column-count">${col.tasks.length}</span>
      </div>
      <div class="cards">${cards || '<div class="empty-hint">nothing pinned here</div>'}</div>
    </section>`;
}

function renderCard(task, status) {
  const blocked = task.blocked === true;
  const keyBadge = task.key ? `<span class="card-key">${esc(task.key)}</span>` : "";
  const meta = [];
  if (task.priority) {
    meta.push(`<span class="card-priority p-${esc(task.priority.toLowerCase())}">${esc(task.priority)}</span>`);
  }
  if (blocked) meta.push('<span class="card-flag" aria-label="Blocked task">Blocked</span>');
  return `
    <button
      class="card s-${esc(status)}${blocked ? " is-blocked" : ""}"
      style="--tilt:${tiltFor(task.uri)}"
      data-task-id="${esc(task.id)}"
      data-task-uri="${esc(task.uri)}"
      data-task-resource="${esc(task.uri)}"
    >
      ${keyBadge}
      <div class="card-title">${esc(task.title)}</div>
      ${meta.length ? `<div class="card-meta">${meta.join("")}</div>` : ""}
    </button>`;
}

els.board.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  if (!card.dataset.taskId) return;
  reader.open({ kind: "task", id: card.dataset.taskId });
});

els.boardViewBtn.addEventListener("click", () => setView("board"));
els.graphViewBtn.addEventListener("click", () => setView("graph"));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (picker.isOpen()) { picker.close(); return; }
  if (reader.isOpen()) reader.close();
});

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await loadProjects(contentRequest());
    reader.refresh();
  }, 150);
}

let esBackoff = 1000;
function connectEvents() {
  const source = new EventSource("/api/events");
  source.onopen = () => {
    esBackoff = 1000;
    els.connDot.className = "conn-dot conn-on";
    scheduleRefresh();
  };
  source.onerror = () => {
    els.connDot.className = "conn-dot conn-err";
    source.close();
    setTimeout(connectEvents, esBackoff);
    esBackoff = Math.min(esBackoff * 2, 30000);
  };
  source.onmessage = (e) => {
    let msg = null;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg && msg.type === "change") scheduleRefresh();
  };
}

window.addEventListener("popstate", () => {
  const name = projectSelection.resolve(projects);
  if (name === currentProject) return;
  applySelection(name);
});

loadProjects();
connectEvents();
