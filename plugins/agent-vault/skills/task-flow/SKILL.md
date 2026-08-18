---
name: task-flow
description: >-
  Move a task through its lifecycle — backlog → todo → in-progress → done, plus blocking and
  reopening. Use when the user wants to start a task, pick one up, mark something done, finish,
  block, ready up a backlog item, close out work, or any phrasing about changing a task's status.
  Enforces the gates that keep the vault honest (clear acceptance before start, outcome notes
  before done). Creating tasks is agent-vault:capture.
---

# agent-vault:task-flow

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

Update SQLite-backed task concepts through the canonical task command. A task's immutable identity is `task:<uuid>`; workflow changes never move files or change links.

## Statuses

- **backlog** — captured, not committed-to. May be ideas or future work.
- **todo** — ready to pick up. Acceptance is clear enough to recognize completion.
- **in-progress** — actively being worked. Keep WIP to one or two unless the user explicitly accepts more.
- **blocked** — still active but waiting on a named dependency or decision.
- **done** — finished, with outcome notes and applicable commit SHAs.

## Transitions and their gates

The gates aren't bureaucracy — they're what makes the vault retain value six months later. Skipping a gate is fine when you have a reason, but you should pause and notice you're skipping it.

### backlog → todo (ready up)

**Gate**: the task has an `## Acceptance` section that gives a future agent enough context to recognize a satisfactory resolution. It may name genuine non-negotiable outcomes or boundaries, but it remains natural, free-flowing prose rather than an exhaustive specification, implementation plan, validation recipe, or checkbox list. Placeholder acceptance ("it works", "feels good") is a sign the task needs more thought before being committed to.

If acceptance is missing or too vague to guide judgment, *don't silently move it*. Tell the user, propose clearer prose without inventing requirements, and only move once it's agreed.

### todo → in-progress (start)

**Gate**: pick at most one or two in-progress tasks at a time. If the user is asking to start a task while several are already in-progress, surface that — either close out something, or explicitly accept the WIP cost.

The PostToolUse hook auto-links commits to the most-recently-touched in-progress task. If multiple are in-progress, that link routing gets ambiguous. Worth keeping the WIP low for that reason alone.

### in-progress → done (close)

**Gate**: the task body should have outcome notes. At minimum: what the result was, what (if anything) changed about the original acceptance, links to commits (the hook auto-appends these), links to any ADRs that came out of the work. Links to ADRs, notes, and other concepts are bundle-relative markdown links (`[token rotation](/docs/decisions/ADR-005-token-rotation.md)`), never `[[wikilinks]]` — see `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md`.

If the user says "mark it done" without outcome notes, add a short prompt: "anything to record before I close this out? what did we end up doing?"

The transition records an explicit `completed_at` timestamp.

### in-progress → blocked

Transition to `blocked` with `--note`; the command records the workflow value and appends the `## Blocked by` context. The board groups it under in-progress but surfaces it distinctly.

### done → in-progress (reopen)

Transition it back with `--note`; the command clears `completed_at` and appends a dated reopen note.

## How to perform a transition

1. Resolve vault + project.
2. List or show tasks with `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py`; resolve by UUID or display key. If a partial-title search is ambiguous, list matches and ask.
3. Verify the gate for the requested transition. If it isn't met, *talk to the user* before moving.
4. Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py transition <project-path> <task> <status>` with `--note` or `--allow-wip` only when the corresponding gate has been explicitly satisfied.
5. If moving to in-progress, briefly read the task aloud (title + acceptance + notes) so both you and the user start aligned on what "done" looks like.
6. If moving to done, confirm the outcome notes are written before the move — once it's in done, future-you will only have what's recorded.
7. Durability-commit `<project>/tasks/tasks.sqlite3` with `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh`.

## What it does NOT do

- Doesn't create tasks (`agent-vault:capture`).
- Doesn't bypass the database command with direct SQL or invent acceptance, outcome, block, or reopen prose.
- Doesn't auto-link commits — the PostToolUse hook does that.
- Doesn't groom stale tasks — that's `agent-vault:groom`.
