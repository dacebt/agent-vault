---
name: groom
description: >-
  Review a project's vault for stale work, unclear task context, unresolved decisions,
  and spent handoffs. Use to groom the board, check what's stale, or tidy project records.
  Surfaces lifecycle findings; graph maintenance belongs to agent-vault:weave.
---

# agent-vault:groom

Keep project records useful for deciding what to do next. A grooming request produces
findings and proposed actions by default. Carry out repairs the user has requested or
already authorized within that scope; do not ask them to approve the same action again.
An observation about age, missing prose, or workload does not itself authorize a change.

Groom reviews lifecycle and relevance. [Weave](../weave/SKILL.md) reviews graph navigation;
use both when the user requests a whole-vault tidy. Neither review is a prerequisite for
a requested task move or record edit, and neither imposes a maintenance cadence.

## Locate the project and evidence

Resolve the plugin root from this loaded `SKILL.md`: two directories above
`skills/groom/`. Helper paths below are relative to that root; use quoted absolute
paths in commands rather than depending on a host-specific environment variable.

Run `bin/resolve-project.sh` from the intended source checkout to locate its vault
project; `bin/find-vault.sh` resolves the containing vault root. Run
`bin/vault-index.sh <project-path> --full`, then inspect the relevant records through
targeted reads and the [task commands](../../reference/task-commands.md). Keep the
review within this project. A missing vault is a finding, not a request to create one.

## Review lifecycle signals in context

Use the project's pace, current request, and record contents to decide which signals
matter. Age and counts help prioritize inspection; they do not prove neglect.

- **Stale active work:** inspect `in-progress` and `blocked` tasks whose `generated_at`
  suggests a long pause. Check whether their state still describes the work and propose
  a supported update when it does not.
- **Competing work:** consider whether active tasks obscure the current focus. Parallel
  work can be intentional; there is no universal WIP limit.
- **Missing task context:** identify acceptance or outcome information whose absence
  makes a task hard to understand. These are opportunities to clarify, not prerequisites
  for starting, completing, or otherwise moving a task. Do not invent missing outcomes.
- **Unresolved decisions:** inspect long-lived proposed ADRs for evidence that a choice
  remains open, was settled, or was abandoned. Age or implementation alone does not
  establish decision intent. Propose a state update only when supported.
- **Documents with unclear current use:** inspect records whose purpose or relation to
  current work is unclear. Missing task or journal links do not make a document useless;
  graph connectivity is a separate question for weave.
- **Backlog relevance:** mention an empty or stale backlog only when it helps the user's
  current planning. There is no requirement to keep future work queued.
- **Spent handoffs:** check whether a live resume point was completed, superseded, or
  duplicated. A linked task now marked `done`, an older date, or no active task is a
  reason to inspect the handoff, not automatic proof that all its work is finished.
- **Uncommitted records:** surface project changes that appear to have missed a durability
  commit, preserving work owned by other sessions. `bin/vault-uncommitted.sh <project-path>`
  lists older dirty files and deletions across the containing Git repository; use it only
  when that repository is confined to the intended project. In a shared vault repository,
  inspect Git changes scoped to the project instead. Empty helper output can also mean
  recent dirty files or a non-Git destination; it does not prove a clean vault.

## Apply authorized repairs through their owners

Use the [task commands](../../reference/task-commands.md) for requested task changes.
Moves have no acceptance, outcome, blocker-note, link, or active-task-count prerequisite.
Moving a card does not assert that its original scope was implemented.

For decision changes, follow [capture](../capture/SKILL.md) and its
[decision guidance](../capture/references/decisions.md). Keep supported decision intent
and historical reasoning distinct from observations about the implementation.

Retire a confirmed spent handoff with
`bin/mark-handoff-spent.sh <project-path> <handoff-id>`. It preserves the body and marks
the record spent so SessionStart no longer lists it. Preserve history rather than
deleting records as a tidying shortcut.

Inspect the changed record or task to verify the requested result and preserved content.
Durability-commit only the exact files changed with
`bin/vault-commit.sh <message> <changed-file>...` when the owning write path has not already
done so. Confirm the result before claiming durability; the helper can silently skip a
commit. An audit alone creates no changes to commit.

## Report the useful findings

Group findings by consequence and actionability. Give the record, supporting evidence,
why it matters, and a specific proposed action. Separate uncertain observations from
confirmed stale state, and report any authorized changes and their verification.
Leave unrequested changes as proposals without turning routine findings into gates.
