---
name: recall
description: >-
  Answer specific questions about prior project work, decisions, and knowledge from
  the vault. Use to recall why a choice was made, find an earlier task or note, or
  search across projects when requested. Broad project status belongs to agent-vault:orient.
---

# agent-vault:recall

Answer from records you have opened and understood. Recall is read-only and scoped
to the current project's vault records unless the user requests other projects.
Project source, external services, and the web are separate evidence surfaces;
recall does not search them. Use [orient](../orient/SKILL.md) for a broad state report.

The vault combines linked Markdown concepts with SQLite-backed tasks. Choose direct
lookup, an index, targeted search, or link traversal according to the question.
Links can expose rationale and later developments, but missing links do not prevent
an answer supported by the record itself.

## Locate the relevant material

Resolve the plugin root from this loaded `SKILL.md`: two directories above
`skills/recall/`. Helper paths below are relative to that root; use quoted absolute
paths in commands without depending on a host-specific environment variable.
Run `bin/resolve-project.sh` from the intended source checkout for its vault project;
`bin/find-vault.sh` locates the containing vault root. Check the resolved project
exists. Missing storage or a failed lookup is not evidence that the event never happened.

| Question | Useful starting point |
|---|---|
| Why a choice was made | `docs/decisions/` and its index |
| When work happened | `journal/` |
| A learning or topic | `knowledge/` and its index |
| A task or its recorded outcome | Database `list` or `show` |
| How something was documented | `docs/` |
| A known file or identifier | Open the file or task directly |

Read the [task commands](../../reference/task-commands.md) when querying tasks.
Use `python3 <plugin-root>/bin/task-db.py list <project-path>` to find records across
statuses and `show <project-path> <task>` to read a complete record. Task arguments
accept display keys, UUIDs, or `task:<uuid>` URIs. Searching Markdown cannot find
content stored only in the database.

## Follow the evidence

Use index descriptions and concept aliases when they help identify a topic. For
text search, prefer `rg` with distinctive terms in the relevant layer. Open the
matching records rather than answering from isolated search lines.

Follow relevant outgoing links or run `bin/backlinks.sh <project-path> <target>`
when the answer needs related context, dependencies, or later discussion. Use the
file's concept path or an immutable `task:<uuid>` target. For decisions, check whether
later records supersede or qualify the choice. Search again when a useful relationship
is absent; a found seed does not make further search inappropriate. Stop when the
question has adequate support, not after an obligatory traversal count.

For a filter question, use the relevant fields: decision workflow lives in
`decision_status`, concept lifecycle in `status`, and task workflow in database
`task_status`. Inspect provenance through `generated`, `verified`, `sources`, and
`stale_after`. For declared v0.1 concepts only, fall back to `timestamp` when
`generated` is absent and a legacy `# Citations` list when `sources` is absent.

If `stale_after` has passed, qualify the claim as stale. Distinguish generated but
unverified material from concepts with valid `verified` events; file age or workflow
status does not establish trust. `verified` confirms the concept definition, not
whether a particular Attested Computation run passed its attester. Declared sources
can explain provenance without establishing that they were checked in this recall.

## Cross-project questions and results

For an explicit cross-project request, search the requested projects or the whole
vault as appropriate and retain project identity in the answer. Query each relevant
project's task database when tasks may contain the evidence; whole-tree text search
alone does not cover them. Use subagents only when the active instructions permit
delegation.

Lead with the answer and cite the supporting records, quoting a short passage when
useful. Use bundle-relative Markdown links for file concepts and immutable
`task:<uuid>` links for task concepts; identify the project for cross-project results.
Distinguish recorded facts, inference, conflicting accounts, and evidence gaps.
If nothing was found, state the search coverage and result without inventing an answer
or presenting absence from the vault as proof of absence elsewhere.
