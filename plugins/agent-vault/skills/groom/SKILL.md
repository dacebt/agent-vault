---
name: groom
description: >-
  Lifecycle hygiene pass on the vault — surfaces stale in-progress tasks, tasks missing acceptance
  prose, done tasks missing outcome notes, ADRs stuck in proposed, orphan docs, and spent
  handoffs. Use when the user wants to "clean up the vault", "tidy", "check what's stale", "review
  WIP", "audit project state", or "groom the board". Checks task/decision/handoff hygiene, not the
  link graph — that's agent-vault:weave.
---

# agent-vault:groom

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

Surface hygiene problems in the project's vault. Read-only by default — proposes specific actions, doesn't take them.

## When to use

- User asks to "clean up", "tidy", "groom the board", "audit the vault", "what's stale"
- Periodically (e.g., end of week or between work units) as a deliberate pass
- When you notice the vault is starting to feel cluttered or out of sync with reality

## What to check

Pull from `vault-index.sh --full` plus targeted scans:

1. **Stale in-progress** — any database task in `in-progress` or `blocked` whose `generated_at` is 7+ days old. Either record the blocker or complete it with an honest outcome.

2. **WIP creep** — more than 2 in-progress tasks. Flag and propose narrowing.

3. **Todo without acceptance** — `todo` tasks whose stored Markdown body lacks meaningful `## Acceptance` prose.

4. **Done without outcome** — `done` tasks whose stored Markdown body lacks outcome notes.

5. **Long-lived proposed ADRs** — ADRs with `decision_status: proposed` and OKF lifecycle `status: draft` older than 14 days. Either they've been quietly enacted (set `decision_status: accepted`, `status: stable`) or abandoned (set `decision_status: rejected`, `status: deprecated`, with a one-line reason).

6. **Orphan docs** — files in `docs/` (excluding `decisions/`) that aren't referenced by any task, ADR, or journal entry. Maybe still useful, maybe not — flag for review.

7. **Empty backlog** — if the database backlog has been empty for a while, the project may be coasting on momentum without thinking ahead. Just observation, no required action.

8. **Spent handoffs** — flag a live handoff that links a `task:<uuid>` now in `done`, duplicates another live handoff for the same unit, or is older than 14 days with no matching active task. Retire it with `${AGENT_VAULT_PLUGIN_ROOT}/bin/mark-handoff-spent.sh`; don't delete history.

9. **Uncommitted vault (durability floor)** — the vault is a git repo, but an external brain that was never committed can't be restored. Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-uncommitted.sh <project-path>` — it lists changes left uncommitted for 3+ days (fresh edits are fine; days-old dirty state is the smell). Anything it prints is a finding: surface it and offer to commit it (the write skills commit as they go, so a backlog here means content written before this discipline existed, edits made outside the skills, or a stalled session). Empty output means the vault is clean or not a git repo — nothing to flag.

## Graph health is a separate pass

Groom checks **lifecycle hygiene** — stale WIP, missing acceptance, dangling ADRs, spent handoffs. It does **not** check the link graph (orphan concepts, broken links, missing `index.md` MOCs, unlinked mentions). That's `agent-vault:weave`'s job. When doing a thorough tidy, run weave alongside groom — lifecycle hygiene keeps the *board* honest; weave keeps the *brain* traversable. If the user says "clean up the whole vault," do both and present the findings together.

## How to present findings

Group by severity / actionability:

```
**Needs attention now:**
- task `auth-refactor` is in-progress and untouched 11d — block it or close it
- ADR-003 still proposed after 21d — enact or reject

**Worth a pass:**
- 3 todo tasks missing acceptance prose — clarify before starting
- README current-focus hasn't changed in 14d while 4 tasks closed — update?
- handoff `2026-05-20-0900` links a task URI now in `done` — mark it spent so SessionStart stops surfacing it

**Just noticing:**
- backlog has been empty 7d
- 2 orphan docs in docs/
```

Propose specific actions ("move X to done with outcome `...`"). Wait for the user to confirm before doing — grooming is the user's call, not yours.

## What it does NOT do

- Doesn't modify anything by default. Surfaces findings and proposes; the user (or `agent-vault:task-flow`) does the moves.
- Doesn't groom *across* projects. Per-project pass; cross-project portfolio grooming would be a separate skill if useful.
- Doesn't enforce a particular cadence — runs when invoked, that's it.
