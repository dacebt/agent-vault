---
name: capture
description: >-
  Silently capture project content into the vault as a linked concept — usually a note, sometimes
  a how-to doc, decision, or task. Use when the user says "remember this", "write that down",
  "save this", "note that", "update the project docs/vault/knowledge", or just produced content
  worth finding later. The agent picks the layer and wires it into the graph — no interview. Most
  content is a note; decisions route to agent-vault:decide.
---

# agent-vault:capture

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

**Silent. Agent-driven. No interrogation.** The knowledge side of the vault is the agent's job. The user shouldn't be quizzed about layers, formats, or templates. They say "update the project docs" or "remember that" and the agent does the work — *and wires the result into the graph*.

The vault is an **OKF knowledge bundle**: a directory of markdown concepts whose value is the links between them. A concept that links to nothing is an orphan that never surfaces in recall. So capturing is two moves, not one: **write the content, then connect it.**

## Operating principle

If a piece of content has crossed your awareness this session — from the conversation, a file you read, a command output — and future-you would want to find it, write it. Pick the layer by what the content *is*, not by asking. Be wrong sometimes; the user can move files. Asking is worse than misrouting.

The kanban (`tasks/`) is the exception — that's the user's coordination layer. Don't write tasks autonomously unless the user explicitly framed something as work to do.

## Triggers — and what you do

| User says (or context implies) | You do |
|---|---|
| "Remember that…", "note that…", "save this" | Write a note in `knowledge/` (`type: note`). Group related observations into one topic file rather than scattering. |
| "Update the project docs" | Read repo + existing vault, write what's missing across `knowledge/`, `docs/`, README, and refresh affected `index.md` MOCs. Tell the user what changed. ("Refresh the vault" / "sweep for outdated info" is `agent-vault:refresh` — the verification pass.) |
| Conversation settled an architectural choice | Write the ADR — delegate to `agent-vault:decide`. |
| User explains a reference / how something works | Write a `knowledge/` note, grouped by topic. |
| User produced a how-to / structural reference about the project | Write to `docs/<topic>.md` (`type: doc`). |
| User mentions work to do — "I need to X", "add Y to the backlog" | Create a SQLite task concept in `backlog` — the only user-driven layer. |

## Routing — internal, never surfaced

| Content shape | Layer / type |
|---|---|
| Observation, learning, gotcha, reference, distilled insight | `knowledge/<topic>.md` — `type: note` |
| Choice with consequences ("we picked X over Y because Z") | `docs/decisions/ADR-NNN-<slug>.md` — `type: decision` (delegate to `agent-vault:decide`) |
| Structured how-to / architecture about the project itself | `docs/<topic>.md` — `type: doc` |
| Actionable work with a clear end state | SQLite task concept — `type: task` (only with explicit user intent) |
| Dated session memory | `journal/<YYYY-MM-DD>.md` — `type: journal` (delegate to `agent-vault:journal`) |

When content could fit two layers, default to `knowledge/` — lightest, easiest to move. Don't ask; pick.

## How to write a note (the default path)

1. Resolve vault + project. If the project subdir doesn't exist, run `agent-vault:bootstrap` first (silent setup, not a separate confirmation).
2. **Read `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md`** — the linking doctrine. It is the contract for steps 5–6; do not skip it.
3. Pick a topic filename: `knowledge/<kebab-case-topic>.md`. **Reuse an existing topic file** when the new content extends one — check `knowledge/` (and its `index.md`) for a related filename before creating a new one. Group, don't scatter.
4. Write the concept from `${AGENT_VAULT_PLUGIN_ROOT}/templates/note.md`: required `type: note` frontmatter plus `title`, a one-sentence `description`, YAML-safe kebab-case `tags`, lifecycle `status: stable`, and `generated.by`/`generated.at` (full ISO 8601 with timezone). Add `sources` when the content is materially derived from specific artifacts. If the concept is commonly called by alternate names, add them as `aliases: [name one, name two]` so future mentions resolve to it. If the file exists, append a new section under a sub-heading rather than clobbering it, and advance `generated.at` because the concept changed.
5. **Link out (gate).** Add ≥1 bundle-relative markdown link to an existing concept this builds on, explains, or contrasts with — `[token rotation](/docs/decisions/ADR-005-token-rotation.md)`. Scan what you wrote for names of existing concepts (ADR ids, other topics) and link those bare mentions too.
6. **Earn a link in (gate).** Add this note to `knowledge/index.md` (`* [title](/knowledge/<topic>.md) — <description>`), and add a return link from any concept it directly extends. A note with zero inbound links is an orphan — fix it now.
7. **Commit it for durability.** Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh "docs(vault): note <topic>" <note-file> <knowledge/index.md> [<any concept you added a return link to>]` — a scoped commit of just the files you touched (never `git add -A`, no co-author trailer, silent skip if the vault isn't a git repo or no shell is available).
8. Tell the user what you wrote and where — one sentence, not a question.

If you genuinely cannot find a single neighbour to link, that's a signal the note is mis-scoped or a hub is missing — say so; don't ship the orphan.

## Other concept paths

- For a structured project reference, render `${AGENT_VAULT_PLUGIN_ROOT}/templates/doc.md`, add it to `docs/index.md`, wire real links, and commit the doc plus every index/return-link file changed.
- For an explicitly requested task, compose its Markdown body in a temporary file and run `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py create <project-path> --key <TICKET> --title <TITLE> --description <DESCRIPTION> --priority <PRIORITY> --tags <CSV> --body-file <PATH>`. Link it to the motivating concept with `[label](/path/concept.md)` and commit `tasks/tasks.sqlite3` plus any Markdown concept that gained an incoming `task:<uuid>` link.
  - Give every task a ticket number. Query `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py list <project-path>` for the established prefix and highest number, then use the next unused number. Keep the existing width. If the project has no numbered tasks yet, choose a short uppercase prefix from the project name and begin at `001`.
  - Write `## Acceptance` as natural, free-flowing prose that gives a future agent enough context to recognize a satisfactory resolution. Preserve room for investigation, judgment, and discoveries made during the work. Include strict requirements only when they are genuine outcomes or boundaries established by the user or project; do not invent an exhaustive specification, implementation plan, validation recipe, or checkbox list.

The task command supplies the UUID identity, lifecycle default, and timestamps. Do not create task Markdown files or write the database with ad-hoc SQL.

## Updating existing vault content

When the user says "update the project docs":

1. Read what's in `<project>/` — README, `docs/`, `knowledge/`, `docs/decisions/`, the `index.md` MOCs.
2. Compare against current reality — repo file tree, README, manifest files, recent commits, conversation context.
3. Identify gaps: stale README "What this is", architecture notes that don't match the file structure, decisions discussed but not captured, notes that contradict current code, `index.md` MOCs missing new concepts.
4. Write the updates *and* refresh the affected `index.md` entries. Lead the response with what you changed; don't lead with questions.
5. Use `${AGENT_VAULT_PLUGIN_ROOT}/templates/doc.md` for new `type: doc` concepts and the task command for explicitly requested tasks, then make the scoped durability commit.

This path is **gap-filling from what you already have in hand** — repo state and session context. The systematic sweep that re-verifies existing claims against the repo ("refresh the vault", "sweep for outdated info", "is this still accurate") is `agent-vault:refresh`; a broad bring-up-to-date often wants both — refresh to find what's wrong, capture to write what's missing.

## What you don't do

- **Don't present the classifier to the user.** No "is this a note or a task?" — you decide.
- **Don't ship an orphan.** Every concept links out and earns a link in. This is the gate, not a nicety.
- **Don't use `[[wikilinks]]`.** OKF-native: standard bundle-relative markdown links (see the doctrine).
- **Don't write tasks without explicit user intent.**
- **Don't fabricate.** Capture only what was actually said or is observable in the repo.
- **Don't refuse to write because something is unclear.** Make your best call; surface uncertainty in the content (a TODO line), not back at the user.
