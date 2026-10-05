---
name: refresh
description: >-
  Verify current claims in vault notes, docs, and README against project evidence,
  and correct them when requested. Use to check whether a note is still accurate
  or bring stale vault content up to date. Lifecycle hygiene belongs to agent-vault:groom;
  link mechanics belong to agent-vault:weave.
---

# agent-vault:refresh

Establish which stored claims remain accurate, which have drifted, and which cannot
be verified. A named-concept request goes straight to that material; a broad sweep
covers the requested layers. Keep historical records distinguishable from current
guidance.

An audit or accuracy question is read-only. A request to correct or refresh content
authorizes supported corrections within its stated scope; do not ask for that same
permission again. If a finding needs a new decision, unavailable evidence, or work
beyond the request, report the issue and proposed next action without inventing a fix.

[Capture](../capture/SKILL.md) writes from information already established in the
session. Refresh verifies existing claims against evidence. Either may update a
record, but finding stale content does not authorize filling every gap in the vault.

## Scope and resources

Current claims commonly live in `knowledge/`, `docs/`, and the project `README.md`.
Judge the claim's intended time frame, not just its directory: a dated audit in
`knowledge/` remains history even when today's system differs. Do not rewrite
journals or handoffs into current guidance, delete concepts, or change task lifecycle.

Read ADRs for the choice and its context; leave their bodies unchanged in this pass.
Implementation divergence does not prove that a replacement choice was made.
Report that discrepancy separately from factual documentation drift. Recording an
actual replacement decision follows [capture](../capture/SKILL.md) and its
[decision guidance](../capture/references/decisions.md), including the supersession
chain, only when decision evidence and user intent support it.

Resolve the plugin root from this loaded `SKILL.md`: two directories above
`skills/refresh/`. Helper paths below are relative to that root. Use quoted absolute
paths without relying on a host-specific environment variable. From the intended
source checkout, run `bin/resolve-project.sh` to locate its vault project;
`bin/find-vault.sh` resolves the containing root. Check that the project exists;
report missing storage or resolution failures without silently creating records.

## Verify the claims

For a broad sweep, prioritize consequential, frequently used claims and material
likely affected by known changes. `generated.at`, Git history, and
`bin/backlinks.sh <project-path> <concept-path>` can help choose what to inspect.
Age, connectivity, and lack of Git activity do not prove truth or falsehood.

Identify concrete assertions: paths, names, versions, commands, responsibilities,
described behavior, and current focus. Inspect declared `sources` as part of the
claim's provenance. Check paths and manifests directly, and read the relevant source
for behavioral claims. When static evidence is insufficient, state the limit or
use an appropriate authorized observation; do not run a command merely because an
old note recommends it. Unavailable external evidence and unknown intent remain
unverified rather than becoming guesses.

Classify findings by their meaning and consequence:

- **Drifted claim:** update the supported fact while preserving the useful concept.
- **Superseded current guidance:** revise it, or preserve historical value by marking
  it deprecated and linking an existing replacement where one is known. A dated
  historical account does not need deprecation simply because the system changed.
- **Decision divergence:** report the difference between the recorded choice and
  current implementation; do not manufacture a superseding ADR from code alone.
- **Stale focus:** update the README from supported current context. A task's status
  alone does not prove its original scope was delivered.
- **Unverifiable claim:** explain the evidence gap without rewriting it into a new guess.

For an audit, give the evidence and proposed correction. For authorized updates,
apply supported corrections and report unresolved findings. Keep the finding and
its disposition clear without imposing a fixed report template.

## Preserve authorized changes

Advance `generated.at` with a full timezone-aware timestamp on changed concepts,
preserving the existing `generated.by` convention. Align descriptions and relevant
index entries with changed content. Do not add verification claims without evidence.

Check relationships affected by the edits. If link targets changed, use
`bin/graph-audit.sh --quick <project-path>` to inspect the fallout; unrelated findings
do not become prerequisites for the correction. A needed rename follows
[weave](../weave/SKILL.md) and the bundled rename helper so incoming references are
preserved, rather than a manual file move. Do not broaden a content pass into a
general graph repair.

Commit the exact changed files with
`bin/vault-commit.sh "docs(vault): refresh <what>" <changed-file>...`, including any
affected indexes or relationship records. Preserve unrelated changes and confirm the
actual commit before claiming durability: the helper can silently skip or fail to
commit. Report what was checked, changed, left uncertain, and preserved successfully.
