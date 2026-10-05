---
name: orient
description: >-
  Summarize a project's recorded vault state for orientation, resuming context, or a
  shareable status report. Use for "where are we", "what was I working on", or a
  standup. For a specific question about prior work or a decision, use agent-vault:recall.
---

# agent-vault:orient

Give the user a grounded picture of the project's state from its tasks, knowledge,
decisions, journal, handoffs, and README. Orientation is read-only: it does not move
tasks, spend handoffs, repair links, or start the work it discovers.

Use conversational output by default, including for "give me a status". Compose a
shareable report when the user names an audience or deliverable such as a standup or
PR description. A specific historical question belongs to [recall](../recall/SKILL.md).
Match the breadth and detail to the request; a status question need not become a
vault health audit.

## Locate the records

Resolve the plugin root from this loaded `SKILL.md`: two directories above
`skills/orient/`. Helper paths below are relative to that root. Use quoted absolute
paths in commands rather than relying on a host-specific environment variable.

Run `bin/resolve-project.sh` from the intended source checkout to locate its vault
project; `bin/find-vault.sh` resolves the containing vault root. The project resolver
returns a destination even when it has not been created, so check that it exists.
For missing storage, explain that the project is not tracked and offer
[bootstrap](../bootstrap/SKILL.md). Do not create storage during orientation. Report
a resolution or database failure as such, rather than presenting it as an empty board.

The SessionStart preamble is a resource map with a recent journal excerpt and up to
three handoff references. It helps locate context; it is not a full status report
or an instruction to resume whichever record is newest.

## Read for the requested picture

- For broad orientation, run `bin/vault-index.sh <project-path> --full`. It lists
  in-progress, blocked, todo, and backlog tasks, done tasks from the last 14 days, and
  recent journal, handoff, decision, and knowledge records. This is an entry point,
  not every record or a complete account of each task.
- Read the README's project identity, current focus, and open questions. Read the
  relevant records behind index entries when their details affect the summary.
- Tasks live in `tasks/tasks.sqlite3`. Use the existing
  [task commands](../../reference/task-commands.md) for `list` and `show` when you
  need another time range, task bodies, or recorded commit links. A task's status
  alone does not establish what was delivered.
- For resume context, choose the handoff whose subject matches the requested work
  and read it in full. Use its account as dated evidence and check current relevance
  before presenting its next step as current. If it is spent or contradicted, report
  that finding; orientation does not mark it spent. The
  [handoff skill](../handoff/SKILL.md) owns handoff writing and lifecycle actions.
- Include graph shape when it helps the requested orientation. Run
  `bin/graph-audit.sh --quick <project-path>` and use its `SUMMARY:` fields for the
  headline. Findings can point to [weave](../weave/SKILL.md); they do not block the
  report or authorize repairs. Similarly, surface relevant stale-work signals
  without turning them into a [groom](../groom/SKILL.md) pass.

## Present the state

Lead with the project and a situation summary supported by the records. Organize
the rest around what the user needs to understand: current work, recorded outcomes,
recent decisions, focus, and blockers. Name gaps or conflicting records instead of
inventing progress or treating an empty knowledge layer as a failed setup.

A shareable report uses the same evidence, shaped for its audience and requested
period. Read task bodies and relevant journal or decision records before describing
outcomes. Make the reporting period clear; the index's recent windows may not match
it. Include useful next steps from recorded focus and tasks without promising work
or creating new tasks. Draft the report in the conversation unless another output
was requested; sharing it with others is a separate action.
