---
name: capture
description: >-
  Save or update project knowledge, references, decisions, and tasks in the vault.
  Use for remembering findings, recording a choice or ADR, adding work to the backlog,
  or updating project documentation from information already in hand.
---

# agent-vault:capture

Preserve information future work can use, in the appropriate existing home. Choose the
record from the content and the user's intent without interviewing them about vault
layers. Useful observations can become notes; real choices become decision records.
Tasks belong to the user's coordination layer and require explicit intent to create work.

Capture writes from supported conversation material and observations. It does not turn
an unsettled discussion into an accepted decision or invent rationale from code and
commits. Reuse a relevant topic or record instead of scattering duplicates. Preserve
uncertainty where evidence is incomplete.

## Choose the record and load its guidance

Read the matching reference before writing; load only the detail the request needs.
Templates supply record structure, not evidence to fill missing content.

| Content or request | Destination and required reading |
|---|---|
| Observation, learning, or useful project knowledge | `knowledge/`; [notes and documents](references/notes-and-documents.md) |
| How-to, project reference, or update to existing documentation | `docs/`, README, or the existing topic; [notes and documents](references/notes-and-documents.md) |
| A choice and its rationale, a requested ADR, or a replacement decision | `docs/decisions/`; [decisions](references/decisions.md) |
| Explicitly requested task creation or task-content update | SQLite task store; [tasks](references/tasks.md) |
| Dated account of work performed | Use [journal](../journal/SKILL.md) |
| Resume point for unfinished work | Use [handoff](../handoff/SKILL.md) |

Journal and handoff retain their own writing contracts. Using another skill means
reading and following it, not spawning an agent. A simple task status change uses the
[task commands](../../reference/task-commands.md) directly; capture adds no prerequisite.
A systematic check of existing claims belongs to [refresh](../refresh/SKILL.md), while
capture's update path incorporates evidence already established in the current work.

## Locate the resources

Resolve the plugin root from this loaded `SKILL.md`: it is two directories above
`skills/capture/`. Relative links here resolve from their containing file in either
Claude Code or Codex; do not depend on a host-specific environment variable.

Run `bin/resolve-project.sh` from the source checkout to locate the vault project.
`bin/find-vault.sh` resolves the containing root. If the project has not been scaffolded,
use [bootstrap](../bootstrap/SKILL.md) before writing records. Helper paths below are
relative to the resolved plugin root; pass absolute paths and quote shell arguments.

## Connect and preserve the result

For notes, documents, and decisions, read the [linking doctrine](../../reference/linking.md)
and connect real relationships without making missing links a prerequisite for the
requested work. Directory indexes make file concepts discoverable;
tasks retain their immutable `task:<uuid>` identity and database-backed board index.

Make each changed record retrievable and keep its description, metadata, and relevant
index entries aligned. Commit the exact files changed with
`bin/vault-commit.sh <message> <changed-file>...`, including any updated indexes or
related records. Preserve unrelated changes. The helper can silently skip a commit;
confirm the result before claiming durability and report a failure without claiming success.

Tell the user what was saved and where in a brief response. Do not turn routine storage
choices into an interview or claim that recording proposed work completed that work.
