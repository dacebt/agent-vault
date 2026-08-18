---
name: orient
description: >-
  Print the full current state of the project's vault — tasks by status, recent
  journal/decisions/notes, graph shape, README focus — to align agent and user. Has a shareable
  mode for a standup or PR description. Use for "where are we", "what's the state", "what was I
  working on", "orient me", "pick up where we left off", "give me a status". For a specific
  past-work question ("have we decided X"), use agent-vault:recall.
---

# agent-vault:orient

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

Surface everything the agent and user need to be on the same page — across all the vault's layers, not just the task kanban. Two modes: the default **in-conversation** read, and a **shareable** report you can hand to someone else.

The vault layers:

- **Coordination** (`tasks/`) — the kanban. What to do.
- **Knowledge** (`knowledge/`) — second brain. Notes, learnings, references, navigable via `knowledge/index.md`.
- **Decisions/reference** (`docs/`, `docs/decisions/`) — ADRs and structured docs. The why and the how.

Plus the connective tissue: **journal** (dated narrative), **handoffs** (resume-points — read the latest in full via `agent-vault:handoff` when resuming), **README** (identity + focus), and the **link graph** itself.

## When to use

- "Where are we", "what's the state", "what was I working on", "pick up where we left off".
- "Give me a status", "write up where we are", "draft a standup", "PR description from this work" → use **shareable mode**.
- After a break or new session, when the SessionStart preamble's headlines aren't enough.

## Default mode — in-conversation

1. Resolve vault + project via `${AGENT_VAULT_PLUGIN_ROOT}/bin/find-vault.sh` and `resolve-project.sh`. If either fails, the project isn't tracked — offer `agent-vault:bootstrap`.
2. Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-index.sh <project-path> --full` and present the structured output — tasks (all statuses), recent journal, recent decisions, recent notes.
3. Read the project `README.md`; surface "What this is" + "Current focus" inline. Skip the static Index boilerplate.
4. **Graph shape** — a separate one-line read of the brain's connectivity. Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/graph-audit.sh --quick <project-path>` and read its machine-readable `SUMMARY:` line (concepts / orphans / dangling / legacy). Surface that headline; if graph findings exist, note that `agent-vault:weave` can fix them.
5. If any in-progress task is untouched 7+ days, flag it — a `agent-vault:groom` candidate.

Lead with the project name and a one-line situation summary the user can verify ("N in-progress, last journal X days ago, focus is Y, graph has Z orphans"). Then the structured listing by layer. Don't read out every field.

## Shareable mode — the report you hand to someone else

When the user wants something to share (a teammate, a stakeholder, a PR description, a standup), compose a terse grounded report. **Pull from the vault — never invent.**

1. **Project + one-line situation** — where we are right now.
2. **In progress** — each in-progress task, one line on where it stands (pull from the body + the auto-linked commit trail).
3. **Recently done** — last 7 days of done tasks, one line each.
4. **Recent decisions** — ADRs from the last 14 days. New decisions are progress even when nothing "completed".
5. **What's next** — README Current Focus + the next 1–2 todo tasks.
6. **Blockers** — README open questions, any `task_status: blocked` tasks.

Under one screenful unless asked for depth. **Tone: factual, terse, no adjectives** ("great progress!" adds nothing — the reader forms their own view). If the journal is sparse, the report is sparse — that's accurate, and a signal to journal more.

For a rendered/linkable version, generate HTML via `agent-vault:render` and hand over the path.

## Routing away

When an orient question is really a **recall** question ("what did I learn about X", "have I decided about Y"), don't dump the full orient — invoke `agent-vault:recall` with the specific question.

## What it does NOT do

- Doesn't modify anything. Pure read.
- Doesn't propose grooming actions (`agent-vault:groom`) or fix the graph (`agent-vault:weave`) — it surfaces signals and points at them.
- Doesn't invent achievements not recorded in the vault.
