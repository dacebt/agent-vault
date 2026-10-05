---
name: bootstrap
description: >-
  Set up a project's Agent Vault for knowledge, tasks, journals, and handoffs.
  Use to initialize project tracking or supply missing storage for another vault skill,
  with optional initial context from the project.
---

# agent-vault:bootstrap

Establish a usable home for this project's records. An empty knowledge layer is a
valid starting point: setup does not depend on having code, established conventions,
or an architecture to document. A request for storage, including one from another
vault skill, is complete when the scaffold is usable; return to the calling work.

Match initial content to the request and available evidence. Preserve existing
records on repeat setup. Bootstrap writes to the vault, not the source project,
and does not invent tasks, decisions, conventions, or links to fill a structure.

## Operating map

- Establish storage with the bundled helpers below.
- When the request includes initial project knowledge, use [capture](../capture/SKILL.md)
  for its writing guidance, templates, and connections. Read those resources only
  for content being written.
- Verify the actual result, preserve it, and report what changed.

## Establish storage

Resolve the plugin root from this loaded `SKILL.md`: two directories above
`skills/bootstrap/`. Helper paths below are relative to that root; use quoted
absolute paths in commands. This works in Claude Code and Codex without requiring
an environment variable in the skill's execution context.

From the intended source project, run `bin/bootstrap-project.sh`. It resolves the
project through the existing discovery helpers and creates missing layer directories,
`tasks/tasks.sqlite3`, a starter `README.md`, and the root `index.md`. Existing files
are preserved; a repeat invocation is not a request to refresh or replace content.

For first use when the containing vault root does not exist, use its configured
absolute location (`AGENT_VAULT`, otherwise `~/agent-vault`) with
`bin/resolve-project.sh <vault-root>`, then pass the resulting project path to
`bin/bootstrap-project.sh <project-path>`. The explicit destination form creates
missing parent directories. Keep that resolved destination for the rest of the work.

Inspect the resulting scaffold, including the root index's `okf_version: "0.2"`,
and run `python3 <plugin-root>/bin/task-db.py validate <project-path>` before claiming
the full scaffold is ready. Existing legacy tasks or damaged records need an honest
report of what was created, what remains usable, and what failed; setup does not
authorize migrating, deleting, or replacing existing data.

## Initial context when useful

For a request that includes populating project knowledge, read enough relevant
project material to support the content. Let the useful information determine the
notes and their depth; there are no required topic filenames or sampling quotas.
An established project may support architectural observations and recurring patterns.
A greenfield project may supply only its intended purpose from the user's context.
Keep intended direction distinguishable from implemented behavior.

Reuse and extend relevant records through capture. A project with no established
conventions needs no conventions note. Code and commits can support observations,
but do not establish decision rationale. Recording a real decision or a requested
task follows capture's corresponding path, not an automatic bootstrap checklist.
Keep the README's identity and focus grounded in known context rather than filling
unknowns with guesses. Empty sections do not prevent using the vault.

## Preserve and report

For scaffold-only setup as well as initial content, durability-commit the exact files
created or changed with `bin/vault-commit.sh <message> <changed-file>...`. Preserve
unrelated vault changes. Confirm the commit before claiming durability; the helper
can silently skip it when Git is unavailable or the destination is not a repository.

Report the resolved vault path and the actual outcome: storage created or reused,
any context added, and any incomplete operation. Distinguish scaffold readiness from
knowledge coverage. When called by another skill, return that result so the requested
capture or handoff can continue without an extra knowledge-extraction phase.
