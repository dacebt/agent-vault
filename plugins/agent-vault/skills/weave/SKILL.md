---
name: weave
description: >-
  Maintain the health of the vault's OKF link graph — find and fix orphan concepts, dangling
  links, unlinked mentions, stale or missing index.md MOCs, and legacy [[wikilinks]]. Use when the
  user wants to "weave the vault", "tighten the links", "find orphans", "fix the graph", "connect
  related notes", "build the indexes", or after a burst of capture. Checks the link graph —
  distinct from agent-vault:groom, which audits task/decision/handoff hygiene.
---

# agent-vault:weave

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

A knowledge graph rots the same way a garden does: new concepts land under-linked, links go stale when files move, MOCs fall behind their directories. **weave** is the deliberate pass that keeps the OKF bundle traversable — because an orphan concept never surfaces in recall, and a graph with no edges is just a folder of files.

Distinct from `agent-vault:groom`: groom checks *task/decision/handoff lifecycle hygiene* (stale WIP, missing acceptance, dangling ADRs). weave checks *graph health* (the links themselves).

## When to use

- The user asks to "weave", "tighten the links", "find orphans", "connect the notes", "fix the graph", "build the indexes".
- After a burst of `agent-vault:capture` / a migration / a long session that produced several new concepts.
- Periodically, the way you'd groom a board — the graph drifts silently.

## How it works

1. Resolve vault + project.
2. Run the graph audit:
   ```
   ${AGENT_VAULT_PLUGIN_ROOT}/bin/graph-audit.sh <project-path>
   ```
   It reports six findings, each only when present: **ORPHANS**, **DANGLING LINKS**, **LEGACY WIKILINKS**, **MISSING INDEX**, **INDEX GAPS**, **UNLINKED MENTIONS**. It reports; it never edits.

   Pass `--quick` for fast intermediate triage when you only need orphans, dangling links, legacy wikilinks, and index health. `--quick` skips the alias-aware unlinked-mention scan; it never substitutes for the initial or final full audit. Either mode ends with a machine-readable `SUMMARY:` line.
3. For backlink questions while triaging ("does anything point at this orphan?"), use:
   ```
   ${AGENT_VAULT_PLUGIN_ROOT}/bin/backlinks.sh <project-path> <concept-id>
   ```
4. If the audit has no findings, do not spawn verification subagents. If it has findings, the main agent must delegate their verification:
   - Choose the number of subagents from the finding count, connected neighborhoods, and overlap. Assign every finding to exactly one owner; keep tightly connected findings together.
   - Give each subagent only its assigned findings and the project path. Subagents inspect the relevant concepts read-only and return a disposition for every finding: confirmed defect, false positive, or intentional forward link; exact evidence; a proposed repair when confirmed; and any cross-partition dependency.
   - Subagents do not run the graph audit or settle cross-partition conflicts. The main agent alone runs the initial audit gate, checks every returned disposition against the source, reconciles dependencies, and accounts for every finding.
5. Triage the verified findings into one concrete repair proposal and **propose before applying** — the link graph is judgment-laden; a wrong link is worse than a missing one.
6. After approval, partition the accepted repairs into non-overlapping subagent assignments. Each subagent edits only its assigned vault paths, runs the relevant focused checks, and returns its changed paths and evidence. The main agent inspects the assembled diff, resolves every overlap or cross-partition dependency, and runs the final audit gate.

## Fixing each finding

Read `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md` first — every fix follows the doctrine.

- **ORPHANS** — a concept with no links in or out. Read it, find its real neighbours in the bundle, add an outbound `## See also` link or two, and add it to its directory `index.md` so it earns an inbound link. If it has no genuine neighbour, it may be mis-scoped — flag it, don't fabricate a link.
- **DANGLING LINKS** — a markdown link whose target file doesn't exist. Either the target moved (fix the path) or it was never created (create the concept, or remove the link if it's truly dead). OKF tolerates broken links, so a deliberate forward-link to a planned concept is fine — leave those, fix the accidents. **When the dangling links are the fallout of a rename** (a concept's file was moved/renamed and every inbound link now points at the old path), don't hand-fix each one — that's what `${AGENT_VAULT_PLUGIN_ROOT}/bin/rename-concept.sh` is for (see below).
- **LEGACY WIKILINKS** — `[[...]]` not yet migrated. Convert to bundle-relative markdown links, resolving the target.
- **MISSING INDEX** — a `knowledge/` or `docs/` directory with concepts but no `index.md`. Build one from `${AGENT_VAULT_PLUGIN_ROOT}/templates/index.md`, one entry per concept using its `description`.
- **INDEX GAPS** — a concept not listed in its directory's `index.md`. Add the entry.
- **UNLINKED MENTIONS** — bare text naming an existing concept (these are *candidates*; the audit is conservative). Confirm the mention really refers to that concept, then turn it into a link. Skip false positives.

## Renaming a concept safely

When a concept needs a new name or path — a topic note that outgrew its filename, an ADR slug that no longer fits — moving the file by hand strands every inbound link and seeds a wave of dangling links. Use the helper instead:

```
${AGENT_VAULT_PLUGIN_ROOT}/bin/rename-concept.sh <project-path> <old-path> <new-path>
```

It moves the file and rewrites every bundle-relative link that pointed at the old path (across all layers and the `index.md` MOCs) so nothing dangles. Reach for it whenever the user wants to rename/move a concept, or when a finding is "dangling links all trace back to one concept that was renamed." Re-run the graph audit afterward.

## The enrichment sweep (beyond fixing breakage)

weave isn't only repair. When asked to "connect related notes" or after new content lands, actively look for concepts that *should* link but don't yet — related decisions, a note that explains an ADR, a journal entry discussing a task. Add the real edges. This is what keeps the graph getting denser instead of just not-broken. Only genuine relationships; frame each link with why in the prose.

## Graph shape (optional report)

When the user wants a sense of the graph, not just fixes, surface: total concepts, orphan count, the most-linked hubs (run `backlinks.sh` on a few candidate concepts), and which directories have MOCs. A one-paragraph "here's the shape of your brain" read.

## How to present

Group by actionability, like groom:

```
**Broken — fix now:**
- `knowledge/foo.md` is an orphan — no links in or out
- dangling: `journal/2026-06-12.md` → `/docs/decisions/ADR-009.md` (missing)

**Worth weaving:**
- 3 unlinked mentions of `ADR-005` across journal entries
- `knowledge/index.md` missing entries for 2 notes

**Just noticing:**
- 14 concepts, 2 hubs, knowledge/ well-connected; tasks/ sparse (expected)
```

Propose specific fixes; apply once the user confirms (or apply the unambiguous mechanical ones — index gaps, legacy wikilinks — and propose the judgment-laden ones). After edits, re-run both gates and durability-commit only the exact files changed.

## What it does NOT do

- Doesn't touch task lifecycle (`agent-vault:groom`) or write new knowledge from scratch (`agent-vault:capture`).
- Doesn't fabricate links to clear an orphan — a forced link is graph noise.
- Doesn't delete concepts. A truly dead concept is flagged for the user, not removed.
