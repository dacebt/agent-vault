---
name: render
description: >-
  Build an HTML view of project state to whatever shape the user describes — kanban dashboard,
  status report, decision graph, or a custom page. Use when the user wants to see, render, build,
  generate, or open a visual view of the project, including ones they describe in their own words
  ("a page showing X grouped by Y"). Markdown and the task database are source records; views regenerate on demand.
---

# agent-vault:render

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

Agent-built HTML views of vault state. **There is no fixed catalog of views** — the agent assembles whatever shape the user describes. Two common shapes (dashboard, status) are documented below as references the agent can adapt, but a view is just "HTML + supporting files in `views/<name>/`" — the user can ask for any layout, comparison, dashboard, report, or visualization, and the agent builds it.

## Layout — always a directory

Every view is a directory under `<project>/views/`:

```
views/
├── dashboard/
│   ├── index.html        # entry point — opens in browser
│   └── data.js           # optional: structured data as window.DATA, loaded via <script src>
├── status/
│   └── index.html        # single-file view, no data file
├── decisions-graph/
│   ├── index.html
│   ├── data.js
│   └── style.css         # whatever the view needs
└── <custom-view>/
    └── index.html
```

The directory pattern is uniform whether the view is one file or twenty. Open `views/<name>/index.html` in a browser.

## How to build a view

1. **Read what the view needs.** Query tasks with `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py list <project>` and read Markdown concepts in `knowledge/`, `docs/decisions/`, `journal/`, and README. `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-index.sh <project> --full` provides a combined summary.
2. **Decide the shape.** Single file or multi-file? Embedded CSS or separate `style.css`? Pick based on view complexity. Small views: a single `index.html` with embedded CSS and any data inlined. Larger/data-heavy: keep the data in a separate **`data.js`** that assigns `window.DATA = {...}`, pulled in with `<script src="data.js"></script>` before the render script. Do **not** `fetch()` a `data.json` (see the file:// note below).
3. **Write the files** with Write. Lead with `index.html`; add supporting files as needed.
4. **Tell the user the path** (`<project>/views/<name>/index.html`) and how to open it (`open <path>` on macOS, drag-into-browser elsewhere). One line, not a question.

The agent is the renderer. There is no `bin/render-view.sh` to dispatch into — the skill *is* the contract.

### Data loading — the `file://` constraint (load-bearing)

Views open directly from disk — `open <path>`, a `file://` URL, no server. That dictates how data reaches the page:

- **Put data in a `data.js`** that sets `window.DATA = {...}`, loaded via `<script src="data.js"></script>` before your render script — or inline the data in a `<script>` tag. Both load fine from `file://` and keep data separate from markup.
- **Never `fetch()` (or `XMLHttpRequest`) a sibling `data.json` from a file-opened view.** The page origin is `null`, so the browser blocks the request (`TypeError: Failed to fetch`) and the view renders **blank**. This is the single most common way a generated view silently breaks.
- **`data.json` is viable only when the directory is served over HTTP** — e.g. `cd views/<name> && python3 -m http.server`, then open `http://localhost:8000/`. If a view genuinely needs `fetch`/`data.json` (streaming, large data), build it that way *and* tell the user the serve command, since plain `open <path>` will not work for it. Otherwise prefer `data.js` so the documented `open <path>` path just works.

## Two reference shapes

These are starting points the agent can use directly when the user just says "render the dashboard" or "show me a status page," and reference patterns for custom views.

### Reference: dashboard (kanban)

Dark theme, 4 columns (backlog / todo / in-progress / done). Each task renders as a card with display key, title, and priority; blocked tasks are distinct within in-progress. Pull from `task-db.py list`.

Reasonable inline shape: embedded CSS, no JS, single `index.html`. Generate the kanban HTML by grouping task JSON by workflow status.

### Reference: status (shareable report)

Light theme. In-progress tasks, recently-done tasks (7-day window), and recent journal headlines. Pull tasks from SQLite and journal entries from Markdown.

Single `index.html` is fine; embedded CSS for portability.

### Reference: graph (the link graph)

The vault graph combines Markdown concepts and SQLite task concepts. Build nodes from both providers and resolve bundle-relative Markdown links plus immutable `task:<uuid>` links (or reuse `${AGENT_VAULT_PLUGIN_ROOT}/bin/backlinks.sh`). Emit the node/edge data as `data.js` (`window.DATA = {nodes, edges}`) and render it with vanilla JS and SVG or canvas.

## OKF frontmatter is queryable

Concepts carry structured OKF v0.2 frontmatter. Views may query `type`, `tags`, lifecycle `status`, `generated`, `verified`, `sources`, and `stale_after`, plus plugin workflow fields such as `decision_status`, `handoff_status`, and `task_status`. Read these fields rather than scraping prose. Never interpret workflow values as OKF lifecycle values.

When a view displays trust, derive it from the declared metadata: show provenance from `generated`/`sources`, verification from `verified`, and staleness from `stale_after`. Do not label content verified merely because it is stable or recent.

Structural validation of an `Attested Computation` contract is not runtime attestation. If a view displays a computed result, show the declared executor, receipt, attester outcome, and `stale_after` state when those values are available; do not turn those metadata fields into a prerequisite for rendering the view.

## Custom views — agent judgment

When the user describes a view in their own words ("a page showing all decisions grouped by tag," "a comparison view of in-progress tasks with their commit trails," "a knowledge index by topic"), the agent assembles it from scratch:

1. Identify what vault content the view needs.
2. Pick a directory name (kebab-case, describing what the view shows).
3. Read the relevant files.
4. Choose a presentation — table, cards, list, two-column layout, etc.
5. Write `views/<name>/index.html` with embedded CSS, optionally a `data.js` (`window.DATA`) + JS if dynamic interaction is wanted (sliders, filters, sort). Inline data via `data.js`/`<script>`, never a `fetch()`ed `data.json` (blocked from `file://`).
6. If the view benefits from interaction (toggle filters, search, fold/unfold), include vanilla JS inline or as `<view-name>.js`. No frameworks, no build step — single-page HTML opens directly in any browser.

The bar for "this view is good": opens in a browser, accurately reflects current vault state, the user can grasp what they're looking at without explanation.

## What a view shows vs. doesn't

Views are *current state* snapshots derived from Markdown and SQLite. By default they don't include:
- Full task bodies (cards typically show display key + title; use `task-db.py show` or a compatible viewer for the database concept)
- Full ADR bodies (links or short summaries; depth lives in markdown)
- Full journal bodies (headlines or first lines)

This is convention, not rule. If the user asks for a view that includes full bodies, build it.

## Never edit a view by hand

Views are regenerated. Anything edited inside `views/<name>/` will be clobbered the next time the view is rendered. If a user wants to customize a view permanently, the customization belongs in the agent's instructions for building that view (which the agent can record as a knowledge note: `knowledge/views-<name>-spec.md`).

## What it does NOT do

- Doesn't mutate task rows while rendering. Use the task command for writes.
- Doesn't auto-regenerate. Views are stale until re-rendered.
