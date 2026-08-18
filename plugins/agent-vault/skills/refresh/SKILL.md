---
name: refresh
description: >-
  Content-truth pass on the vault — reads knowledge notes, docs, and the README and verifies
  their claims against the repo as it exists now, surfacing drifted facts, superseded notes, and
  decisions reality has quietly walked away from. Use when the user wants to "refresh the vault",
  "sweep for outdated info", "check the docs against the code", or asks "is this still accurate" /
  "what's out of date". Checks what the content claims, not lifecycle (agent-vault:groom) or the link
  graph (agent-vault:weave).
---

# agent-vault:refresh

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

A note can be perfectly linked, tidily statused, and wrong. `architecture.md` keeps describing a directory that was renamed two months ago; a how-to walks through a flag that no longer exists; the README's "current focus" is three milestones stale. groom never catches this (it reads lifecycle metadata, not claims) and weave never catches it (a link to a well-formed file resolves whether or not the prose around it is still true). **refresh** is the pass that reads what the vault *asserts* and checks it against reality.

The hygiene triad: **groom** keeps the *board* honest, **weave** keeps the *graph* traversable, **refresh** keeps the *content* true.

## When to use

- The user asks to "refresh the vault", "sweep for outdated info", "check what's still accurate", "audit the docs against the code".
- After a burst of repo change — a rename, a restructuring, a milestone — that the knowledge layer hasn't caught up with.
- Periodically, like the other two passes — content drifts silently every time the repo moves and the vault doesn't.
- Scoped, when one concept smells stale: "is the architecture note still right?"

## What's in scope

Only layers that make claims about **current** reality:

- `knowledge/` notes — observations, references, distilled insights
- `docs/` — how-tos and structural references (the most brittle: they name paths, commands, rosters)
- `README.md` — project identity and especially the current-focus section
- `docs/decisions/` — **read-only**: an ADR is a point-in-time record and its body is never edited, but reality can quietly walk away from a decision. Flag that; the fix routes through `agent-vault:decide` as a superseding ADR.

Explicitly out of scope: `journal/` and `handoffs/` (dated history — an entry is true *of its date*; rewriting it is falsifying the diary), and `tasks/` (lifecycle is groom's job).

## How it works

1. Resolve vault + project.
2. **Inventory and prioritize.** List the in-scope concepts. `generated.at` is the age signal; `${AGENT_VAULT_PLUGIN_ROOT}/bin/backlinks.sh <project-path> <concept-id>` tells you which are hubs. A full sweep starts with the old, load-bearing concepts (architecture doc, hub notes, README); a scoped run goes straight to the named concept.
3. **Extract the checkable claims.** For each concept, list what it asserts about reality: paths and filenames, component/skill/agent rosters, commands and flags, names, versions, described behavior. Also its `sources` frontmatter, if present — do those artifacts still exist?
4. **Verify — cheap checks first.** Mechanical: does every repo path the concept names still exist? Do the named things still carry those names? Then semantic: read the relevant code, manifests, and README and ask whether the *described behavior* still matches. `git log --oneline --since=<generated.at> -- <paths the concept describes>` is the drift detector — heavy churn since the note was written means read carefully; silence means it's probably still true.
5. **Triage each finding** (taxonomy below) and **propose before applying** — every fix here rewrites a claim, and a confidently wrong "fix" is worse than the stale original.

## The finding taxonomy

- **Drifted claim** — the concept is sound but a fact inside it is no longer true (renamed path, changed roster, moved responsibility). Fix: update the claim in place, advance `generated.at` (the concept changed), leave the rest alone.
- **Superseded concept** — the whole note describes a former world. Don't delete it. Either rewrite it to describe the current world (advance `generated.at`), or — when the old description has historical value — set lifecycle `status: deprecated` and add a link to the concept that now covers the territory.
- **Decision walked away from** — an accepted ADR whose context or consequences no longer hold in the repo. Never edit the ADR body. Flag it and propose a superseding ADR through `agent-vault:decide`, which handles the bidirectional supersession chain.
- **Stale README focus** — the current-focus section describes finished or abandoned work. Propose the one-paragraph update.
- **Unverifiable claim** — asserts something you can't check against the repo (an external system, a claim about intent). Flag it as unverified; don't guess, don't "fix" it into a different guess.

## After edits

- Advance `generated.at` (full ISO 8601 with timezone) on every concept whose content changed; keep the existing `generated.by` convention.
- If a fix changed link targets or removed a name other concepts mention, re-run `${AGENT_VAULT_PLUGIN_ROOT}/bin/graph-audit.sh --quick <project-path>` — content fixes can create graph debt. A concept that needs a new *filename* is a rename: hand that to `${AGENT_VAULT_PLUGIN_ROOT}/bin/rename-concept.sh` (weave's territory) rather than moving it by hand.
- **Commit for durability**: `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh "docs(vault): refresh <what>" <exact files touched>` — scoped commit, never `git add -A`, no co-author trailer.

## Not capture's update path

`agent-vault:capture` also updates vault content when the user says "update the project docs" — but capture is **write-oriented**: it fills gaps opportunistically from what this session already knows. refresh is **verification-oriented**: it systematically reads what's already written and checks it against the repo, whether or not this session touched that territory. Capture fills the gaps; refresh finds the lies. A broad "bring the docs up to date" often wants both: refresh to find what's wrong, capture to write what's missing.

## How to present findings

Group by severity, like the other passes:

```
**Wrong now:**
- `knowledge/architecture.md` describes `plugins/wsd/` and an `statusline` plugin — both renamed; roster is 2 plugins behind
- `docs/deploy.md` step 3 uses a `--legacy-peer-deps` flag the script no longer accepts

**Worth a pass:**
- README current focus still says "OKF migration" — done 3 weeks ago per the task database
- ADR-002's consequences section predates the codex-plugin split — consider a superseding ADR

**Just noticing:**
- `knowledge/wsd-audit-2026-05-24.md` describes a former state by design (dated audit) — accurate as history, no action
```

Propose the specific rewrite for each ("change X to Y because the repo now Z"). Apply once the user confirms, then make the scoped durability commit.

## What it does NOT do

- Doesn't touch task lifecycle, WIP, or handoff spending — that's `agent-vault:groom`.
- Doesn't fix link mechanics (orphans, dangling links, MOC gaps) beyond the fallout of its own edits — that's `agent-vault:weave`. A thorough vault health check is all three.
- Doesn't rewrite `journal/` or `handoffs/` — dated history stays as written.
- Doesn't edit ADR bodies — supersession via `agent-vault:decide` is the only path.
- Doesn't delete concepts. A dead concept is deprecated with a pointer, or flagged — never removed.
- Doesn't guess. A claim it can't verify is reported as unverified, not silently rewritten into a new claim.
