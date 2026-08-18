# Linking doctrine — how to wire a concept into the graph

The vault combines an **OKF v0.2 Markdown bundle** with SQLite-backed task concepts provided by the Agent Vault task extension. Both providers participate in one logical graph. Base OKF conformance allows broken links; this plugin deliberately adds a stronger graph-quality profile, so linking remains a gate on every write.

## The gate (non-negotiable)

A concept is not done until **both** hold:

1. **It links out.** ≥1 outbound link to an existing concept it builds on, depends on, contrasts with, or explains.
2. **It earns a link in.** Either a concept you already have gains a return link to the new one, **or** you add the new one to its directory `index.md`. A concept with zero inbound links is an orphan — fix it now, not "later."

If you genuinely cannot find a single neighbour, that is a signal the concept is mis-scoped or the bundle is missing a hub — say so; don't ship the orphan silently.

## Link syntax

Use standard Markdown link notation, never `[[wikilinks]]`. File concepts use bundle-relative absolute paths; task concepts use immutable task URIs:

```markdown
decided in [token rotation](/docs/decisions/ADR-005-token-rotation.md)
see [the convention scan note](/knowledge/convention-scan.md)
continue [the task](task:123e4567-e89b-42d3-a456-426614174000)
```

Relative file links are legal but discouraged. A task URI never contains its status or display key and therefore never changes during workflow transitions, title edits, or project transfers.

OKF semantics: a link from A to B asserts *a relationship*; the **kind** of relationship lives in the surrounding prose ("supersedes", "depends on", "contradicts"), not in the link itself. So always frame the link with a word that says why it's there.

Broken links are legal (OKF consumers must tolerate them), so a **forward link to a concept you haven't written yet is fine** — it marks intent. But don't lean on it; create the target when you can.

## What to link (link the nouns, not the filler)

Link the distinctive entities future-you would *traverse to*:

- a **decision** → `[...](/docs/decisions/ADR-NNN-slug.md)`
- a **task** → `[...](task:<uuid>)`
- another **note** → `[...](/knowledge/<topic>.md)`
- a **doc** → `[...](/docs/<topic>.md)`
- a **journal entry** → `[...](/journal/YYYY-MM-DD.md)`

Do **not** link every word. Over-linking is noise; link the entities, not the connective tissue.

## Unlinked mentions — the highest-value reflex

When your prose *names* a concept that already exists in the bundle (an ADR id, a topic note's title, a task) as plain text, **link it**. An unlinked mention is a missing edge. Before finishing a write, scan what you wrote for names of existing concepts and wire them. (`agent-vault:weave` finds the ones you miss — but catch them at write time.)

## Aliases

A concept MAY declare its common alternate names in frontmatter:

```yaml
aliases: [token rotation, key rotation, cred refresh]
```

These are alternate display names for the same concept. Adding them powers richer unlinked-mention detection — `agent-vault:weave` matches prose against a concept's aliases as well as its id/name, so a mention written under a different name still resolves — and lets a writer link or recall the concept under either name. Add aliases when a concept is routinely called by more than one name; keep the list to the names that actually show up in prose, not every synonym.

## Direction & reciprocity

Links are directional and not always symmetric, but **hubs aggregate their inbound**:

- **MOCs / `index.md`** list file concepts; the task board is the synthesized index for database task concepts.
- **ADRs** collect the tasks and notes that depend on them; when note→ADR is "explains this decision", add ADR→note under the ADR's `## Links`.
- **supersession chains** are bidirectional: the new ADR links the old; the old ADR's OKF lifecycle `status` becomes `deprecated`, its `decision_status` becomes `superseded by ADR-NNN`, and it links forward.
- **journal → everything**: the journal is the densest hub. It links out freely and is rarely linked back to (that's correct — it's a timeline, not a topic).

## Quick self-check before you save

- [ ] At least one outbound markdown link to a real concept?
- [ ] An inbound link exists (return link added, or listed in `index.md`)?
- [ ] Every existing-concept name in the prose is linked, not bare?
- [ ] File targets use exact bundle-relative paths and task targets use immutable task URIs?
- [ ] The prose says *why* each link is there?
