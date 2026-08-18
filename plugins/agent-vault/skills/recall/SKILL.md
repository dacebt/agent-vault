---
name: recall
description: >-
  Answer a specific question about prior work, decisions, or context by navigating the vault's
  knowledge graph — traversing links and backlinks from a seed concept; full-text search is the
  fallback. Use for "have we decided X", "when did I work on Y", "what did we do about Z", "remind
  me why", "search the vault", "look up". Cross-project search available. For a broad state dump
  rather than a targeted question, use agent-vault:orient.
---

# agent-vault:recall

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

The vault is an **OKF knowledge bundle** — a graph of linked markdown concepts. The strongest way to answer a recall question is to **navigate that graph**, the way an agent reads an LLM-wiki: find a seed, follow its links and backlinks, read the connected neighbourhood. That beats blind full-text search on accuracy *and* speed, and needs no embeddings or vector index — the structure is already in the files. Grep is the cold-start fallback for when you have no seed, not the primary tool.

Read concepts directly. For a declared v0.1 concept, fall back to `timestamp` only when `generated` is absent and to a legacy `# Citations` list only when `sources` is absent.

## The method — navigate, don't scan

**1. Find a seed.** The concept the question is "about." Cheapest routes first:
   - A named identifier (ADR id, task key, topic) → open the Markdown file or query `${AGENT_VAULT_PLUGIN_ROOT}/bin/task-db.py show <project> <task>` directly.
   - The directory `index.md` MOC for the relevant layer (`knowledge/index.md`, `docs/decisions/index.md`) — read it and pick the concept whose `description` matches. This is the on-ramp; use it before grepping.
   - When matching a name, also check concepts' `aliases:` frontmatter, not just titles/ids — a concept may be filed under one name but asked about by another.
   - Only if neither lands: one targeted full-text search (see Fallback) to surface a seed.

**2. Traverse out.** Read the seed. Follow its bundle-relative markdown links (`[...](/docs/decisions/ADR-005-x.md)`) to the concepts it references. The answer usually lives in the seed plus its immediate neighbours.

**3. Traverse in (backlinks).** Find what points *at* the seed — the query plain grep-users miss:
   ```
   ${AGENT_VAULT_PLUGIN_ROOT}/bin/backlinks.sh <project-path> <seed-id>
   ```
   Backlinks surface the journal entries that discussed a decision, the tasks that depend on an ADR, the notes that cite a topic. Read the relevant ones.

**4. Query the structure when the question is a filter, not a lookup.** OKF frontmatter is queryable like a database — don't full-text scan when you can filter fields:
   - all open decisions: `rg -l '^decision_status: proposed' <project>/docs/decisions`
   - everything tagged auth: `rg -l '^tags:.*\bauth\b' <project>`
   - concepts of a type: `rg -l '^type: decision' <project>`
   - draft/stable/deprecated concepts: query standardized OKF `status`
   - provenance/freshness: inspect `generated`, `verified`, `sources`, and `stale_after`

**5. Assemble from the neighbourhood**, not from scattered line hits. The answer is the seed + what it links + what links to it.

**6. Preserve trust semantics.** If the answer relies on a concept with `stale_after` in the past, say it is stale. Distinguish generated-but-unverified material from concepts with valid `verified` events. Cite declared `sources` when they support the answer. Do not infer trust from file age or from a workflow field. `verified` confirms the concept definition; it does not prove that a particular Attested Computation run passed its attester.

## Fallback — full-text search (cold start only)

When you have no seed and the MOCs don't surface one:
1. Use `rg` (ripgrep) — fast, gitignore-aware, recursive. Prefer it over `grep`.
2. Keep the query small and distinctive — pull the rare words from the question, not the filler ("token rotation", not "the thing about auth we did").
3. Treat the top hit as a *seed*, then switch back to traversal (steps 2–3). Don't answer from raw line matches — open the file and walk its links.

## Routing — where a seed most likely lives

| Question shape | Seed lives in |
|---|---|
| "Why did we choose / why is X this way" | `docs/decisions/` (ADRs) |
| "When did I…" / "what was I doing N days ago" | `journal/` |
| "What did I learn about X" / "do I have notes on Y" | `knowledge/` |
| "What was the task about X" | `task-db.py list/show` across all workflow statuses |
| "How does X work here" | `docs/` |
| A specific id | direct file open — no search |

## When the answer is long or scattered

For substantial recall, keep the same traversal boundary (seed → links → `backlinks.sh` → neighbourhood) and synthesize from opened concepts, not raw matches. Use a subagent only when the active environment's instructions explicitly permit delegation.

## Cross-project recall

The vault holds all projects. When the user asks "have I solved this before in another project" or "search across everything", traverse/search the whole `<vault>/` tree and group results by project.

## Presenting results

- Lead with the answer in your own words.
- Quote the source line or short passage with its file.
- Reference file concepts with bundle-relative Markdown links and task concepts with immutable `task:<uuid>` links so compatible consumers can activate the correct provider.
- If nothing was found, say so plainly. Don't invent.

## What it does NOT do

- Doesn't answer from raw grep hits — a hit is a seed, then you traverse.
- Doesn't search outside the vault (project source, Notion, GitHub) — different surface.
- Doesn't modify anything. Pure read.
