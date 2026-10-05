---
name: weave
description: >-
  Review and improve navigation through a vault's knowledge graph: links, indexes,
  disconnected concepts, and useful relationships. Use to audit or fix the graph,
  connect related notes, weave the vault, or build indexes. Lifecycle review belongs
  to agent-vault:groom.
---

# agent-vault:weave

Make related knowledge easier to find and traverse. Read the
[linking guidance](../../reference/linking.md) before interpreting findings or changing
links. Useful relationships matter more than link counts: a valid record can remain
unlinked, and an audit finding does not make unrelated requested work incomplete.

Match action to the request. An audit produces findings and proposed repairs. An
authorized repair or enrichment request permits supported changes within its scope,
without another approval round for the same work. Ask only where intent or scope is
unresolved. [Groom](../groom/SKILL.md) owns lifecycle review;
[capture](../capture/SKILL.md) owns writing new knowledge and decisions.

## Locate resources and inspect the graph

Resolve the plugin root from this loaded `SKILL.md`: two directories above
`skills/weave/`. Helper paths below are relative to that root; use quoted absolute
paths in commands rather than depending on a host-specific environment variable.
Run `bin/resolve-project.sh` from the intended source checkout to locate its vault
project; `bin/find-vault.sh` resolves the containing root. Keep reads and repairs
within the requested project and graph scope.

For a graph-wide pass, run `bin/graph-audit.sh <project-path>`. It reports **ORPHANS**,
**DANGLING LINKS**, **LEGACY WIKILINKS**, **MISSING INDEX**, **INDEX GAPS**, and
**UNLINKED MENTIONS**, plus a machine-readable `SUMMARY:` line. It does not edit files
or establish that every finding needs repair. Use `--quick` for intermediate triage;
it skips unlinked mentions and does not replace the initial or final full audit of a
graph-wide pass. A request about particular concepts can use focused reads and
`bin/backlinks.sh <project-path> <concept-id>` without expanding into a whole-vault audit.

Inspect findings against their source records. Distinguish confirmed breakage, useful
navigation opportunities, false positives, intentional forward links, and valid records
that need no additional links. Account for each finding within the requested scope.

Choose delegation only when the amount and independence of the work justify it.
Small passes can stay with one agent. When delegating, assign each finding and changed
path to one owner, keep connected changes together, and collect evidence and unresolved
dependencies. The main agent verifies returned dispositions and the assembled result.
An empty audit needs no verification agents.

## Interpret and repair findings

- **Orphans:** read the concept and look for useful discovery routes or real neighbours.
  Add relationships or index entries when they help retrieval. Leave valid standalone
  records alone; neither missing links nor a helper's suggested remedy requires a fix.
- **Dangling links:** verify whether the target moved, is intentionally planned, or is
  no longer relevant. Correct a known path or remove a confirmed obsolete reference
  within the repair scope. Preserve deliberate forward links. A missing target does
  not authorize creating a concept to satisfy the audit.
- **Legacy wikilinks:** resolve the intended target before converting to standard
  Markdown links. An ambiguous target needs clarification, not a guessed relationship.
- **Missing indexes and index gaps:** make useful file concepts discoverable through
  their directory index. When creating an index, use the existing
  [index template](../../templates/index.md) and supported concept descriptions. Tasks
  already have their database-backed board; chronological records have their own
  discovery routes.
- **Unlinked mentions:** confirm both the intended concept and the navigation value
  before adding a link. Naming a concept alone does not require linking every mention.

When enrichment is requested, look beyond reported breakage for relationships that
help a reader understand or continue the work. Explain each relationship in its
surrounding prose. Do not manufacture links, new content, or work to make the graph denser.

## Rename and repair moved concepts

For an authorized rename that has not happened yet, use
`bin/rename-concept.sh <project-path> <old-path> <new-path>`. The helper moves the existing
file and updates references; it requires the old file to exist and the destination to
be unused. Inspect the resulting links and any affected indexes.

When a concept has already moved, verify its current destination and repair stale
references to that destination. Do not use the rename helper as though the old file
still exists or move the record again just to repair its links. Preserve historical
meaning and report any ambiguous target instead of guessing.

## Verify, preserve, and report

Inspect the diff for intended targets, relationship meaning, and changes outside the
authorized scope. Re-read affected references and indexes after a focused repair;
after a graph-wide repair, rerun the full graph audit and reconcile its findings with
the earlier dispositions. Remaining intentional links or standalone records can be
valid outcomes. A clean audit is not proof of content truth or format conformance;
the optional format validator is a separate diagnostic, not a completion gate here.

Durability-commit only the exact files changed with
`bin/vault-commit.sh <message> <changed-file>...`, preserving unrelated changes. Confirm
the result before claiming durability; the helper can silently skip a commit. An
audit-only request creates no changes to commit. Do not delete concepts during weaving.

Report confirmed problems, useful opportunities, and intentional remaining findings
with their evidence and proposed or completed action. For repairs, include what changed
and how it was checked. Add graph counts, hubs, or directory coverage when the user wants
an overview; keep the report proportional to the request.
