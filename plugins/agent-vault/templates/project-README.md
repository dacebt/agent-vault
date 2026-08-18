---
type: project
title: >-
  {{PROJECT_NAME}}
description: >-
  Project identity and current focus for {{PROJECT_NAME}}.
status: stable
generated:
  by: agent-vault/okf-v0.2
  at: "{{TIMESTAMP}}"
---
# {{PROJECT_NAME}}

_(created {{CREATED}} — this is the project's living north star inside Agent Vault. Keep it short; let tasks, decisions, journal, and knowledge carry the detail. Markdown OKF concepts and SQLite-backed task concepts share one graph — see `index.md` for the bundle on-ramp.)_

## What this is
_(one-paragraph answer: what is the project, who is it for, what would success look like)_

## Current focus
_(a theme or area that survives at least a sprint — not an activity log. "Shipping the v2 stack" belongs here; "just shipped commit abc123" belongs in journal/. Open questions and to-dos belong in tasks/ or knowledge/, not here.)_

## Index
- `index.md` — OKF bundle root (declares `okf_version`, links the layers below)
- `tasks/tasks.sqlite3` — authoritative SQLite task concepts; access through `task-db.py` or a compatible viewer
- `knowledge/` — curated notes, references, learnings (second-brain layer; `knowledge/index.md` is its MOC)
- `docs/decisions/` — ADRs, the *why* of structural choices (`type: decision`)
- `docs/` — how-to references, architecture (`type: doc`)
- `journal/` — dated entries; narrative thread connecting sessions (`type: journal`)
- `handoffs/` — resume-points for unfinished work (`type: handoff`)
- `views/` — generated HTML dashboards (regenerated via agent-vault:render — do not edit by hand)
