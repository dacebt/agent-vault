---
name: bootstrap
description: >-
  Scaffold the per-project Agent Vault bundle (task board, decisions, knowledge,
  journal, handoffs, views), then extract a starting graph spine from the repo — observable
  architecture, conventions, and domain concepts. Use when the user says "set up the vault",
  "initialize the project", or "start tracking this project", or when another vault skill needs
  the scaffold and it's missing. Idempotent; extraction re-runs on demand.
---

# agent-vault:bootstrap

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

Two phases: **scaffold** (silent, idempotent) and **extraction** (read the repo, write an observable, *linked* graph spine — never fabricate what isn't visible).

The product of bootstrap is an **OKF knowledge bundle**: a directory of markdown concepts wired into a graph and navigated by an agent. So extraction doesn't just dump prose — it lays a small spine of linked concepts plus the `index.md` MOCs that make them navigable.

## When to use

- User says "set up the vault" / "initialize this project" / "start tracking this".
- Another skill needs the scaffold and it isn't there.
- SessionStart preamble was absent because the project subdir didn't exist, but the user is now invoking vault behavior.

## Phase 1 — scaffold (silent)

Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/bootstrap-project.sh`. It locates the vault root (fixed location `~/agent-vault`, overridable via `AGENT_VAULT`), resolves the project name from git-root basename, creates the layer directories and `tasks/tasks.sqlite3`, writes a typed starter `README.md`, and writes the root `index.md` declaring `okf_version: "0.2"`. Existing files are left alone. If legacy task Markdown exists, bootstrap fails closed and names the migration command rather than creating a second task authority.

Before extraction, verify that `<project-path>/index.md` declares OKF v0.2 and that `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py --project <project-path> validate` succeeds. If either check fails, stop and report that the scaffold is incomplete; do not describe the project as bootstrapped.

## Phase 2 — extraction (observable only, and linked)

**The principle: write what the code shows, never what you'd have to guess.** Architecture, conventions, how things actually work — observable. Decisions, intent, options-considered — *not* observable from code; do not invent them.

Read: the repo `README.md`; the manifest (`package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / `marketplace.json` / …); `ls` + `find -maxdepth 3 -type d` for layout; 5–10 sampled files across main areas; `git log --oneline -20` for *current activity* (drives the README focus theme, NOT ADRs); any `CLAUDE.md` / top-level docs.

From those, draft the spine as **linked OKF concepts** (each `type: note`, with `title`/`description`/`tags`, lifecycle `status: stable`, and `generated.by`/`generated.at`, from `${AGENT_VAULT_PLUGIN_ROOT}/templates/note.md`). Use a full ISO 8601 timestamp with timezone and keep tags to YAML-safe kebab-case strings. Add `sources` when a note is materially derived from specific repo artifacts. Read `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md` first — the spine's value is the links between its concepts.

### `knowledge/architecture.md`
The observable architecture: top-level layout (what's under each main directory), how the pieces compose (manifests, entry points, module shapes), languages/frameworks/build tooling, integration boundaries. **Descriptive, not opinionated** — record *what* is structured, not *why* (that's a decision). Link out to `conventions.md` and to any subsystem notes you write.

### `knowledge/conventions.md`
Patterns visible across multiple files: filename patterns, import/module/function shapes (form, not substance), test framework + placement, where docs live, recurring domain vocabulary. If a convention isn't visible across several files, it isn't a convention — don't claim it. Link to `architecture.md`.

### Domain-concept notes (the spine that matters)
If the repo has distinct domain entities or subsystems worth their own node (a core abstraction, a custom DSL, a non-obvious integration), draft one short note per such concept and **link them to each other and to architecture.md** — this is what turns flat documentation into a navigable graph. Cap at 2–3 for the first pass; the user can ask for more. Prefer a few well-linked concept notes over one long undifferentiated prose dump.

### `index.md` MOCs
Write `knowledge/index.md` listing every note you drafted (one entry each, using its `description`), from `${AGENT_VAULT_PLUGIN_ROOT}/templates/index.md`. Leave `docs/decisions/index.md` to be created when the first ADR lands. The root `index.md` already exists from Phase 1.

### `README.md` — fill the identity section
- `## What this is` — one paragraph from the repo README + structure.
- `## Current focus` — a *theme* from clustering recent commit subjects ("hardening validation gates"), not "just shipped commit X" (that's journal). If a section is genuinely uninferrable, leave the placeholder and mention the gap.

## What this phase does NOT do

- **Does not generate ADRs.** Commits show *what* changed; ADRs document *why* and what alternatives were rejected — the agent cannot reconstruct intent from git log. ADRs come from `agent-vault:decide` when real decisions are made.
- **Does not fabricate** decision workflow state, decision dates, or "options considered." Standard template lifecycle metadata is not evidence about a historical decision.
- **Does not write tasks autonomously** — the user's coordination layer needs explicit intent.
- **Does not leave the spine unlinked or unindexed** — a pile of disconnected notes is not a bundle. Link them; index them.
- **Does not use `[[wikilinks]]`** — OKF-native markdown links.
- **Does not modify the project's source repo.**

## Completion

After extraction, durability-commit the exact files written with `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh`.

## Reporting back

Tell the user **what you wrote, not what you want to ask**:

> Vault scaffolded for `<project>` as an Agent Vault OKF v0.2 bundle with a SQLite task store. Drafted `knowledge/architecture.md`, `knowledge/conventions.md`, `<N>` concept notes, the `knowledge/index.md` MOC, and the README identity — all linked, from repo state. Review the drafts in the bundle or a compatible viewer; they are observations, not final.

Then stop.
